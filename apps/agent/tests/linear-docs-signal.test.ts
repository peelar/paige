import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "vitest";

test("linear docs signal", async () => {
const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-linear-signal-"));
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "linear-signals.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

const { migrateDocsAgentDatabase } = await import(
  "@docs-agent/control-plane/testing"
);
await migrateDocsAgentDatabase();

const { captureLinearDocsSignal } = await import("../agent/lib/linear-docs-signal");

const sourceBacked = await captureLinearDocsSignal({
  organizationId: "org_123",
  agentSessionId: "session_123",
  agentSessionUrl: "https://linear.app/acme/agent/session_123",
  agentActivityId: "activity_123",
  issueId: "issue_123",
  issueIdentifier: "DOC-123",
  issueTitle: "Document private metadata filtering",
  issueUrl: "https://linear.app/acme/issue/DOC-123/document-private-metadata-filtering",
  labels: ["api", "docs-impact"],
  project: "API v2.4",
  status: "In Progress",
  promptContext: "Check whether this public API change needs docs.",
  comments: [
    {
      author: "eng@example.com",
      timestamp: "2026-07-09T15:00:00.000Z",
      text:
        "Release note confirms private metadata filtering is now available to staff users with permission.",
      url: "https://linear.app/acme/issue/DOC-123#comment-1",
    },
    {
      author: "docs@example.com",
      timestamp: "2026-07-09T15:02:00.000Z",
      text: "@docs-agent verify current docs before we ship.",
    },
  ],
  capturedAt: "2026-07-09T15:03:00.000Z",
  sourceSummary:
    "Linear issue says private metadata filtering is becoming permission-bound public API behavior.",
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
assert.equal(sourceBacked.externalContext.type, "issue-tracker-item");
assert.equal(sourceBacked.externalContext.provider, "linear");
assert.equal(sourceBacked.externalContext.organizationId, "org_123");
assert.equal(sourceBacked.externalContext.agentSessionId, "session_123");
assert.equal(sourceBacked.externalContext.issueIdentifier, "DOC-123");
assert.deepEqual(sourceBacked.externalContext.labels, ["api", "docs-impact"]);
assert.equal(sourceBacked.externalContext.project, "API v2.4");
assert.equal(sourceBacked.externalContext.status, "In Progress");
assert.equal(sourceBacked.decision.decision, "needs-docs-verification");
assert.equal(sourceBacked.shouldVerifyCurrentDocs, true);
assert.equal(sourceBacked.verificationStatus.state, "blocked");
assert.match(sourceBacked.verificationStatus.reason, /workspace setup is not ready/);
assert.equal(sourceBacked.signal.status, "captured");
assert.equal(sourceBacked.signal.sources[0]?.kind, "linear-issue");
assert.equal(sourceBacked.signal.sources[0]?.providerId, "issue:issue_123");
assert.equal(
  sourceBacked.signal.sources[0]?.sourceText?.includes("Document private metadata filtering"),
  true,
);
assert.equal(
  sourceBacked.signal.sources[0]?.sourceText?.includes("@docs-agent verify current docs"),
  true,
);

const duplicate = await captureLinearDocsSignal({
  agentSessionId: "session_456",
  issueId: "issue_123",
  issueIdentifier: "DOC-123",
  issueTitle: "Document private metadata filtering",
  sourceSummary: "Duplicate Linear Agent Session for the same issue.",
  publicDocsImpact: "substantive",
  sourceEvidence: "available",
  currentDocsState: "not-run",
});

assert.equal(duplicate.created, false);
assert.equal(duplicate.signal.id, sourceBacked.signal.id);

const alreadyCovered = await captureLinearDocsSignal({
  agentSessionId: "session_789",
  issueId: "issue_456",
  issueIdentifier: "DOC-456",
  issueTitle: "Confirm sandbox rate limit docs",
  issueUrl: "https://linear.app/acme/issue/DOC-456/confirm-sandbox-rate-limit-docs",
  labels: ["cloud"],
  status: "Done",
  promptContext: "Verify whether docs already cover this release note.",
  comments: [
    {
      author: "pm@example.com",
      timestamp: "2026-07-09T16:00:00.000Z",
      text: "The release keeps customer-facing sandbox limits at 120 requests per minute.",
    },
  ],
  sourceSummary:
    "Linear issue asks whether sandbox API rate limit docs already cover the release.",
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
assert.equal(alreadyCovered.signal.events[0]?.actor, "docs-agent:linear-intake");

const skipped = await captureLinearDocsSignal({
  agentSessionId: "session_999",
  issueId: "issue_789",
  issueIdentifier: "DOC-789",
  issueTitle: "Internal staging load-test note",
  labels: ["internal"],
  status: "Triage",
  promptContext: "Does this need docs?",
  comments: [
    {
      author: "support@example.com",
      timestamp: "2026-07-09T17:00:00.000Z",
      text: "The 180 rpm value is only for private staging load tests.",
    },
  ],
  sourceSummary: "Linear issue says a staging-only rate limit changed internally.",
  publicDocsImpact: "internal-only",
  sourceEvidence: "not-needed",
  currentDocsState: "not-run",
  skippedVerificationReason:
    "The Linear issue says the change is staging-only and not customer-facing.",
});

assert.equal(skipped.decision.decision, "verification-skipped");
assert.equal(skipped.shouldVerifyCurrentDocs, false);
assert.equal(skipped.verificationStatus.state, "not-needed");
assert.equal(skipped.signal.status, "verification-skipped");
assert.match(skipped.replyGuidance.join("\n"), /skipped-verification reason/);

await rm(tempRoot, { recursive: true, force: true });

console.log("Linear docs-signal checks passed.");
});
