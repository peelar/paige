import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  createDocsSignal,
  createDocsSignalInputSchema,
  docsSignalArtifactInputSchema,
  docsSignalLinkInputSchema,
  getDocsSignal,
  listDocsSignals,
  listDocsSignalsInputSchema,
  ownedDocsWorkConversationSchema,
  ownedDocsWorkMilestoneSchema,
  ownedDocsWorkOutcomeSchema,
  ownedDocsWorkReferencesSchema,
  recordDocsSignalEvidence,
  startOwnedDocsWork,
  updateDocsSignalLifecycle,
  updateOwnedDocsWork,
} from "./docs-signals";
import {
  createContentPlan,
  contentPlanDetailsSchema,
  inspectContentPlan,
  reviseContentPlan,
} from "./content-plan";
import {
  createEditorialRecommendation,
  editorialRecommendationDetailsSchema,
  inspectEditorialRecommendation,
  reviseEditorialRecommendation,
} from "./editorial-recommendation";
import {
  verifyDocsSignalCurrentDocs,
  verifyDocsSignalCurrentDocsInputSchema,
} from "./docs-signal-verification";
import { inspectRepositoryWorkflowState } from "./repository-workflow-state";
import { loadOrMaterializeRepositoryWorkflowState } from "./working-repository-lifecycle";

const operationKeySchema = z.string().trim().min(1).max(500);
const summarySchema = z.string().trim().min(1).max(2_000);
const workIdSchema = z.string().trim().min(1);

const manualSourceSchema = createDocsSignalInputSchema.shape.source
  .omit({ provider: true, providerId: true })
  .extend({
    kind: z.enum(["manual-scenario", "external-context"]),
    operationKey: operationKeySchema,
  })
  .strict();

const createWorkSchema = createDocsSignalInputSchema
  .omit({ source: true })
  .extend({
    operation: z.literal("create"),
    source: manualSourceSchema,
    ownership: z.object({
      operationKey: operationKeySchema,
      intendedOutcome: summarySchema,
      conversation: ownedDocsWorkConversationSchema,
    }).strict().optional(),
  })
  .strict();

const triageSchema = z.object({
  operation: z.literal("triage"),
  workId: workIdSchema,
  outcome: z.enum(["continue", "needs-maintainer-answer", "needs-source-evidence"]),
  reason: summarySchema,
  missingEvidence: z.array(z.string().trim().min(1)).max(30).optional(),
  uncertainty: z.string().trim().min(1).optional(),
  nextActionAt: z.string().trim().min(1).nullable().optional(),
  links: z.array(docsSignalLinkInputSchema).max(50).default([]),
  artifacts: z.array(docsSignalArtifactInputSchema).max(20).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

const editorialDecisionSchema = z.discriminatedUnion("mode", [
  editorialRecommendationDetailsSchema.extend({ mode: z.literal("create") }),
  editorialRecommendationDetailsSchema.extend({
    mode: z.literal("revise"),
    recommendationId: z.string().trim().min(1),
    expectedRevision: z.number().int().positive(),
  }),
]);

const planDecisionSchema = z.discriminatedUnion("mode", [
  contentPlanDetailsSchema.extend({ mode: z.literal("create") }),
  contentPlanDetailsSchema.extend({
    mode: z.literal("revise"),
    planId: z.string().trim().min(1),
    expectedRevision: z.number().int().positive(),
  }),
]);

const editorialDecisionProviderInputSchema = z.object({
  ...editorialRecommendationDetailsSchema.shape,
  mode: z.enum(["create", "revise"]),
  recommendationId: z.string().trim().min(1).optional(),
  expectedRevision: z.number().int().positive().optional(),
}).strict().transform((input, ctx) => {
  const result = editorialDecisionSchema.safeParse(input);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    ctx.addIssue({ code: "custom", path: [...issue.path], message: issue.message });
  }
  return z.NEVER;
});

const planDecisionProviderInputSchema = z.object({
  ...contentPlanDetailsSchema.shape,
  mode: z.enum(["create", "revise"]),
  planId: z.string().trim().min(1).optional(),
  expectedRevision: z.number().int().positive().optional(),
}).strict().transform((input, ctx) => {
  const result = planDecisionSchema.safeParse(input);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    ctx.addIssue({ code: "custom", path: [...issue.path], message: issue.message });
  }
  return z.NEVER;
});

