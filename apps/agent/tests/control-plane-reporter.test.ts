import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getValidationRun } from "@docs-agent/control-plane/agent";
import type { EveEvalResult, EveEvalRunSummary, EveEvalTarget } from "eve/evals";

import { ControlPlaneReporter } from "../evals/control-plane-reporter";
import { migrateDocsAgentDatabase } from "../../../packages/control-plane/src/db/client";
import { test } from "vitest";

test("control plane reporter", async () => {
const root = await mkdtemp(join(tmpdir(), "docs-agent-eval-reporter-"));
const originalUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;
const originalNodeEnv = process.env.NODE_ENV;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(root, "reporter.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

try {
  await migrateDocsAgentDatabase();
  const reporter = ControlPlaneReporter({
    suite: "reporter-contract",
    runId: "eval:reporter-contract",
  });
  const target: EveEvalTarget = {
    kind: "local",
    url: "http://127.0.0.1:2000",
    capabilities: { devRoutes: true },
  };
  await reporter.onRunStart([], target);

  const results = [
    result("passed", "messageIncludes(private expected output)", undefined),
    result("scored", "custom private source assertion", undefined),
    result("skipped", "skipped", undefined),
    result("failed", "succeeded", "Bearer private-token was rejected"),
  ];
  for (const item of results) await reporter.onEvalComplete(item);

  const summary: EveEvalRunSummary = {
    target,
    results,
    startedAt: "2026-07-11T10:00:00.000Z",
    completedAt: "2026-07-11T10:01:00.000Z",
    passed: 1,
    scored: 1,
    skipped: 1,
    failed: 1,
    errored: 1,
  };
  await reporter.onRunComplete(summary);

  const run = await getValidationRun({ id: "eval:reporter-contract" });
  assert.equal(run.outcome, "failed");
  assert.deepEqual(
    run.cases.map((item) => item.outcome).sort(),
    ["failed", "flaky", "passed", "skipped"],
  );
  assert.deepEqual(
    Object.fromEntries(
      run.cases.map((item) => [item.caseId, item.assertions[0]?.name]),
    ),
    {
      "case-failed": "succeeded",
      "case-passed": "messageIncludes",
      "case-scored": "assertion-1",
      "case-skipped": "skipped",
    },
  );
  assert.doesNotMatch(
    JSON.stringify(run),
    /private expected output|private source assertion|private-token|model output|private prompt|chain of thought/i,
  );
} finally {
  restore("DOCS_AGENT_DATABASE_URL", originalUrl);
  restore("VERCEL", originalVercel);
  restore("NODE_ENV", originalNodeEnv);
  await rm(root, { recursive: true, force: true });
}

console.log("Control-plane Eve reporter checks passed.");

function result(
  verdict: EveEvalResult["verdict"],
  assertionName: string,
  error: string | undefined,
): EveEvalResult {
  return {
    id: `case-${verdict}`,
    verdict,
    error,
    skipReason: verdict === "skipped" ? "private skip context" : undefined,
    startedAt: "2026-07-11T10:00:00.000Z",
    completedAt: "2026-07-11T10:00:01.000Z",
    assertions: [
      {
        name: assertionName,
        passed: verdict === "passed" || verdict === "skipped",
        score: verdict === "passed" ? 1 : 0,
        severity: verdict === "scored" ? "soft" : "gate",
      },
    ],
    result: {
      output: "model output",
      finalMessage: "private prompt response",
      status: error ? "failed" : "completed",
      events: [],
      derived: {
        toolCalls: [],
        toolCallCount: 0,
        subagentCalls: [],
        subagentCallCount: 0,
        inputRequests: [],
        parked: false,
        messageCount: 2,
        reasoningBlockCount: 1,
      },
      runtimeIdentity: {
        agentId: "fixture",
        eveVersion: "test",
        modelId: "openai/test-model",
        build: { gitSha: "abc123" },
      },
    },
  };
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
});
