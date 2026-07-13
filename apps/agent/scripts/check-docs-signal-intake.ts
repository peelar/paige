import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDocsAgentDatabase } from "@docs-agent/control-plane/testing";
import { captureLinearDocsSignal } from "../agent/lib/linear-docs-signal";
import { captureSlackDocsSignal } from "../agent/lib/slack-docs-signal";

const scenarios = [
  {
    id: "not-relevant",
    publicDocsImpact: "none",
    sourceEvidence: "not-needed",
    currentDocsState: "not-run",
    expectedDecision: "not-docs-relevant",
    expectedStatus: "closed-not-docs-relevant",
    expectedVerificationState: "not-needed",
  },
  {
    id: "needs-maintainer",
    publicDocsImpact: "unclear",
    sourceEvidence: "not-needed",
    currentDocsState: "not-run",
    expectedDecision: "needs-maintainer-answer",
    expectedStatus: "needs-maintainer-answer",
    expectedVerificationState: "blocked",
  },
  {
    id: "needs-source",
    publicDocsImpact: "substantive",
    sourceEvidence: "missing",
    currentDocsState: "not-run",
    missingEvidence: ["Source commit or release note confirming the behavior."],
    expectedDecision: "needs-source-evidence",
    expectedStatus: "needs-source-evidence",
    expectedVerificationState: "blocked",
  },
  {
    id: "verification-skipped",
    publicDocsImpact: "internal-only",
    sourceEvidence: "not-needed",
    currentDocsState: "not-run",
    skippedVerificationReason: "The change is limited to a private load test.",
    expectedDecision: "verification-skipped",
    expectedStatus: "verification-skipped",
    expectedVerificationState: "not-needed",
  },
  {
    id: "needs-verification",
    publicDocsImpact: "substantive",
    sourceEvidence: "available",
    currentDocsState: "not-run",
    evidence: [releaseEvidence()],
    expectedDecision: "needs-docs-verification",
    expectedStatus: "captured",
    expectedVerificationState: "blocked",
  },
  {
    id: "already-covered",
    publicDocsImpact: "substantive",
    sourceEvidence: "available",
    currentDocsState: "already-covered",
    evidence: [releaseEvidence(), workingDocsEvidence()],
    expectedDecision: "already-covered",
    expectedStatus: "closed-already-covered",
    expectedVerificationState: "completed",
  },
  {
    id: "likely-stale",
    publicDocsImpact: "substantive",
    sourceEvidence: "available",
    currentDocsState: "likely-stale",
    evidence: [releaseEvidence(), workingDocsEvidence()],
    expectedDecision: "likely-stale",
    expectedStatus: "docs-verified",
    expectedVerificationState: "completed",
  },
  {
    id: "patch-recommended",
    publicDocsImpact: "substantive",
    sourceEvidence: "available",
    currentDocsState: "patch-recommended",
    evidence: [releaseEvidence(), workingDocsEvidence()],
    expectedDecision: "docs-patch-recommended",
    expectedStatus: "docs-verified",
    expectedVerificationState: "completed",
  },
  {
    id: "changelog-only",
    publicDocsImpact: "substantive",
    sourceEvidence: "available",
    currentDocsState: "changelog-only",
    evidence: [releaseEvidence(), workingDocsEvidence()],
    expectedDecision: "changelog-only",
    expectedStatus: "docs-verified",
    expectedVerificationState: "completed",
  },
] as const;

const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-provider-intake-"));
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "signals.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

