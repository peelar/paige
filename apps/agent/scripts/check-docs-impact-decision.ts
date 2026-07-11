import assert from "node:assert/strict";

import {
  mapLegacyImpactDecision,
  planDocsImpactDecision,
  shouldVerifyCurrentDocs,
} from "../agent/lib/docs-impact-decision.js";

const skipped = planDocsImpactDecision({
  signalSummary: "Internal staging rate limit changed during a load test.",
  publicDocsImpact: "internal-only",
  skippedVerificationReason:
    "The signal is explicitly internal-only and should not trigger docs inspection.",
  evidence: [
    {
      kind: "signal-source",
      summary: "Slack thread says the change is staging-only.",
      source: "slack",
    },
  ],
});

assert.equal(skipped.decision, "verification-skipped");
assert.equal(skipped.currentDocsVerification.state, "not-needed");
assert.equal(skipped.recommendedNextAction, "close-signal");
assert.equal(shouldVerifyCurrentDocs(skipped), false);

const needsVerification = planDocsImpactDecision({
  signalSummary: "Release note confirms a customer-visible API behavior change.",
  publicDocsImpact: "substantive",
  sourceEvidence: "available",
  evidence: [
    {
      kind: "release",
      summary: "Release note confirms the API behavior changed.",
      url: "https://github.com/example/product/releases/tag/v1.2.3",
    },
  ],
});

assert.equal(needsVerification.decision, "needs-docs-verification");
assert.equal(needsVerification.currentDocsVerification.state, "needed");
assert.equal(needsVerification.recommendedNextAction, "verify-current-docs");
assert.equal(shouldVerifyCurrentDocs(needsVerification), true);

const needsSourceEvidence = planDocsImpactDecision({
  signalSummary: "Slack says a public API changed, but no source or release evidence is linked.",
  publicDocsImpact: "substantive",
  sourceEvidence: "missing",
  evidence: [
    {
      kind: "signal-source",
      summary: "Slack thread claims the API behavior changed.",
      source: "slack",
    },
  ],
});

assert.equal(needsSourceEvidence.decision, "needs-source-evidence");
assert.equal(needsSourceEvidence.currentDocsVerification.state, "blocked");
assert.match(
  needsSourceEvidence.currentDocsVerification.reason,
  /discussion context alone is not enough proof/,
);

const alreadyCovered = planDocsImpactDecision({
  signalSummary: "Verified docs already describe the release behavior.",
  publicDocsImpact: "substantive",
  sourceEvidence: "available",
  currentDocsState: "already-covered",
  evidence: [
    {
      kind: "working-docs",
      summary: "The existing guide already documents the behavior.",
      source: "docs/api-usage/metadata.mdx",
    },
  ],
});

assert.equal(alreadyCovered.decision, "already-covered");
assert.equal(alreadyCovered.currentDocsVerification.state, "completed");
assert.equal(alreadyCovered.currentDocsVerification.evidence.length, 1);

assert.equal(mapLegacyImpactDecision("docs-patch"), "docs-patch-recommended");
assert.equal(mapLegacyImpactDecision("no-docs-change"), "already-covered");
assert.equal(mapLegacyImpactDecision("changelog-only"), "changelog-only");
assert.equal(mapLegacyImpactDecision("ask-maintainer"), "needs-maintainer-answer");

console.log("Docs impact decision checks passed.");
