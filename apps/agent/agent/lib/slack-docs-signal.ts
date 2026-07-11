import { z } from "zod";

import {
  docsImpactDecisionRecordSchema,
  docsImpactEvidenceSchema,
  docsImpactTriageInputSchema,
  planDocsImpactDecision,
  shouldVerifyCurrentDocs,
  type DocsImpactDecisionRecord,
} from "./docs-impact-decision.js";
import {
  createDocsSignal,
  docsSignalDetailSchema,
  docsSignalLinkInputSchema,
  transitionDocsSignalLifecycle,
  type DocsSignalStatus,
} from "./docs-signals.js";
import { getSetupStatus } from "./setup-state.js";

const slackThreadMessageSchema = z.object({
  author: z.string().trim().min(1),
  text: z.string().trim().min(1),
  timestamp: z.string().trim().min(1),
  permalink: z.string().url().optional(),
});

const communicationThreadContextSchema = z.object({
  type: z.literal("communication-thread"),
  provider: z.literal("slack"),
  teamId: z.string().optional(),
  channelId: z.string(),
  channelName: z.string().optional(),
  threadTs: z.string(),
  triggeringMessageTs: z.string().optional(),
  permalink: z.string().url().optional(),
  authors: z.array(z.string()),
  messageCount: z.number().int().min(1),
  firstMessageAt: z.string(),
  lastMessageAt: z.string(),
  capturedAt: z.string(),
});

const verificationStatusSchema = z.object({
  required: z.boolean(),
  setupReady: z.boolean(),
  state: z.enum(["not-needed", "needed", "blocked", "completed"]),
  reason: z.string(),
});

export const captureSlackDocsSignalInputSchema = z.object({
  teamId: z.string().trim().min(1).optional(),
  channelId: z.string().trim().min(1),
  channelName: z.string().trim().min(1).optional(),
  threadTs: z.string().trim().min(1),
  triggeringMessageTs: z.string().trim().min(1).optional(),
  permalink: z.string().url().optional(),
  capturedAt: z.string().trim().min(1).optional(),
  messages: z.array(slackThreadMessageSchema).min(1),
  sourceSummary: z.string().trim().min(1),
  extractedClaims: z.array(z.string().trim().min(1)).default([]),
  likelyDocsConcepts: z.array(z.string().trim().min(1)).default([]),
  likelyDocsPages: z.array(z.string().trim().min(1)).default([]),
  productSurfaces: z.array(z.string().trim().min(1)).default([]),
  missingEvidence: z.array(z.string().trim().min(1)).default([]),
  uncertainty: z.array(z.string().trim().min(1)).default([]),
  priority: z.number().int().min(0).max(100).default(50),
  publicDocsImpact: docsImpactTriageInputSchema.shape.publicDocsImpact,
  sourceEvidence: docsImpactTriageInputSchema.shape.sourceEvidence,
  currentDocsState: docsImpactTriageInputSchema.shape.currentDocsState,
  skippedVerificationReason:
    docsImpactTriageInputSchema.shape.skippedVerificationReason,
  evidence: z.array(docsImpactEvidenceSchema).default([]),
  links: z.array(docsSignalLinkInputSchema).default([]),
});

export const captureSlackDocsSignalResultSchema = z.object({
  created: z.boolean(),
  signal: docsSignalDetailSchema,
  externalContext: communicationThreadContextSchema,
  decision: docsImpactDecisionRecordSchema,
  shouldVerifyCurrentDocs: z.boolean(),
  verificationStatus: verificationStatusSchema,
  replyGuidance: z.array(z.string()),
});

export type CaptureSlackDocsSignalInput = z.infer<
  typeof captureSlackDocsSignalInputSchema
>;
export type CaptureSlackDocsSignalResult = z.infer<
  typeof captureSlackDocsSignalResultSchema
>;

