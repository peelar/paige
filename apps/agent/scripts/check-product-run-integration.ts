import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createProductRun, getProductRunDetail, projectProductRunEvent } from "@docs-agent/control-plane/agent";
import { Client } from "eve/client";

import { migrateDocsAgentDatabase } from "../../../packages/control-plane/src/db/client.js";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = join(appRoot, "fixtures", "run-index-agent");
const eveBin = join(appRoot, "node_modules", "eve", "bin", "eve.js");
const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-eve-run-index-"));
const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;
const originalNodeEnv = process.env.NODE_ENV;
const port = await availablePort();
const host = `http://127.0.0.1:${port}`;
let child: ChildProcessWithoutNullStreams | undefined;
let logs = "";

try {
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "run-index.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;
  await migrateDocsAgentDatabase();

  child = spawn(process.execPath, [eveBin, "dev", "--no-ui", "--host", "127.0.0.1", "--port", String(port), "--logs", "none"], {
    cwd: fixtureRoot,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: "pipe",
  });
  child.stdout.on("data", (chunk) => { logs += String(chunk); });
  child.stderr.on("data", (chunk) => { logs += String(chunk); });
  await waitForAgent(host, child);

  const client = new Client({ host });
  const health = await client.health();
  assert.equal(health.status, "ready");
  const session = client.session();
  const response = await session.send("Private fixture request that must stay in Eve.");
  const result = await response.result();
  assert.equal(result.status, "waiting");
  assert.match(result.message ?? "", /deterministic documentation check completed/i);

  const runId = result.events.map((event) => record(event.data)).map((data) => stringValue(data.turnId)).find(Boolean) ?? "turn_0";
  const indexed = await createProductRun({
    operationKey: "integration:real-eve-session",
    runType: "docs-verification",
    trigger: "terminal",
    sessionId: result.sessionId,
    runId,
    startedAt: "2026-07-11T12:00:00.000Z",
    traceLinks: [{ kind: "eve", label: "Durable Eve event stream", url: `${host}/eve/v1/session/${encodeURIComponent(result.sessionId)}/stream`, availability: "available" }],
  });
  for (const event of result.events) {
    await projectProductRunEvent({ productRunId: indexed.run.id, event: { type: event.type, data: event.data } });
  }

  const detail = await getProductRunDetail({ id: indexed.run.id });
  assert.equal(detail.sessionId, result.sessionId);
  assert.equal(detail.runId, runId);
  assert.equal(detail.status, "completed");
  assert.equal(detail.traces[0]?.url, `${host}/eve/v1/session/${encodeURIComponent(result.sessionId)}/stream`);
  assert.equal(detail.steps.length > 0, true);
  assert.doesNotMatch(JSON.stringify(detail), /Private fixture request|deterministic documentation check completed/i);

  const durableStream = await readDurableStream(`${host}/eve/v1/session/${encodeURIComponent(result.sessionId)}/stream?startIndex=0`, [
    "Private fixture request that must stay in Eve",
    "deterministic documentation check completed",
  ]);
  assert.match(durableStream, /Private fixture request that must stay in Eve/);
  assert.match(durableStream, /deterministic documentation check completed/i);
} catch (error) {
  if (logs.trim() !== "") console.error(logs);
  throw error;
} finally {
  child?.kill("SIGTERM");
  restore("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
  restore("VERCEL", originalVercel);
  restore("NODE_ENV", originalNodeEnv);
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Real Eve product run integration check passed.");

async function availablePort() { return new Promise<number>((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (typeof address !== "object" || address === null) return reject(new Error("Could not reserve a local port.")); server.close((error) => error ? reject(error) : resolve(address.port)); }); }); }
async function waitForAgent(host: string, process: ChildProcessWithoutNullStreams) { const deadline = Date.now() + 30_000; while (Date.now() < deadline) { if (process.exitCode !== null) throw new Error(`Eve fixture exited with ${process.exitCode}.`); try { const response = await fetch(`${host}/eve/v1/health`); if (response.ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 200)); } throw new Error("Timed out waiting for the Eve fixture agent."); }
async function readDurableStream(url: string, expected: string[]) { const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5_000); try { const response = await fetch(url, { signal: controller.signal }); assert.equal(response.ok, true); assert.notEqual(response.body, null); const reader = response.body!.getReader(); const decoder = new TextDecoder(); let text = ""; while (!expected.every((value) => text.toLowerCase().includes(value.toLowerCase()))) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value, { stream: true }); } await reader.cancel(); return text; } finally { clearTimeout(timeout); } }
function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown) { return typeof value === "string" && value !== "" ? value : undefined; }
function restore(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
