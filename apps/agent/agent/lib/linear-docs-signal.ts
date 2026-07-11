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
  updateDocsSignalLifecycle,
  type DocsSignalStatus,
} from "./docs-signals.js";
import { getSetupStatus } from "./setup-state.js";

const linearCommentSchema = z.object({
  author: z.string().trim().min(1),
  text: z.string().trim().min(1),
  timestamp: z.string().trim().min(1).optional(),
  url: z.string().url().optional(),
});

const issueTrackerItemContextSchema = z.object({
  type: z.literal("issue-tracker-item"),
  provider: z.literal("linear"),
  organizationId: z.string().optional(),
  agentSessionId: z.string(),
  agentSessionUrl: z.string().url().optional(),
  issueId: z.string().optional(),
  issueIdentifier: z.string().optional(),
  issueTitle: z.string().optional(),
  issueUrl: z.string().url().optional(),
  labels: z.array(z.string()),
  project: z.string().optional(),
  status: z.string().optional(),
  authors: z.array(z.string()),
  commentCount: z.number().int().min(0),
  promptCaptured: z.boolean(),
  capturedAt: z.string(),
  sourceCreatedAt: z.string().optional(),
  sourceUpdatedAt: z.string().optional(),
});

const verificationStatusSchema = z.object({
  required: z.boolean(),
  setupReady: z.boolean(),
  state: z.enum(["not-needed", "needed", "blocked", "completed"]),
  reason: z.string(),
});

export const captureLinearDocsSignalInputSchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  agentSessionId: z.string().trim().min(1),
  agentSessionUrl: z.string().url().optional(),
  agentActivityId: z.string().trim().min(1).optional(),
  sourceCommentId: z.string().trim().min(1).optional(),
  issueId: z.string().trim().min(1).optional(),
  issueIdentifier: z.string().trim().min(1).optional(),
  issueTitle: z.string().trim().min(1).optional(),
  issueUrl: z.string().url().optional(),
  labels: z.array(z.string().trim().min(1)).default([]),
  project: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  promptContext: z.string().trim().min(1).optional(),
  comments: z.array(linearCommentSchema).default([]),
  sourceCreatedAt: z.string().trim().min(1).optional(),
  sourceUpdatedAt: z.string().trim().min(1).optional(),
  capturedAt: z.string().trim().min(1).optional(),
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

export const captureLinearDocsSignalResultSchema = z.object({
  created: z.boolean(),
  signal: docsSignalDetailSchema,
  externalContext: issueTrackerItemContextSchema,
  decision: docsImpactDecisionRecordSchema,
  shouldVerifyCurrentDocs: z.boolean(),
  verificationStatus: verificationStatusSchema,
  replyGuidance: z.array(z.string()),
});

export type CaptureLinearDocsSignalInput = z.infer<
  typeof captureLinearDocsSignalInputSchema
>;
export type CaptureLinearDocsSignalResult = z.infer<
  typeof captureLinearDocsSignalResultSchema
>;

export async function captureLinearDocsSignal(
  input: CaptureLinearDocsSignalInput,
): Promise<CaptureLinearDocsSignalResult> {
  const parsed = captureLinearDocsSignalInputSchema.parse(input);
  const capturedAt = parsed.capturedAt ?? new Date().toISOString();
  const externalContext = buildIssueTrackerItemContext(parsed, capturedAt);
  const evidence = [
    buildLinearEvidence(parsed),
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
    status: "captured",
    source: {
      kind: "linear-issue",
      provider: "linear",
      providerId: linearProviderId(parsed),
      permalink: parsed.issueUrl ?? parsed.agentSessionUrl,
      title: parsed.issueIdentifier === undefined
        ? parsed.issueTitle ?? parsed.sourceSummary
        : `${parsed.issueIdentifier}: ${parsed.issueTitle ?? parsed.sourceSummary}`,
      authors: externalContext.authors,
      sourceText: formatLinearIssueSourceText(parsed),
      sourceCreatedAt: externalContext.sourceCreatedAt,
      sourceUpdatedAt: externalContext.sourceUpdatedAt,
      capturedAt,
      metadata: {
        externalContextType: "issue-tracker-item",
        organizationId: parsed.organizationId,
        agentSessionId: parsed.agentSessionId,
        agentActivityId: parsed.agentActivityId,
        sourceCommentId: parsed.sourceCommentId,
        agentSessionUrl: parsed.agentSessionUrl,
        issueId: parsed.issueId,
        issueIdentifier: parsed.issueIdentifier,
        issueTitle: parsed.issueTitle,
        labels: parsed.labels,
        project: parsed.project,
        status: parsed.status,
        commentUrls: parsed.comments
          .map((comment) => comment.url)
          .filter((url): url is string => url !== undefined),
        commentCount: parsed.comments.length,
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
      ...linearIssueLinks(parsed),
      ...parsed.links,
    ],
    artifacts: [],
  });

  const updatedSignal = await updateDocsSignalLifecycle({
    id: created.signal.id,
    status: desiredStatus,
    reason: decision.reason,
    actor: "docs-agent:linear-intake",
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
  });

  const setupStatus = await getSetupStatus();
  const verificationStatus = buildVerificationStatus(
    decision,
    setupStatus.docsMaintenanceReady,
    setupStatus.issues.map((issue) => issue.message),
  );

  return captureLinearDocsSignalResultSchema.parse({
    created: created.created,
    signal: updatedSignal,
    externalContext,
    decision,
    shouldVerifyCurrentDocs: shouldVerifyCurrentDocs(decision),
    verificationStatus,
    replyGuidance: buildReplyGuidance(decision, verificationStatus),
  });
}

