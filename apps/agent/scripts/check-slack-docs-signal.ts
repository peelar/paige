import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-slack-signal-"));
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "slack-signals.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

const { migrateDocsAgentDatabase } = await import("../agent/lib/db/client.js");
await migrateDocsAgentDatabase();

const { captureSlackDocsSignal } = await import("../agent/lib/slack-docs-signal.js");

const sourceBacked = await captureSlackDocsSignal({
  teamId: "T123",
  channelId: "C123",
  channelName: "api-changes",
  threadTs: "1783612800.000100",
  triggeringMessageTs: "1783612860.000200",
  permalink: "https://example.slack.com/archives/C123/p1783612800000100",
  capturedAt: "2026-07-09T15:01:00.000Z",
  messages: [
    {
      author: "U_PRODUCT",
      timestamp: "1783612800.000100",
      text:
        "The next API release makes private metadata filtering available to staff users with permission.",
      permalink: "https://example.slack.com/archives/C123/p1783612800000100",
    },
    {
      author: "U_RELEASE",
      timestamp: "1783612830.000150",
      text:
        "Release note is up: https://github.com/example/api/releases/tag/v2.4.0",
    },
    {
      author: "U_DOCS",
      timestamp: "1783612860.000200",
      text: "@docs-agent check docs impact",
    },
  ],
  sourceSummary:
    "Slack thread says private metadata filtering is becoming permission-bound public API behavior.",
  extractedClaims: ["Private metadata filtering is available to staff users with permission."],
  likelyDocsConcepts: ["metadata filtering"],
  likelyDocsPages: ["docs/api-usage/metadata.mdx"],
  productSurfaces: ["GraphQL API"],
  publicDocsImpact: "substantive",
  sourceEvidence: "available",
  currentDocsState: "not-run",
  evidence: [
    {
      kind: "release",
      summary: "Linked release note confirms the API behavior changed.",
      url: "https://github.com/example/api/releases/tag/v2.4.0",
    },
  ],
});

assert.equal(sourceBacked.created, true);
assert.equal(sourceBacked.externalContext.type, "communication-thread");
assert.equal(sourceBacked.externalContext.provider, "slack");
assert.equal(sourceBacked.externalContext.channelId, "C123");
assert.equal(sourceBacked.externalContext.threadTs, "1783612800.000100");
assert.deepEqual(sourceBacked.externalContext.authors, [
  "U_PRODUCT",
  "U_RELEASE",
  "U_DOCS",
]);
assert.equal(sourceBacked.decision.decision, "needs-docs-verification");
assert.equal(sourceBacked.shouldVerifyCurrentDocs, true);
assert.equal(sourceBacked.verificationStatus.state, "blocked");
assert.match(sourceBacked.verificationStatus.reason, /workspace setup is not ready/);
assert.equal(sourceBacked.signal.status, "captured");
assert.equal(sourceBacked.signal.sources[0]?.kind, "slack-thread");
assert.equal(sourceBacked.signal.sources[0]?.providerId, "C123:1783612800.000100");
assert.equal(
  sourceBacked.signal.sources[0]?.sourceText?.includes("@docs-agent check docs impact"),
  true,
);
assert.equal(sourceBacked.signal.sourceSummary.includes("Slack thread"), true);

const duplicate = await captureSlackDocsSignal({
  channelId: "C123",
  threadTs: "1783612800.000100",
  messages: [
    {
      author: "U_DOCS",
      timestamp: "1783612860.000200",
      text: "@docs-agent check docs impact again",
    },
  ],
  sourceSummary: "Duplicate Slack mention for the same thread.",
  publicDocsImpact: "substantive",
  sourceEvidence: "available",
  currentDocsState: "not-run",
});

assert.equal(duplicate.created, false);
assert.equal(duplicate.signal.id, sourceBacked.signal.id);

const alreadyCovered = await captureSlackDocsSignal({
  channelId: "C456",
  channelName: "release-readiness",
  threadTs: "1783616400.000100",
  permalink: "https://example.slack.com/archives/C456/p1783616400000100",
  capturedAt: "2026-07-09T16:01:00.000Z",
  messages: [
    {
      author: "U_ENGINEER",
      timestamp: "1783616400.000100",
      text: "The staged release keeps sandbox API limits at 120 requests per minute.",
    },
    {
      author: "U_DOCS",
      timestamp: "1783616460.000200",
      text: "@docs-agent verify current docs",
    },
  ],
  sourceSummary:
    "Slack thread asks whether sandbox API rate limit docs already cover the release.",
  extractedClaims: ["Sandbox API rate limits remain 120 requests per minute."],
  likelyDocsConcepts: ["API rate limits"],
  likelyDocsPages: ["docs/api-usage/usage-limits.mdx"],
  productSurfaces: ["Saleor Cloud"],
  publicDocsImpact: "substantive",
  sourceEvidence: "available",
  currentDocsState: "already-covered",
  evidence: [
    {
      kind: "working-docs",
      summary: "Current docs already state the sandbox limit is 120 requests per minute.",
      source: "docs/api-usage/usage-limits.mdx",
    },
  ],
});

assert.equal(alreadyCovered.decision.decision, "already-covered");
assert.equal(alreadyCovered.verificationStatus.state, "completed");
assert.equal(alreadyCovered.signal.status, "closed-already-covered");
assert.equal(alreadyCovered.signal.events[0]?.actor, "docs-agent:slack-intake");

const skipped = await captureSlackDocsSignal({
  channelId: "C789",
  channelName: "internal-rollout",
  threadTs: "1783620000.000100",
  capturedAt: "2026-07-09T17:01:00.000Z",
  messages: [
    {
      author: "U_SUPPORT",
      timestamp: "1783620000.000100",
      text: "The 180 rpm value was only for a private staging load test.",
    },
    {
      author: "U_DOCS",
      timestamp: "1783620060.000200",
      text: "@docs-agent does this need docs?",
    },
  ],
  sourceSummary: "Slack thread says a staging-only rate limit changed internally.",
  publicDocsImpact: "internal-only",
  sourceEvidence: "not-needed",
  currentDocsState: "not-run",
  skippedVerificationReason:
    "The thread says the change is staging-only and not customer-facing.",
});

assert.equal(skipped.decision.decision, "verification-skipped");
assert.equal(skipped.shouldVerifyCurrentDocs, false);
assert.equal(skipped.verificationStatus.state, "not-needed");
assert.equal(skipped.signal.status, "verification-skipped");
assert.match(skipped.replyGuidance.join("\n"), /skipped-verification reason/);

await rm(tempRoot, { recursive: true, force: true });

console.log("Slack docs-signal checks passed.");