export async function captureSlackDocsSignal(
  input: CaptureSlackDocsSignalInput,
): Promise<CaptureSlackDocsSignalResult> {
  const parsed = captureSlackDocsSignalInputSchema.parse(input);
  const capturedAt = parsed.capturedAt ?? new Date().toISOString();
  const externalContext = buildCommunicationThreadContext(parsed, capturedAt);
  const evidence = [
    buildSlackEvidence(parsed),
    ...parsed.evidence,
  ];
  const decision = planDocsImpactDecision({
    signalSummary: parsed.sourceSummary,
    publicDocsImpact: parsed.publicDocsImpact,
    sourceEvidence: parsed.sourceEvidence,
    currentDocsState: parsed.currentDocsState,
    evidence,
    missingEvidence: parsed.missingEvidence,
    uncertainty: parsed.uncertainty,
    skippedVerificationReason: parsed.skippedVerificationReason,
  });
  const desiredStatus = statusForDecision(decision);

  const created = await createDocsSignal({
    source: {
      kind: "slack-thread",
      provider: "slack",
      providerId: `${parsed.channelId}:${parsed.threadTs}`,
      permalink: parsed.permalink,
      title: parsed.sourceSummary,
      authors: externalContext.authors,
      sourceText: formatSlackThreadSourceText(parsed.messages),
      sourceCreatedAt: externalContext.firstMessageAt,
      sourceUpdatedAt: externalContext.lastMessageAt,
      capturedAt,
      metadata: {
        externalContextType: "communication-thread",
        teamId: parsed.teamId,
        channelId: parsed.channelId,
        channelName: parsed.channelName,
        threadTs: parsed.threadTs,
        triggeringMessageTs: parsed.triggeringMessageTs,
        messagePermalinks: parsed.messages
          .map((message) => message.permalink)
          .filter((permalink): permalink is string => permalink !== undefined),
        messageCount: parsed.messages.length,
      },
    },
    sourceSummary: parsed.sourceSummary,
    extractedClaims: parsed.extractedClaims,
    likelyDocsConcepts: parsed.likelyDocsConcepts,
    likelyDocsPages: parsed.likelyDocsPages,
    productSurfaces: parsed.productSurfaces,
    missingEvidence: parsed.missingEvidence,
    uncertainty: parsed.uncertainty.join(" ") || undefined,
    priority: parsed.priority,
    links: [
      ...slackThreadLinks(parsed),
      ...parsed.links,
    ],
    artifacts: [],
  });

  const updatedSignal = await transitionDocsSignalLifecycle({
    id: created.signal.id,
    status: desiredStatus,
    reason: decision.reason,
    actor: "docs-agent:slack-intake",
    missingEvidence: decision.missingEvidence,
    uncertainty: decision.uncertainty.join(" ") || undefined,
    links: [],
    artifacts: [],
    metadata: {
      decision: decision.decision,
      recommendedNextAction: decision.recommendedNextAction,
      currentDocsVerification: decision.currentDocsVerification,
      shouldVerifyCurrentDocs: shouldVerifyCurrentDocs(decision),
      externalContext,
    },
  }, "intake");

  const setupStatus = await getSetupStatus();
  const verificationStatus = buildVerificationStatus(
    decision,
    setupStatus.docsMaintenanceReady,
    setupStatus.issues.map((issue) => issue.message),
  );

  return captureSlackDocsSignalResultSchema.parse({
    created: created.created,
    signal: updatedSignal,
    externalContext,
    decision,
    shouldVerifyCurrentDocs: shouldVerifyCurrentDocs(decision),
    verificationStatus,
    replyGuidance: buildReplyGuidance(decision, verificationStatus),
  });
}

function buildCommunicationThreadContext(
  input: CaptureSlackDocsSignalInput,
  capturedAt: string,
): z.infer<typeof communicationThreadContextSchema> {
  const messages = [...input.messages].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );

  return communicationThreadContextSchema.parse({
    type: "communication-thread",
    provider: "slack",
    teamId: input.teamId,
    channelId: input.channelId,
    channelName: input.channelName,
    threadTs: input.threadTs,
    triggeringMessageTs: input.triggeringMessageTs,
    permalink: input.permalink,
    authors: [...new Set(messages.map((message) => message.author))],
    messageCount: messages.length,
    firstMessageAt: messages[0]?.timestamp,
    lastMessageAt: messages.at(-1)?.timestamp,
    capturedAt,
  });
}