const ownedBase = {
  workId: workIdSchema,
  expectedRevision: z.number().int().positive(),
  operationKey: operationKeySchema,
  summary: summarySchema,
};

export const docsWorkManageInputSchema = z.discriminatedUnion("operation", [
  createWorkSchema,
  triageSchema,
  verifyDocsSignalCurrentDocsInputSchema.omit({ signalId: true }).extend({
    operation: z.literal("verify_current_docs"),
    workId: workIdSchema,
  }).strict(),
  z.object({ operation: z.literal("decide"), decision: editorialDecisionSchema }).strict(),
  z.object({ operation: z.literal("plan"), plan: planDecisionSchema }).strict(),
  z.object({
    operation: z.literal("link_evidence"),
    workId: workIdSchema,
    expectedUpdatedAt: z.string().trim().min(1),
    operationKey: operationKeySchema,
    reason: summarySchema,
    links: z.array(docsSignalLinkInputSchema).max(50).default([]),
    artifacts: z.array(docsSignalArtifactInputSchema).max(20).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }).strict(),
  z.object({
    operation: z.literal("start"),
    workId: workIdSchema,
    operationKey: operationKeySchema,
    intendedOutcome: summarySchema,
    conversation: ownedDocsWorkConversationSchema,
  }).strict(),
  z.object({
    operation: z.literal("milestone"),
    ...ownedBase,
    activityKind: z.enum(["routine", "milestone"]),
    milestone: ownedDocsWorkMilestoneSchema.optional(),
    references: ownedDocsWorkReferencesSchema.partial().default({}),
    artifacts: z.array(docsSignalArtifactInputSchema).max(20).default([]),
  }).strict().superRefine((value, ctx) => {
    if (value.activityKind === "milestone" && value.milestone === undefined) {
      ctx.addIssue({ code: "custom", path: ["milestone"], message: "Milestone activity requires a typed milestone." });
    }
    if (value.activityKind === "routine" && value.milestone !== undefined) {
      ctx.addIssue({ code: "custom", path: ["milestone"], message: "Routine activity cannot claim a milestone." });
    }
  }),
  z.object({
    operation: z.literal("correct"),
    ...ownedBase,
    references: ownedDocsWorkReferencesSchema.partial().default({}),
  }).strict(),
  z.object({
    operation: z.literal("park"),
    ...ownedBase,
    reasonKind: z.enum(["missing-evidence", "product-decision", "manual-pause", "unrecoverable-failure"]),
    artifacts: z.array(docsSignalArtifactInputSchema).max(20).default([]),
  }).strict(),
  z.object({ operation: z.literal("resume"), ...ownedBase }).strict(),
  z.object({
    operation: z.literal("finish"),
    ...ownedBase,
    outcome: ownedDocsWorkOutcomeSchema,
    references: ownedDocsWorkReferencesSchema.partial().default({}),
    artifacts: z.array(docsSignalArtifactInputSchema).max(20).default([]),
  }).strict(),
]);

export const docsWorkReadInputSchema = z.discriminatedUnion("operation", [
  listDocsSignalsInputSchema.extend({ operation: z.literal("find") }).strict(),
  z.object({ operation: z.literal("inspect"), workId: workIdSchema }).strict(),
  z.object({ operation: z.literal("inspect_session_decisions") }).strict(),
]);

/**
 * Provider-facing schemas keep argument types in top-level JSON Schema
 * `properties`. The strict adapter preserves the existing operation-specific
 * unions, refinements, and defaults after malformed provider input is rejected.
 */
