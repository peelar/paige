import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getValidationRun } from "@docs-agent/control-plane/agent";

import { migrateDocsAgentDatabase } from "../../../packages/control-plane/src/db/client.js";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceFixtureRoot = join(appRoot, "fixtures", "validation-reporter-agent");
const fixtureRoot = await mkdtemp(join(appRoot, "fixtures", ".validation-reporter-"));
const eveBin = join(appRoot, "node_modules", "eve", "bin", "eve.js");
const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-eve-validation-"));
const retainedDatabaseUrl = process.env.DOCS_AGENT_VALIDATION_INTEGRATION_DATABASE_URL?.trim();
const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalEvalRunId = process.env.DOCS_AGENT_EVAL_RUN_ID;
const originalVercel = process.env.VERCEL;
const originalNodeEnv = process.env.NODE_ENV;

try {
  await prepareFixture();
  process.env.DOCS_AGENT_DATABASE_URL =
    retainedDatabaseUrl || `file:${join(tempRoot, "validation.sqlite")}`;
  process.env.DOCS_AGENT_EVAL_RUN_ID = "fixture:real-eve-eval";
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;
  await migrateDocsAgentDatabase();

  const result = await runEveEval();
  if (result.output.trim() !== "") process.stdout.write(result.output);
  assert.equal(result.code, 0);

  const run = await getValidationRun({ id: "fixture:real-eve-eval" });
  assert.equal(run.kind, "live-eval");
  assert.equal(run.suite, "validation-reporter-fixture");
  assert.equal(run.outcome, "passed");
  assert.equal(run.cases.length, 1);
  assert.equal(run.cases[0]?.caseId, "smoke");
  assert.equal(run.cases[0]?.outcome, "passed");
  assert.equal(run.model, "docs-agent-fixtures/validation-reporter-fixture");
  assert.match(run.target, /^local:http:\/\//);
  assert.doesNotMatch(
    JSON.stringify(run),
    /Private reporter fixture prompt|private fixture request completed/i,
  );
} finally {
  restore("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
  restore("DOCS_AGENT_EVAL_RUN_ID", originalEvalRunId);
  restore("VERCEL", originalVercel);
  restore("NODE_ENV", originalNodeEnv);
  await rm(tempRoot, { recursive: true, force: true });
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log("Real Eve validation reporter integration check passed.");

function runEveEval() {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [eveBin, "eval", "smoke", "--max-concurrency", "1"], {
      cwd: fixtureRoot,
      env: { ...process.env, NODE_ENV: "development" },
      stdio: "pipe",
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
  });
}

async function prepareFixture() {
  const files = [
    "agent/agent.ts",
    "agent/instructions.md",
    "evals/evals.config.ts",
    "evals/smoke.eval.ts",
    "package.json",
  ];
  for (const file of files) {
    const destination = join(fixtureRoot, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(sourceFixtureRoot, file), destination);
  }
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