function buildSlackEvidence(
  input: CaptureSlackDocsSignalInput,
): z.infer<typeof docsImpactEvidenceSchema> {
  return docsImpactEvidenceSchema.parse({
    kind: "signal-source",
    summary: `Slack thread ${input.channelId}/${input.threadTs} was captured as structured communication-thread context.`,
    source: "slack",
    url: input.permalink,
  });
}

function formatSlackThreadSourceText(
  messages: z.infer<typeof slackThreadMessageSchema>[],
): string {
  return messages
    .map((message) => `[${message.timestamp}] ${message.author}: ${message.text}`)
    .join("\n");
}

function slackThreadLinks(
  input: CaptureSlackDocsSignalInput,
): z.infer<typeof docsSignalLinkInputSchema>[] {
  if (input.permalink === undefined) return [];

  return [
    {
      kind: "slack-thread",
      label: input.channelName === undefined
        ? `Slack thread ${input.channelId}/${input.threadTs}`
        : `Slack thread #${input.channelName}`,
      url: input.permalink,
      externalId: `${input.channelId}:${input.threadTs}`,
      metadata: {
        channelId: input.channelId,
        threadTs: input.threadTs,
      },
    },
  ];
}

function statusForDecision(
  decision: DocsImpactDecisionRecord,
): DocsSignalStatus {
  switch (decision.decision) {
    case "not-docs-relevant":
      return "closed-not-docs-relevant";
    case "needs-maintainer-answer":
      return "needs-maintainer-answer";
    case "needs-source-evidence":
      return "needs-source-evidence";
    case "verification-skipped":
      return "verification-skipped";
    case "already-covered":
      return "closed-already-covered";
    case "likely-stale":
    case "docs-patch-recommended":
    case "changelog-only":
      return "docs-verified";
    case "needs-docs-verification":
      return "captured";
  }
}

function buildVerificationStatus(
  decision: DocsImpactDecisionRecord,
  setupReady: boolean,
  setupIssues: string[],
): z.infer<typeof verificationStatusSchema> {
  const required = shouldVerifyCurrentDocs(decision);

  if (decision.currentDocsVerification.state === "completed") {
    return {
      required,
      setupReady,
      state: "completed",
      reason: decision.currentDocsVerification.reason,
    };
  }

  if (required && !setupReady) {
    return {
      required,
      setupReady,
      state: "blocked",
      reason: [
        "Current docs verification is required, but workspace setup is not ready.",
        ...setupIssues,
      ].join(" "),
    };
  }

  return {
    required,
    setupReady,
    state: decision.currentDocsVerification.state,
    reason: decision.currentDocsVerification.reason,
  };
}

function buildReplyGuidance(
  decision: DocsImpactDecisionRecord,
  verificationStatus: z.infer<typeof verificationStatusSchema>,
): string[] {
  const guidance = [
    "Reply in the Slack thread with the captured signal summary, decision, evidence, uncertainty, verification status, and next action.",
  ];

  if (decision.decision === "needs-source-evidence") {
    guidance.push("Ask for source, release, or maintainer-confirmed evidence before making public docs claims.");
  }

  if (decision.decision === "verification-skipped") {
    guidance.push("Include the explicit skipped-verification reason.");
  }

  if (verificationStatus.state === "blocked") {
    guidance.push("Use setup mode to collect the working documentation repository before docs verification.");
  } else if (verificationStatus.required) {
    guidance.push("Verify current docs against the configured working documentation repository before deciding whether docs are stale.");
  }

  guidance.push("Do not prepare a patch, publish, or open a draft PR without a later explicit approval-gated handoff.");

  return guidance;
}
