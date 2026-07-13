import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDocsAgentDatabase } from "../src/db/client.ts";
import { createDocsSignal } from "../src/docs-signals.ts";
import {
  cleanupExpiredProductRuns,
  createProductRun,
  getProductRunDetail,
  listProductRuns,
  projectProductRunEvent,
  projectProductRunEventByReference,
} from "../src/product-runs.ts";
import { test } from "vitest";

test("product runs", async () => {
const root = await mkdtemp(join(tmpdir(), "docs-agent-product-runs-"));
const originalUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;
const originalNodeEnv = process.env.NODE_ENV;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(root, "runs.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

try {
  await migrateDocsAgentDatabase();
  const signal = await createDocsSignal({
    source: { kind: "linear-issue", authors: [], capturedAt: "2026-07-11T08:00:00.000Z", metadata: {} },
    sourceSummary: "Document the new metadata behavior.",
    extractedClaims: [], likelyDocsConcepts: [], likelyDocsPages: [], productSurfaces: [], missingEvidence: [], priority: 70, links: [], artifacts: [],
  });

  const created = await createProductRun({
    operationKey: "verify:DOCS-201",
    runType: "docs-verification",
    trigger: "linear",
    sessionId: "session-201",
    runId: "turn-0",
    signalId: signal.signal.id,
    workflowId: "owned:DOCS-201",
    startedAt: "2026-07-11T09:00:00.000Z",
    traceLinks: [
      { kind: "eve", label: "Eve stream", url: "http://127.0.0.1:2000/eve/v1/session/session-201/stream", availability: "available" },
      { kind: "vercel", label: "Vercel Agent Run", availability: "unavailable", unavailableReason: "This operator cannot access the deployment trace." },
    ],
  });
  assert.equal(created.created, true);
  assert.equal(created.run.expiresAt, "2026-08-10T09:00:00.000Z");

  const replay = await createProductRun({
    operationKey: "verify:DOCS-201",
    runType: "docs-verification",
    trigger: "linear",
    sessionId: "retry-session",
    runId: "retry-turn",
    signalId: signal.signal.id,
  });
  assert.equal(replay.created, false);
  assert.equal(replay.run.id, created.run.id);
  assert.equal(replay.run.sessionId, "session-201");

  await projectProductRunEvent({ productRunId: created.run.id, event: {
    type: "step.started",
    timestamp: "2026-07-11T09:00:01.000Z",
    data: { stepIndex: 0, modelId: "openai/gpt-5", messages: ["private input"], reasoning: "secret chain", toolPayload: { token: "ghp_secret" } },
  }});
  const completedStep = { type: "step.completed", timestamp: "2026-07-11T09:00:02.000Z", data: { stepIndex: 0, modelId: "openai/gpt-5", usage: { inputTokens: 120, outputTokens: 35, cacheReadTokens: 80 }, output: "private output", toolPayload: { authorization: "Bearer secret" } } };
  await projectProductRunEvent({ productRunId: created.run.id, event: completedStep });
  await projectProductRunEvent({ productRunId: created.run.id, event: completedStep });
  let detail = await getProductRunDetail({ id: created.run.id, now: "2026-07-11T10:00:00.000Z" });
  assert.equal(detail.steps.length, 1);
  assert.equal(detail.inputTokens, 120);
  assert.equal(detail.outputTokens, 35);
  assert.equal(detail.cacheReadTokens, 80);
  assert.equal(detail.model, "openai/gpt-5");
  assert.doesNotMatch(JSON.stringify(detail), /private input|private output|secret chain|ghp_secret|Bearer secret/);

  await projectProductRunEventByReference({ sessionId: "session-201", runId: "turn-0", event: { type: "input.requested", data: { prompt: "Reveal the private launch plan" } } });
  detail = await getProductRunDetail({ id: created.run.id });
  assert.equal(detail.status, "waiting-for-input");
  assert.equal(detail.waitingSummary, "Human input is required to continue.");
  assert.doesNotMatch(JSON.stringify(detail), /private launch plan/);

  await projectProductRunEvent({ productRunId: created.run.id, event: { type: "turn.completed", timestamp: "2026-07-11T09:05:00.000Z", data: { message: "not copied" } } });
  await projectProductRunEvent({ productRunId: created.run.id, event: { type: "session.waiting", timestamp: "2026-07-11T09:05:01.000Z" } });
  detail = await getProductRunDetail({ id: created.run.id });
  assert.equal(detail.status, "completed");
  assert.equal(detail.traces.find(({ kind }) => kind === "vercel")?.availability, "unavailable");
  assert.equal(detail.failureSummary, null);

  const failed = await createProductRun({ operationKey: "write:DOCS-201", runType: "writeback", trigger: "terminal", sessionId: "session-202", runId: "turn-0", signalId: signal.signal.id, startedAt: "2026-07-11T11:00:00.000Z" });
  await projectProductRunEvent({ productRunId: failed.run.id, event: { type: "turn.failed", data: { code: "provider_401", message: "token ghp_secret was rejected" } } });
  const failedDetail = await getProductRunDetail({ id: failed.run.id });
  assert.equal(failedDetail.status, "failed");
  assert.equal(failedDetail.failureSummary, "Eve reported provider_401.");
  assert.doesNotMatch(JSON.stringify(failedDetail), /ghp_secret/);

  const expiredList = await listProductRuns({ now: "2026-08-11T00:00:00.000Z", statuses: ["expired"] });
  assert.equal(expiredList.length, 2);
  assert.equal(expiredList[0]?.signal?.summary, "Document the new metadata behavior.");
  assert.equal((await cleanupExpiredProductRuns({ now: "2026-08-11T00:00:00.000Z", limit: 1 })).deleted, 1);
  assert.equal((await listProductRuns({ now: "2026-08-11T00:00:00.000Z" })).length, 1);
  assert.equal((await cleanupExpiredProductRuns({ now: "2026-08-11T00:00:00.000Z", limit: 100 })).deleted, 1);
  assert.equal((await listProductRuns()).length, 0);
} finally {
  restore("DOCS_AGENT_DATABASE_URL", originalUrl);
  restore("VERCEL", originalVercel);
  restore("NODE_ENV", originalNodeEnv);
  await rm(root, { recursive: true, force: true });
}

console.log("Product run index checks passed.");

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}
});