function buildIssueTrackerItemContext(
  input: CaptureLinearDocsSignalInput,
  capturedAt: string,
): z.infer<typeof issueTrackerItemContextSchema> {
  return issueTrackerItemContextSchema.parse({
    type: "issue-tracker-item",
    provider: "linear",
    organizationId: input.organizationId,
    agentSessionId: input.agentSessionId,
    agentSessionUrl: input.agentSessionUrl,
    issueId: input.issueId,
    issueIdentifier: input.issueIdentifier,
    issueTitle: input.issueTitle,
    issueUrl: input.issueUrl,
    labels: input.labels,
    project: input.project,
    status: input.status,
    authors: linearAuthors(input),
    commentCount: input.comments.length,
    promptCaptured: input.promptContext !== undefined,
    capturedAt,
    sourceCreatedAt: input.sourceCreatedAt ?? firstCommentTimestamp(input),
    sourceUpdatedAt: input.sourceUpdatedAt ?? lastCommentTimestamp(input),
  });
}

function buildLinearEvidence(
  input: CaptureLinearDocsSignalInput,
): z.infer<typeof docsImpactEvidenceSchema> {
  const label = input.issueIdentifier ?? input.issueId ?? input.agentSessionId;

  return docsImpactEvidenceSchema.parse({
    kind: "signal-source",
    summary: `Linear issue/session ${label} was captured as structured issue-tracker-item context.`,
    source: "linear",
    url: input.issueUrl ?? input.agentSessionUrl,
  });
}

function linearProviderId(input: CaptureLinearDocsSignalInput): string {
  if (input.issueId !== undefined) return `issue:${input.issueId}`;
  if (input.issueIdentifier !== undefined) return `issue-key:${input.issueIdentifier}`;
  return `agent-session:${input.agentSessionId}`;
}

function formatLinearIssueSourceText(input: CaptureLinearDocsSignalInput): string {
  const lines = [];

  if (input.issueIdentifier !== undefined || input.issueTitle !== undefined) {
    lines.push(
      `Issue: ${[input.issueIdentifier, input.issueTitle].filter(Boolean).join(" ")}`,
    );
  }

  if (input.status !== undefined) lines.push(`Status: ${input.status}`);
  if (input.project !== undefined) lines.push(`Project: ${input.project}`);
  if (input.labels.length > 0) lines.push(`Labels: ${input.labels.join(", ")}`);
  if (input.promptContext !== undefined) lines.push(`Prompt: ${input.promptContext}`);

  for (const comment of input.comments) {
    const timestamp = comment.timestamp === undefined ? "unknown-time" : comment.timestamp;
    lines.push(`[${timestamp}] ${comment.author}: ${comment.text}`);
  }

  return lines.join("\n");
}

function linearIssueLinks(
  input: CaptureLinearDocsSignalInput,
): z.infer<typeof docsSignalLinkInputSchema>[] {
  const links: z.infer<typeof docsSignalLinkInputSchema>[] = [];

  if (input.issueUrl !== undefined) {
    links.push({
      kind: "linear-issue",
      label: input.issueIdentifier === undefined
        ? input.issueTitle ?? "Linear issue"
        : `${input.issueIdentifier}: ${input.issueTitle ?? "Linear issue"}`,
      url: input.issueUrl,
      externalId: input.issueId ?? input.issueIdentifier,
      metadata: {
        issueId: input.issueId,
        issueIdentifier: input.issueIdentifier,
      },
    });
  }

  if (input.agentSessionUrl !== undefined) {
    links.push({
      kind: "linear-issue",
      label: "Linear Agent Session",
      url: input.agentSessionUrl,
      externalId: input.agentSessionId,
      metadata: {
        agentSessionId: input.agentSessionId,
      },
    });
  }

  return links;
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
    "Reply through Linear Agent Activities with the captured signal summary, decision, evidence, uncertainty, verification status, and next action.",
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

function linearAuthors(input: CaptureLinearDocsSignalInput): string[] {
  return [
    ...new Set(input.comments.map((comment) => comment.author)),
  ];
}

function firstCommentTimestamp(input: CaptureLinearDocsSignalInput): string | undefined {
  return input.comments.find((comment) => comment.timestamp !== undefined)?.timestamp;
}

function lastCommentTimestamp(input: CaptureLinearDocsSignalInput): string | undefined {
  return input.comments
    .filter((comment) => comment.timestamp !== undefined)
    .at(-1)?.timestamp;
}