export const docsWorkManageProviderInputSchema = z.object({
  operation: z.enum([
    "create",
    "triage",
    "verify_current_docs",
    "decide",
    "plan",
    "link_evidence",
    "start",
    "milestone",
    "correct",
    "park",
    "resume",
    "finish",
  ]),
  source: createWorkSchema.shape.source.optional(),
  sourceSummary: createWorkSchema.shape.sourceSummary.optional(),
  extractedClaims: createWorkSchema.shape.extractedClaims.removeDefault().optional(),
  likelyDocsConcepts:
    createWorkSchema.shape.likelyDocsConcepts.removeDefault().optional(),
  likelyDocsPages: createWorkSchema.shape.likelyDocsPages.removeDefault().optional(),
  productSurfaces: createWorkSchema.shape.productSurfaces.removeDefault().optional(),
  missingEvidence: triageSchema.shape.missingEvidence.optional(),
  uncertainty: createWorkSchema.shape.uncertainty.optional(),
  priority: createWorkSchema.shape.priority.removeDefault().optional(),
  nextActionAt: createWorkSchema.shape.nextActionAt
    .describe("Set a non-null next-action time for create or triage.")
    .optional(),
  clearNextActionAt: z.literal(true)
    .describe("For triage only, clear the current next-action time.")
    .optional(),
  links: triageSchema.shape.links.removeDefault().optional(),
  artifacts: triageSchema.shape.artifacts.removeDefault().optional(),
  ownership: createWorkSchema.shape.ownership.optional(),
  workId: workIdSchema.optional(),
  outcome: z.enum([
    "continue",
    "needs-maintainer-answer",
    "needs-source-evidence",
    "completed-draft",
    "no-change",
    "blocked",
    "abandoned",
    "failed",
  ]).describe("Triage uses continue or needs-*; finish uses a terminal work outcome.").optional(),
  reason: summarySchema.optional(),
  metadata: triageSchema.shape.metadata.removeDefault().optional(),
  docsPages:
    verifyDocsSignalCurrentDocsInputSchema.shape.docsPages.removeDefault().optional(),
  searchQueries:
    verifyDocsSignalCurrentDocsInputSchema.shape.searchQueries.removeDefault().optional(),
  maxSearchQueries:
    verifyDocsSignalCurrentDocsInputSchema.shape.maxSearchQueries.removeDefault().optional(),
  decision: editorialDecisionProviderInputSchema.optional(),
  plan: planDecisionProviderInputSchema.optional(),
  expectedUpdatedAt: z.string().trim().min(1).optional(),
  operationKey: operationKeySchema.optional(),
  intendedOutcome: summarySchema.optional(),
  conversation: ownedDocsWorkConversationSchema.optional(),
  expectedRevision: ownedBase.expectedRevision.optional(),
  summary: summarySchema.optional(),
  activityKind: z.enum(["routine", "milestone"]).optional(),
  milestone: ownedDocsWorkMilestoneSchema.optional(),
  references: ownedDocsWorkReferencesSchema.partial().optional(),
  reasonKind: z.enum([
    "missing-evidence",
    "product-decision",
    "manual-pause",
    "unrecoverable-failure",
  ]).optional(),
}).strict().transform((input, ctx) => {
  const { clearNextActionAt, ...providerInput } = input;
  if (clearNextActionAt === true && input.operation !== "triage") {
    ctx.addIssue({
      code: "custom",
      path: ["clearNextActionAt"],
      message: "Only triage may clear the next-action time.",
    });
    return z.NEVER;
  }
  if (clearNextActionAt === true && input.nextActionAt !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["clearNextActionAt"],
      message: "Choose either nextActionAt or clearNextActionAt, not both.",
    });
    return z.NEVER;
  }
  const normalizedInput: Record<string, unknown> = { ...providerInput };
  if (clearNextActionAt === true) normalizedInput.nextActionAt = null;
  const result = docsWorkManageInputSchema.safeParse(normalizedInput);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    ctx.addIssue({ code: "custom", path: [...issue.path], message: issue.message });
  }
  return z.NEVER;
});

export const docsWorkReadProviderInputSchema = z.object({
  operation: z.enum(["find", "inspect", "inspect_session_decisions"]),
  statuses: listDocsSignalsInputSchema.shape.statuses.removeDefault().optional(),
  sourceKinds: listDocsSignalsInputSchema.shape.sourceKinds.removeDefault().optional(),
  openOnly: listDocsSignalsInputSchema.shape.openOnly.removeDefault().optional(),
  limit: listDocsSignalsInputSchema.shape.limit.removeDefault().optional(),
  workId: workIdSchema.optional(),
}).strict().pipe(docsWorkReadInputSchema);

