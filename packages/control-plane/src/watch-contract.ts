import { z } from "zod";

export const WATCH_POLICY_CONTRACT_VERSION = 1;

const identifierSchema = z.string().trim().min(1).max(200);
const boundedTextSchema = z.string().trim().min(1).max(4_000);
const scheduleSchema = z.object({
  cron: z.string().trim().min(1).max(200),
  timeZone: z.string().trim().min(1).max(100),
}).strict();

export const watchLifecycleStateSchema = z.enum(["proposed", "active"]);

export const watchCapabilityFamilySchema = z.enum([
  "knowledge.read",
  "repository.read",
  "docs_work.manage",
  "draft.edit",
  "follow_up.schedule",
  "provider.deliver",
]);

export const watchSourceSchema = z.object({
  provider: z.string().trim().regex(/^[a-z][a-z0-9-]*$/).max(100),
  resource: z.object({
    type: z.string().trim().regex(/^[a-z][a-z0-9-]*$/).max(100),
    id: identifierSchema,
  }).strict(),
}).strict();

export const watchTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("on_event") }).strict(),
  z.object({
    type: z.literal("on_schedule"),
    schedule: scheduleSchema,
  }).strict(),
]);

export const watchEvaluationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("per_event") }).strict(),
  z.object({
    mode: z.literal("windowed"),
    windowSeconds: z.number().int().min(60).max(86_400),
    maxObservations: z.number().int().min(2).max(100),
  }).strict(),
]);

export const watchDeliverySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("immediate") }).strict(),
  z.object({
    mode: z.literal("digest"),
    schedule: scheduleSchema,
  }).strict(),
  z.object({ mode: z.literal("silent") }).strict(),
]);

export const watchContextPolicySchema = z.object({
  eventTypes: z.array(identifierSchema).min(1).max(20),
  includeThread: z.boolean(),
  historyMessageLimit: z.number().int().min(0).max(100),
  maxCharacters: z.number().int().min(1).max(100_000),
}).strict();

export const watchRetentionPolicySchema = z.object({
  rawObservationSeconds: z.number().int().min(0).max(604_800),
  auditDays: z.number().int().min(1).max(365),
}).strict();

export const watchBudgetPolicySchema = z.object({
  observationsPerHour: z.number().int().min(1).max(10_000),
  processingRunsPerHour: z.number().int().min(1).max(1_000),
  deliveriesPerDay: z.number().int().min(0).max(1_000),
  inputCharactersPerHour: z.number().int().min(1).max(10_000_000),
}).strict();

export const proposedWatchPolicySchema = z.object({
  source: watchSourceSchema,
  goal: boundedTextSchema,
  trigger: watchTriggerSchema,
  evaluation: watchEvaluationSchema,
  delivery: watchDeliverySchema,
  context: watchContextPolicySchema,
  capabilityGrants: z.array(watchCapabilityFamilySchema).max(6),
  retention: watchRetentionPolicySchema,
  budgets: watchBudgetPolicySchema,
  expiresAt: z.string().datetime({ offset: true }).nullable(),
}).strict();

export const watchPolicyDraftSchema = z.object({
  source: watchSourceSchema,
  goal: boundedTextSchema,
  trigger: watchTriggerSchema.optional(),
  evaluation: watchEvaluationSchema.optional(),
  delivery: watchDeliverySchema.optional(),
  context: watchContextPolicySchema.partial().optional(),
  capabilityGrants: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  retention: watchRetentionPolicySchema.partial().optional(),
  budgets: watchBudgetPolicySchema.partial().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

export const watchPolicyPreviewInputSchema = z.object({
  contractVersion: z.number().int().positive().optional(),
  lifecycleState: z.string().trim().min(1).max(100).optional(),
  policy: watchPolicyDraftSchema,
}).strict();

export const watchPolicyConsequenceSchema = z.object({
  kind: z.enum([
    "source",
    "evaluation",
    "delivery",
    "context",
    "authority",
    "retention",
    "expiry",
  ]),
  summary: z.string().min(1),
});

export const watchPolicyPreviewSchema = z.object({
  contractVersion: z.literal(WATCH_POLICY_CONTRACT_VERSION),
  lifecycleState: z.literal("proposed"),
  effectivePolicy: proposedWatchPolicySchema,
  defaultsApplied: z.array(z.string().min(1)),
  operatorConsequences: z.array(watchPolicyConsequenceSchema),
});

export const watchActorSchema = z.object({
  id: identifierSchema,
  githubLogin: identifierSchema,
}).strict();

export const createProposedWatchInputSchema = z.object({
  policy: proposedWatchPolicySchema,
  actor: watchActorSchema,
}).strict();

export const getPolicyBoundWatchInputSchema = z.object({
  id: z.string().uuid(),
}).strict();

export const proposedWatchRevisionSchema = z.object({
  id: z.string().uuid(),
  watchId: z.string().uuid(),
  revision: z.number().int().positive(),
  contractVersion: z.literal(WATCH_POLICY_CONTRACT_VERSION),
  policy: proposedWatchPolicySchema,
  createdBy: watchActorSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const policyBoundWatchSchema = z.object({
  id: z.string().uuid(),
  workspaceId: identifierSchema,
  lifecycleState: watchLifecycleStateSchema,
  latestProposal: proposedWatchRevisionSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const approveWatchProposalInputSchema = z.object({
  watchId: z.string().uuid(),
  proposalRevisionId: z.string().uuid(),
  expectedProposalRevision: z.number().int().positive(),
  decision: z.literal("approved"),
  idempotencyKey: z.string().trim().min(1).max(500),
}).strict();

export const effectiveWatchRevisionSchema = z.object({
  id: z.string().uuid(),
  watchId: z.string().uuid(),
  proposalRevisionId: z.string().uuid(),
  contractVersion: z.literal(WATCH_POLICY_CONTRACT_VERSION),
  policy: proposedWatchPolicySchema,
  approvedBy: watchActorSchema,
  approvedAt: z.string().datetime({ offset: true }),
});

export const activePolicyBoundWatchSchema = z.object({
  id: z.string().uuid(),
  workspaceId: identifierSchema,
  lifecycleState: z.literal("active"),
  effectiveRevision: effectiveWatchRevisionSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const approveWatchProposalResultSchema = z.object({
  created: z.boolean(),
  replayed: z.boolean(),
  watch: activePolicyBoundWatchSchema,
});

export type ProposedWatchPolicy = z.infer<typeof proposedWatchPolicySchema>;
export type ProposedWatchRevision = z.infer<typeof proposedWatchRevisionSchema>;
export type PolicyBoundWatch = z.infer<typeof policyBoundWatchSchema>;
export type WatchActor = z.infer<typeof watchActorSchema>;
export type WatchCapabilityFamily = z.infer<typeof watchCapabilityFamilySchema>;
export type WatchPolicyPreview = z.infer<typeof watchPolicyPreviewSchema>;
export type WatchPolicyDraft = z.infer<typeof watchPolicyDraftSchema>;
export type ActivePolicyBoundWatch = z.infer<typeof activePolicyBoundWatchSchema>;
export type ApproveWatchProposalResult = z.infer<
  typeof approveWatchProposalResultSchema
>;
