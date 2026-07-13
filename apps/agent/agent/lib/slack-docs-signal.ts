import { z } from "zod";

import {
  docsImpactDecisionRecordSchema,
  docsImpactEvidenceSchema,
  docsImpactTriageInputSchema,
} from "./docs-impact-decision";
import {
  buildDocsSignalReplyGuidance,
  captureProviderDocsSignal,
  docsSignalVerificationStatusSchema,
} from "./docs-signal-intake";
import {
  docsSignalDetailSchema,
  docsSignalLinkInputSchema,
} from "./docs-signals";

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
  verificationStatus: docsSignalVerificationStatusSchema,
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
  const intake = await captureProviderDocsSignal({
    signal: {
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
    },
    triage: {
      signalSummary: parsed.sourceSummary,
      publicDocsImpact: parsed.publicDocsImpact,
      sourceEvidence: parsed.sourceEvidence,
      currentDocsState: parsed.currentDocsState,
      evidence,
      missingEvidence: parsed.missingEvidence,
      uncertainty: parsed.uncertainty,
      skippedVerificationReason: parsed.skippedVerificationReason,
    },
    actor: "docs-agent:slack-intake",
    externalContext,
  });

  return captureSlackDocsSignalResultSchema.parse({
    created: intake.created,
    signal: intake.signal,
    externalContext,
    decision: intake.decision,
    shouldVerifyCurrentDocs: intake.shouldVerifyCurrentDocs,
    verificationStatus: intake.verificationStatus,
    replyGuidance: buildDocsSignalReplyGuidance({
      decision: intake.decision,
      verificationStatus: intake.verificationStatus,
      transportInstruction:
        "Reply in the Slack thread with the captured signal summary, decision, evidence, uncertainty, verification status, and next action.",
    }),
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