try {
  await migrateDocsAgentDatabase();

  for (const scenario of scenarios) {
    const sourceSummary = `Equivalent provider-neutral intake scenario: ${scenario.id}.`;
    const common = {
      sourceSummary,
      extractedClaims: ["The same product signal reached both providers."],
      likelyDocsConcepts: ["provider-neutral intake"],
      likelyDocsPages: ["docs/example.mdx"],
      productSurfaces: ["GraphQL API"],
      missingEvidence: "missingEvidence" in scenario
        ? [...scenario.missingEvidence]
        : [],
      uncertainty: [],
      priority: 50,
      publicDocsImpact: scenario.publicDocsImpact,
      sourceEvidence: scenario.sourceEvidence,
      currentDocsState: scenario.currentDocsState,
      skippedVerificationReason: "skippedVerificationReason" in scenario
        ? scenario.skippedVerificationReason
        : undefined,
      evidence: "evidence" in scenario ? [...scenario.evidence] : [],
      links: [],
    };
    const slack = await captureSlackDocsSignal({
      ...common,
      channelId: `C_${scenario.id.toUpperCase().replaceAll("-", "_")}`,
      channelName: "docs-signals",
      threadTs: `1783771200.${scenario.id.length.toString().padStart(6, "0")}`,
      permalink: `https://example.slack.com/archives/C_TEST/p${scenario.id.length}`,
      messages: [
        {
          author: "maintainer@example.com",
          timestamp: "2026-07-11T12:00:00.000Z",
          text: sourceSummary,
        },
      ],
    });
    const linear = await captureLinearDocsSignal({
      ...common,
      agentSessionId: `session_${scenario.id}`,
      agentSessionUrl: `https://linear.app/acme/agent/session_${scenario.id}`,
      issueId: `issue_${scenario.id}`,
      issueIdentifier: `DOC-${scenario.id.toUpperCase()}`,
      issueTitle: sourceSummary,
      issueUrl: `https://linear.app/acme/issue/DOC-${scenario.id}/${scenario.id}`,
      comments: [
        {
          author: "maintainer@example.com",
          timestamp: "2026-07-11T12:00:00.000Z",
          text: sourceSummary,
        },
      ],
    });

    assert.equal(slack.decision.decision, scenario.expectedDecision);
    assert.equal(linear.decision.decision, scenario.expectedDecision);
    assert.deepEqual(decisionSemantics(slack.decision), decisionSemantics(linear.decision));
    assert.deepEqual(slack.decision.evidence.slice(1), linear.decision.evidence.slice(1));

    assert.equal(slack.signal.status, scenario.expectedStatus);
    assert.equal(linear.signal.status, scenario.expectedStatus);
    assert.equal(slack.signal.events.length, 1);
    assert.equal(linear.signal.events.length, 1);
    assert.equal(slack.signal.events[0]?.toStatus, scenario.expectedStatus);
    assert.equal(linear.signal.events[0]?.toStatus, scenario.expectedStatus);
    assert.equal(slack.signal.events[0]?.actor, "docs-agent:slack-intake");
    assert.equal(linear.signal.events[0]?.actor, "docs-agent:linear-intake");

    assert.equal(slack.shouldVerifyCurrentDocs, linear.shouldVerifyCurrentDocs);
    assert.deepEqual(slack.verificationStatus, linear.verificationStatus);
    assert.equal(slack.verificationStatus.state, scenario.expectedVerificationState);

    assert.equal(slack.externalContext.provider, "slack");
    assert.equal(linear.externalContext.provider, "linear");
    assert.equal(slack.signal.sourceKind, "slack-thread");
    assert.equal(linear.signal.sourceKind, "linear-issue");
    assert.equal(slack.signal.sources[0]?.provider, "slack");
    assert.equal(linear.signal.sources[0]?.provider, "linear");
    assert.match(slack.signal.sources[0]?.sourceText ?? "", /maintainer@example\.com/);
    assert.match(linear.signal.sources[0]?.sourceText ?? "", /Issue: DOC-/);
    assert.equal(slack.signal.links[0]?.kind, "slack-thread");
    assert.equal(linear.signal.links[0]?.kind, "linear-issue");

    assert.match(slack.replyGuidance[0] ?? "", /Slack thread/);
    assert.match(linear.replyGuidance[0] ?? "", /Linear Agent Activities/);
    assert.deepEqual(slack.replyGuidance.slice(1), linear.replyGuidance.slice(1));
    if (scenario.expectedDecision === "needs-source-evidence") {
      assert.match(slack.replyGuidance.join("\n"), /current docs were not verified/);
    }
    assert.match(slack.replyGuidance.join("\n"), /no patch was prepared/);
    assert.match(slack.replyGuidance.join("\n"), /no pull request was published/);

    const slackEventContext = eventExternalContext(slack.signal.events[0]?.metadata);
    const linearEventContext = eventExternalContext(linear.signal.events[0]?.metadata);
    assert.equal(slackEventContext.provider, "slack");
    assert.equal(linearEventContext.provider, "linear");
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

for (const adapterPath of [
  new URL("../agent/lib/slack-docs-signal.ts", import.meta.url),
  new URL("../agent/lib/linear-docs-signal.ts", import.meta.url),
]) {
  const source = await readFile(adapterPath, "utf8");
  for (const sharedOwner of [
    "planDocsImpactDecision",
    "statusForDecision",
    "buildVerificationStatus",
    "getSetupStatus",
    "captureDocsSignal",
  ]) {
    assert.equal(
      source.includes(sharedOwner),
      false,
      `${sharedOwner} must remain behind the provider-neutral intake service.`,
    );
  }
  assert.equal(source.includes("captureProviderDocsSignal"), true);
}

console.log("Provider-neutral docs signal intake checks passed.");

function releaseEvidence() {
  return {
    kind: "release" as const,
    summary: "A shared release note confirms the public behavior.",
    url: "https://github.com/example/api/releases/tag/v2.4.0",
  };
}

function workingDocsEvidence() {
  return {
    kind: "working-docs" as const,
    summary: "The same working documentation page was inspected.",
    source: "docs/example.mdx",
  };
}

function decisionSemantics(decision: {
  decision: string;
  reason: string;
  missingEvidence: string[];
  currentDocsVerification: unknown;
  recommendedNextAction: string;
  uncertainty: string[];
}) {
  return {
    decision: decision.decision,
    reason: decision.reason,
    missingEvidence: decision.missingEvidence,
    currentDocsVerification: decision.currentDocsVerification,
    recommendedNextAction: decision.recommendedNextAction,
    uncertainty: decision.uncertainty,
  };
}

function eventExternalContext(metadata: unknown): Record<string, unknown> {
  assert.equal(isRecord(metadata), true);
  const externalContext = isRecord(metadata) ? metadata.externalContext : undefined;
  assert.equal(isRecord(externalContext), true);
  return externalContext as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