export async function readDocsWork(input: z.infer<typeof docsWorkReadInputSchema>) {
  const parsed = docsWorkReadInputSchema.parse(input);
  if (parsed.operation === "find") {
    return { operation: "find" as const, ...(await listDocsSignals(parsed)) };
  }
  if (parsed.operation === "inspect") {
    return {
      operation: "inspect" as const,
      work: await getDocsSignal({ id: parsed.workId }),
    };
  }
  const state = inspectRepositoryWorkflowState();
  return {
    operation: "inspect_session_decisions" as const,
    editorialDecision: state === null ? null : inspectEditorialRecommendation(state),
    contentPlan: state === null ? null : inspectContentPlan(state),
  };
}

export async function manageDocsWork(
  input: z.infer<typeof docsWorkManageInputSchema>,
  ctx: ToolContext,
) {
  const parsed = docsWorkManageInputSchema.parse(input);
  const runtime = { sessionId: ctx.session.id, runId: ctx.session.turn.id };

  switch (parsed.operation) {
    case "create": {
      const {
        operation: _operation,
        ownership,
        source: { operationKey, ...source },
        ...signal
      } = parsed;
      const created = await createDocsSignal({
        ...signal,
        source: { ...source, provider: "docs-work", providerId: operationKey },
      });
      const owned = ownership === undefined
        ? null
        : await startOwnedDocsWork({ signalId: created.signal.id, ...ownership }, runtime);
      return { operation: "create" as const, ...created, ownership: owned };
    }
    case "triage": {
      const status = parsed.outcome === "continue" ? "captured" as const : parsed.outcome;
      return {
        operation: "triage" as const,
        work: await updateDocsSignalLifecycle({
          id: parsed.workId,
          status,
          reason: parsed.reason,
          missingEvidence: parsed.missingEvidence,
          uncertainty: parsed.uncertainty,
          nextActionAt: parsed.nextActionAt,
          links: parsed.links,
          artifacts: parsed.artifacts,
          metadata: parsed.metadata,
        }),
      };
    }
    case "verify_current_docs": {
      const { operation: _operation, workId, ...verification } = parsed;
      return {
        operation: "verify_current_docs" as const,
        ...(await verifyDocsSignalCurrentDocs({ signalId: workId, ...verification }, ctx)),
      };
    }
    case "decide": {
      const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
      if (parsed.decision.mode === "create") {
        return {
          operation: "decide" as const,
          mode: "create" as const,
          ...(await createEditorialRecommendation(parsed.decision, state)),
        };
      }
      const current = inspectEditorialRecommendation(state)?.recommendation;
      if (
        current?.id !== parsed.decision.recommendationId ||
        current.revision !== parsed.decision.expectedRevision
      ) {
        throw new Error(
          `Editorial recommendation changed concurrently. Expected ${parsed.decision.recommendationId} revision ${parsed.decision.expectedRevision}. Inspect and retry.`,
        );
      }
      return {
        operation: "decide" as const,
        mode: "revise" as const,
        ...(await reviseEditorialRecommendation(parsed.decision, state)),
      };
    }
    case "plan": {
      const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
      if (parsed.plan.mode === "create") {
        return {
          operation: "plan" as const,
          mode: "create" as const,
          ...(await createContentPlan(parsed.plan, state)),
        };
      }
      const current = inspectContentPlan(state)?.plan;
      if (
        current?.id !== parsed.plan.planId ||
        current.revision !== parsed.plan.expectedRevision
      ) {
        throw new Error(
          `Content plan changed concurrently. Expected ${parsed.plan.planId} revision ${parsed.plan.expectedRevision}. Inspect and retry.`,
        );
      }
      return {
        operation: "plan" as const,
        mode: "revise" as const,
        ...(await reviseContentPlan(parsed.plan, state)),
      };
    }
    case "link_evidence":
      return {
        operation: "link_evidence" as const,
        ...(await recordDocsSignalEvidence({
          id: parsed.workId,
          expectedUpdatedAt: parsed.expectedUpdatedAt,
          operationKey: parsed.operationKey,
          reason: parsed.reason,
          links: parsed.links,
          artifacts: parsed.artifacts,
          metadata: parsed.metadata,
        })),
      };
    case "start":
      return {
        operation: "start" as const,
        ...(await startOwnedDocsWork({
          signalId: parsed.workId,
          operationKey: parsed.operationKey,
          intendedOutcome: parsed.intendedOutcome,
          conversation: parsed.conversation,
        }, runtime)),
      };
    case "milestone":
      return {
        operation: "milestone" as const,
        ...(await updateOwnedDocsWork({
          signalId: parsed.workId,
          expectedRevision: parsed.expectedRevision,
          operationKey: parsed.operationKey,
          action: "record",
          activityKind: parsed.activityKind,
          milestone: parsed.milestone,
          summary: parsed.summary,
          references: parsed.references,
          artifacts: parsed.artifacts,
        }, runtime)),
      };
    case "correct":
      return {
        operation: "correct" as const,
        ...(await updateOwnedDocsWork({
          signalId: parsed.workId,
          expectedRevision: parsed.expectedRevision,
          operationKey: parsed.operationKey,
          action: "correct",
          summary: parsed.summary,
          references: parsed.references,
        }, runtime)),
      };
    case "park":
      if (parsed.reasonKind === "manual-pause") {
        return {
          operation: "park" as const,
          ...(await updateOwnedDocsWork({
            signalId: parsed.workId,
            expectedRevision: parsed.expectedRevision,
            operationKey: parsed.operationKey,
            action: "pause",
            summary: parsed.summary,
          }, runtime)),
        };
      }
      return {
        operation: "park" as const,
        ...(await updateOwnedDocsWork({
          signalId: parsed.workId,
          expectedRevision: parsed.expectedRevision,
          operationKey: parsed.operationKey,
          action: "park",
          reasonKind: parsed.reasonKind,
          summary: parsed.summary,
          artifacts: parsed.artifacts,
        }, runtime)),
      };
    case "resume":
      return {
        operation: "resume" as const,
        ...(await updateOwnedDocsWork({
          signalId: parsed.workId,
          expectedRevision: parsed.expectedRevision,
          operationKey: parsed.operationKey,
          action: "resume",
          summary: parsed.summary,
        }, runtime)),
      };
    case "finish":
      if (parsed.outcome === "abandoned") {
        return {
          operation: "finish" as const,
          ...(await updateOwnedDocsWork({
            signalId: parsed.workId,
            expectedRevision: parsed.expectedRevision,
            operationKey: parsed.operationKey,
            action: "abandon",
            summary: parsed.summary,
          }, runtime)),
        };
      }
      if (parsed.outcome === "failed") {
        return {
          operation: "finish" as const,
          ...(await updateOwnedDocsWork({
            signalId: parsed.workId,
            expectedRevision: parsed.expectedRevision,
            operationKey: parsed.operationKey,
            action: "park",
            reasonKind: "unrecoverable-failure",
            summary: parsed.summary,
            artifacts: parsed.artifacts,
          }, runtime)),
        };
      }
      return {
        operation: "finish" as const,
        ...(await updateOwnedDocsWork({
          signalId: parsed.workId,
          expectedRevision: parsed.expectedRevision,
          operationKey: parsed.operationKey,
          action: "complete",
          outcome: parsed.outcome,
          summary: parsed.summary,
          references: parsed.references,
          artifacts: parsed.artifacts,
        }, runtime)),
      };
  }
}

