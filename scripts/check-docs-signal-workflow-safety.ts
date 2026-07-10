import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-signal-safety-"));
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "signal-safety.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

const { captureSlackDocsSignal } = await import("../agent/lib/slack-docs-signal.js");
const { captureLinearDocsSignal } = await import("../agent/lib/linear-docs-signal.js");
const { getDocsSignal } = await import("../agent/lib/docs-signals.js");
const {
  SignalPatchHandoffError,
  assertSignalCanEnterPatchHandoff,
} = await import("../agent/lib/docs-signal-patch-handoff.js");

const slackVerificationRequired = await captureSlackDocsSignal({
  teamId: "T_DOCS",
  channelId: "C_DOCS_API",
  channelName: "api-docs",
  threadTs: "1783612800.000100",
  triggeringMessageTs: "1783612860.000200",
  permalink: "https://example.slack.com/archives/C_DOCS_API/p1783612800000100",
  capturedAt: "2026-07-09T15:01:00.000Z",
  messages: [
    {
      author: "U_PRODUCT",
      timestamp: "1783612800.000100",
      text:
        "The next API release makes private metadata filtering available to staff users with permission.",
      permalink: "https://example.slack.com/archives/C_DOCS_API/p1783612800000100",
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

assert.equal(slackVerificationRequired.signal.sourceKind, "slack-thread");
assert.equal(slackVerificationRequired.decision.decision, "needs-docs-verification");
assert.equal(slackVerificationRequired.shouldVerifyCurrentDocs, true);
assert.equal(slackVerificationRequired.verificationStatus.state, "blocked");
assert.match(
  slackVerificationRequired.verificationStatus.reason,
  /workspace setup is not ready/,
);
assert.equal(slackVerificationRequired.signal.status, "captured");
assert.equal(slackVerificationRequired.signal.artifacts.length, 0);
assert.throws(
  () => assertSignalCanEnterPatchHandoff(slackVerificationRequired.signal, "prepare-patch"),
  SignalPatchHandoffError,
);

const persistedSlackSignal = await getDocsSignal({
  id: slackVerificationRequired.signal.id,
});
assert.equal(
  persistedSlackSignal.sources[0]?.sourceText?.includes("@docs-agent check docs impact"),
  true,
);
assert.equal(
  persistedSlackSignal.sources[0]?.sourceText?.includes("Release note is up"),
  true,
);

const slackSkipped = await captureSlackDocsSignal({
  channelId: "C_DOCS_INTERNAL",
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

assert.equal(slackSkipped.decision.decision, "verification-skipped");
assert.equal(slackSkipped.shouldVerifyCurrentDocs, false);
assert.equal(slackSkipped.verificationStatus.state, "not-needed");
assert.equal(slackSkipped.signal.status, "verification-skipped");
assert.match(slackSkipped.replyGuidance.join("\n"), /skipped-verification reason/);
assert.throws(
  () => assertSignalCanEnterPatchHandoff(slackSkipped.signal, "prepare-patch"),
  SignalPatchHandoffError,
);

const linearNeedsSource = await captureLinearDocsSignal({
  organizationId: "org_docs",
  agentSessionId: "session_docs_123",
  agentSessionUrl: "https://linear.app/acme/agent/session_docs_123",
  issueId: "issue_docs_123",
  issueIdentifier: "DOC-123",
  issueTitle: "Document private metadata filtering",
  issueUrl: "https://linear.app/acme/issue/DOC-123/document-private-metadata-filtering",
  labels: ["api", "docs-impact"],
  project: "API v2.4",
  status: "Triage",
  promptContext: "Check whether this public API change needs docs.",
  comments: [
    {
      author: "eng@example.com",
      timestamp: "2026-07-09T15:00:00.000Z",
      text: "We intend to expose permission-bound private metadata filtering publicly.",
      url: "https://linear.app/acme/issue/DOC-123#comment-1",
    },
    {
      author: "docs@example.com",
      timestamp: "2026-07-09T15:02:00.000Z",
      text: "@docs-agent check docs impact once source evidence exists.",
    },
  ],
  capturedAt: "2026-07-09T15:03:00.000Z",
  sourceSummary:
    "Linear issue says private metadata filtering may become permission-bound public API behavior, but no source or release evidence is linked.",
  extractedClaims: ["Private metadata filtering is available to staff users with permission."],
  likelyDocsConcepts: ["metadata filtering"],
  likelyDocsPages: ["docs/api-usage/metadata.mdx"],
  productSurfaces: ["GraphQL API"],
  publicDocsImpact: "substantive",
  sourceEvidence: "missing",
  currentDocsState: "not-run",
  missingEvidence: ["Source commit or release note confirming the public behavior change."],
});

assert.equal(linearNeedsSource.signal.sourceKind, "linear-issue");
assert.equal(linearNeedsSource.decision.decision, "needs-source-evidence");
assert.equal(linearNeedsSource.shouldVerifyCurrentDocs, false);
assert.equal(linearNeedsSource.signal.status, "needs-source-evidence");
assert.deepEqual(linearNeedsSource.signal.missingEvidence, [
  "Source commit or release note confirming the public behavior change.",
]);
assert.match(
  linearNeedsSource.decision.currentDocsVerification.reason,
  /discussion context alone is not enough proof/,
);
assert.throws(
  () => assertSignalCanEnterPatchHandoff(linearNeedsSource.signal, "prepare-patch"),
  /source evidence is still insufficient/,
);

const linearPatchRecommended = await captureLinearDocsSignal({
  agentSessionId: "session_docs_456",
  issueId: "issue_docs_456",
  issueIdentifier: "DOC-456",
  issueTitle: "Patch stale metadata docs",
  issueUrl: "https://linear.app/acme/issue/DOC-456/patch-stale-metadata-docs",
  labels: ["api", "docs-impact"],
  status: "Ready for docs",
  promptContext: "Use the completed docs verification to prepare the patch later.",
  comments: [
    {
      author: "docs@example.com",
      timestamp: "2026-07-09T18:00:00.000Z",
      text: "Current metadata docs were checked and are stale.",
    },
  ],
  sourceSummary:
    "Linear issue carries completed verification showing metadata docs are stale.",
  extractedClaims: ["Private metadata filtering is permission-bound."],
  likelyDocsConcepts: ["metadata filtering"],
  likelyDocsPages: ["docs/api-usage/metadata.mdx"],
  productSurfaces: ["GraphQL API"],
  publicDocsImpact: "substantive",
  sourceEvidence: "available",
  currentDocsState: "patch-recommended",
  evidence: [
    {
      kind: "working-docs",
      summary: "Current metadata docs do not mention permission-bound private filtering.",
      source: "docs/api-usage/metadata.mdx",
    },
  ],
});

assert.equal(linearPatchRecommended.decision.decision, "docs-patch-recommended");
assert.equal(linearPatchRecommended.shouldVerifyCurrentDocs, false);
assert.equal(linearPatchRecommended.signal.status, "docs-verified");
assert.doesNotThrow(() =>
  assertSignalCanEnterPatchHandoff(linearPatchRecommended.signal, "prepare-patch"),
);
assert.equal(linearPatchRecommended.signal.artifacts.length, 0);
assert.equal(
  linearPatchRecommended.signal.events[0]?.actor,
  "docs-agent:linear-intake",
);

await rm(tempRoot, { recursive: true, force: true });

console.log("Docs signal workflow safety checks passed.");
