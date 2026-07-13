import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDocsAgentDatabase } from "../src/db/client.ts";
import { createDocsSignal, updateDocsSignalLifecycle } from "../src/docs-signals.ts";
import { getOperatorSignalDetail } from "../src/signal-detail.ts";
import { startOwnedDocsWork } from "../src/owned-docs-work.ts";
import { test } from "vitest";

test("signal detail", async () => {
const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-signal-detail-"));
const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;
const originalNodeEnv = process.env.NODE_ENV;

process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "detail.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

try {
  await migrateDocsAgentDatabase();
  const created = await createDocsSignal({
    source: {
      kind: "linear-issue",
      provider: "Linear",
      providerId: "DOCS-101-internal",
      permalink: "https://linear.app/acme/issue/DOCS-101",
      title: "Metadata filtering",
      authors: ["Marta", "Kai"],
      sourceText: "<script>unsafe()</script> literal source text",
      capturedAt: "2026-07-11T10:00:00.000Z",
      metadata: {
        team: "Docs",
        apiKey: "lin_api_secret",
        nested: { authorization: "Bearer secret", note: "safe" },
        values: ["github_pat_secret", "visible"],
      },
    },
    sourceSummary: "Operator-safe source summary.",
    extractedClaims: ["Apps can filter private metadata."],
    likelyDocsConcepts: ["Metadata permissions"],
    likelyDocsPages: ["docs/api-usage/metadata.mdx"],
    productSurfaces: ["GraphQL API"],
    missingEvidence: [],
    uncertainty: "Generated reference work is separate.",
    priority: 80,
    links: [
      { kind: "docs-page", label: "Safe docs", url: "https://docs.example.com/metadata", metadata: {} },
      { kind: "other", label: "Insecure", url: "http://example.com/internal", metadata: {} },
    ],
    artifacts: [
      { kind: "verification-report", label: "Verification", metadata: { decision: "docs-patch" } },
      { kind: "check-log", label: "Checks", metadata: { checks: ["diff-check"] } },
      { kind: "diff", label: "Patch", path: "/workspace/working-docs", metadata: { changedFiles: ["metadata.mdx"] } },
      { kind: "draft-pr", label: "Draft PR", url: "https://github.com/example/docs/pull/1", metadata: { token: "ghp_secret" } },
    ],
  });

  await startOwnedDocsWork({
    signalId: created.signal.id,
    operationKey: "accept-DOCS-101",
    intendedOutcome: "Prepare and validate the metadata documentation update.",
    conversation: { kind: "linear-issue", id: "DOCS-101", url: "https://linear.app/acme/issue/DOCS-101" },
  }, { sessionId: "session-DOCS-101", runId: "run-DOCS-101-start" });

  await new Promise((resolve) => setTimeout(resolve, 5));
  await updateDocsSignalLifecycle({
    id: created.signal.id,
    status: "needs-source-evidence",
    reason: "Need the merged API source reference.",
    missingEvidence: ["Merged API source reference"],
    links: [],
    artifacts: [],
    metadata: { credential: "xoxb-secret", safe: "visible" },
  });

  const detail = await getOperatorSignalDetail({ id: created.signal.id });
  assert.equal(detail.sourceSummary, "Operator-safe source summary.");
  assert.equal(detail.ownedWork?.status, "active");
  assert.equal(detail.ownedWork?.sessionId, "session-DOCS-101");
  assert.equal(detail.sources[0]?.provider, "Linear");
  assert.deepEqual(detail.sources[0]?.authors, ["Marta", "Kai"]);
  assert.equal(detail.sources[0]?.sourceText, "<script>unsafe()</script> literal source text");
  assert.equal(detail.sources[0]?.permalink, "https://linear.app/acme/issue/DOCS-101");
  assert.equal(detail.sources[0]?.metadata.apiKey, "[redacted]");
  assert.deepEqual(detail.sources[0]?.metadata.nested, {
    authorization: "[redacted]",
    note: "safe",
  });
  assert.deepEqual(detail.sources[0]?.metadata.values, ["[redacted]", "visible"]);
  assert.equal(detail.links.find(({ label }) => label === "Safe docs")?.url, "https://docs.example.com/metadata");
  assert.equal(detail.links.find(({ label }) => label === "Insecure")?.url, null);
  assert.deepEqual(
    detail.artifacts.map(({ kind }) => kind).sort(),
    ["check-log", "diff", "draft-pr", "verification-report"],
  );
  assert.equal(detail.artifacts.find(({ kind }) => kind === "draft-pr")?.metadata.token, "[redacted]");
  assert.equal(detail.events.length, 3);
  assert.equal(detail.events[0]?.eventType, "signal-created");
  assert.equal(detail.events[1]?.eventType, "owned-work-accepted");
  assert.equal(detail.events[2]?.toStatus, "needs-source-evidence");
  assert.equal(detail.events[2]?.metadata.credential, "[redacted]");
  assert.equal(detail.events[2]?.metadata.safe, "visible");

  const serialized = JSON.stringify(detail);
  assert.equal(serialized.includes("DOCS-101-internal"), false);
  assert.equal(serialized.includes("lin_api_secret"), false);
  assert.equal(serialized.includes("xoxb-secret"), false);
  assert.equal(serialized.includes("accept-DOCS-101"), false);
} finally {
  restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
  restoreEnvironment("VERCEL", originalVercel);
  restoreEnvironment("NODE_ENV", originalNodeEnv);
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Operator signal detail checks passed.");

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
});