export function projectDocsWorkModelOutput(output: unknown): unknown {
  if (!isRecord(output) || typeof output.operation !== "string") {
    return boundModelValue(output);
  }

  switch (output.operation) {
    case "find":
      return {
        operation: "find",
        signals: Array.isArray(output.signals)
          ? output.signals.slice(0, 100).map(projectSignalSummary)
          : [],
      };
    case "inspect":
      return { operation: "inspect", work: projectSignal(output.work) };
    case "inspect_session_decisions":
      return {
        operation: "inspect_session_decisions",
        editorialDecision: boundModelValue(output.editorialDecision),
        contentPlan: boundModelValue(output.contentPlan),
      };
    case "create":
      return {
        operation: "create",
        created: output.created === true,
        signal: projectSignal(output.signal),
        ownership: projectOwnedResult(output.ownership),
      };
    case "triage":
      return { operation: "triage", work: projectSignal(output.work) };
    case "verify_current_docs":
      return {
        operation: "verify_current_docs",
        signal: projectSignal(output.signal),
        materialization: boundModelValue(output.materialization),
        consideredPages: boundModelValue(output.consideredPages),
        searchResults: boundModelValue(output.searchResults),
        checks: boundModelValue(output.checks),
        changedFiles: boundModelValue(output.changedFiles),
        noDiff: output.noDiff,
        verificationSummary: boundModelValue(output.verificationSummary),
      };
    case "link_evidence":
      return {
        operation: "link_evidence",
        replayed: output.replayed === true,
        signal: projectSignal(output.signal),
      };
    case "start":
    case "milestone":
    case "correct":
    case "park":
    case "resume":
    case "finish":
      return { operation: output.operation, ...projectOwnedResult(output) };
    case "decide":
    case "plan":
      return boundModelValue(output);
    default:
      return { operation: output.operation, result: boundModelValue(output) };
  }
}

function projectSignal(value: unknown) {
  if (!isRecord(value)) return null;
  return {
    ...projectSignalSummary(value),
    extractedClaims: boundModelValue(value.extractedClaims),
    likelyDocsConcepts: boundModelValue(value.likelyDocsConcepts),
    likelyDocsPages: boundModelValue(value.likelyDocsPages),
    productSurfaces: boundModelValue(value.productSurfaces),
    missingEvidence: boundModelValue(value.missingEvidence),
    sources: Array.isArray(value.sources)
      ? value.sources.slice(0, 20).map((source) => {
          if (!isRecord(source)) return null;
          return {
            kind: source.kind,
            provider: source.provider,
            ...(source.provider === "docs-work"
              ? {}
              : { providerId: boundModelValue(source.providerId) }),
            permalink: source.permalink,
            title: boundModelValue(source.title),
            authors: boundModelValue(source.authors),
            sourceCreatedAt: source.sourceCreatedAt,
            sourceUpdatedAt: source.sourceUpdatedAt,
            capturedAt: source.capturedAt,
            hasSourceText: typeof source.sourceText === "string",
          };
        })
      : [],
    links: boundModelValue(value.links),
    artifacts: boundModelValue(value.artifacts),
    events: boundModelValue(value.events),
    ownedWork: projectOwnedWork(value.ownedWork),
  };
}

function projectSignalSummary(value: unknown) {
  if (!isRecord(value)) return null;
  return {
    id: value.id,
    status: value.status,
    sourceKind: value.sourceKind,
    sourceSummary: boundModelValue(value.sourceSummary),
    uncertainty: boundModelValue(value.uncertainty),
    priority: value.priority,
    nextActionAt: value.nextActionAt,
    updatedAt: value.updatedAt,
  };
}

function projectOwnedResult(value: unknown) {
  if (!isRecord(value)) return null;
  return {
    created: value.created === true,
    replayed: value.replayed === true,
    channelUpdate: boundModelValue(value.channelUpdate),
    work: projectOwnedWork(value.work),
  };
}

function projectOwnedWork(value: unknown) {
  if (!isRecord(value)) return null;
  return {
    id: value.id,
    signalId: value.signalId,
    status: value.status,
    revision: value.revision,
    intendedOutcome: boundModelValue(value.intendedOutcome),
    references: boundModelValue(value.references),
    outcome: value.outcome,
    lastMilestone: value.lastMilestone,
    updatedAt: value.updatedAt,
  };
}

const sensitiveKey = /token|secret|password|authorization|cookie|credential|api[-_]?key|operationKey|lastOperationKey/iu;
const sensitiveValue = /(?:bearer\s+[a-z0-9._~-]+|gh[opsu]_[a-z0-9_]+|github_pat_[a-z0-9_]+|xox[baprs]-[a-z0-9-]+|lin_api_[a-z0-9_-]+)/iu;

function boundModelValue(value: unknown, depth = 0): unknown {
  if (depth >= 6) return "[truncated]";
  if (typeof value === "string") {
    if (sensitiveValue.test(value)) return "[redacted]";
    return value.length <= 2_000 ? value : `${value.slice(0, 1_980)}...[truncated]`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => boundModelValue(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, item]) => [
          key,
          sensitiveKey.test(key) ? "[redacted]" : boundModelValue(item, depth + 1),
        ]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
