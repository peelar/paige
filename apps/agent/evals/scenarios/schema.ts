import { z } from "zod";

// Eval discovery bundles authored modules independently from the agent runtime.
// Keep this fixture contract local so loading scenarios does not pull the
// server-only control-plane package into the eval bundle.
const externalContextBaseSchema = z.object({
  sourceId: z.string().trim().min(1),
  capturedAt: z.string().trim().min(1).optional(),
});

const externalContextSchema = z.discriminatedUnion("kind", [
  externalContextBaseSchema.extend({
    kind: z.literal("communication-thread"),
    title: z.string().trim().min(1),
    participants: z.array(z.string().trim().min(1)).default([]),
    messages: z
      .array(
        z.object({
          author: z.string().trim().min(1),
          body: z.string().trim().min(1),
          timestamp: z.string().trim().min(1),
        }),
      )
      .nonempty(),
    relatedReferences: z.array(z.string().trim().min(1)).default([]),
  }),
  externalContextBaseSchema.extend({
    kind: z.literal("issue-tracker-item"),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    status: z.string().trim().min(1),
    author: z.string().trim().min(1).optional(),
    assignee: z.string().trim().min(1).optional(),
    labels: z.array(z.string().trim().min(1)).default([]),
    relationships: z.array(z.string().trim().min(1)).default([]),
  }),
  externalContextBaseSchema.extend({
    kind: z.literal("decision-record"),
    title: z.string().trim().min(1),
    decision: z.string().trim().min(1),
    rationale: z.string().trim().min(1),
    decidedAt: z.string().trim().min(1).optional(),
  }),
  externalContextBaseSchema.extend({
    kind: z.literal("release-note"),
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
    releasedAt: z.string().trim().min(1).optional(),
    relevance: z.string().trim().min(1).optional(),
  }),
  externalContextBaseSchema.extend({
    kind: z.literal("customer-report"),
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
    reportedAt: z.string().trim().min(1).optional(),
    relevance: z.string().trim().min(1).optional(),
  }),
]);

const userTestRepositoryInputSchema = z.object({
  workingDocumentationRepository: z.object({
    source: z.object({
      type: z.literal("github-url"),
      url: z.string().url(),
    }),
    ref: z.string().trim().min(1),
    docsRoot: z.string().trim().min(1),
    sandboxPath: z.string().trim().min(1),
    accessMode: z.literal("sandbox-write"),
    allowedActions: z.array(z.string().trim().min(1)).nonempty(),
    provenanceLabel: z.string().trim().min(1),
  }),
  watchedRepositories: z.array(z.unknown()),
  contextRepositories: z.array(z.unknown()),
  externalContext: z.array(externalContextSchema),
});

export const userTestScenarioOutcomeSchema = z.enum(["docs-patch", "no-docs-change"]);

export const userTestCheckSchema = z.object({
  command: z.string().trim().min(1),
  required: z.boolean(),
  rationale: z.string().trim().min(1),
});

export const userTestScenarioSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  intent: z.string().trim().min(1),
  userPrompt: z.string().trim().min(1),
  repositoryInput: userTestRepositoryInputSchema,
  expected: z.object({
    outcome: userTestScenarioOutcomeSchema,
    inspectedPaths: z.array(z.string().trim().min(1)).nonempty(),
    replyMustInclude: z.array(z.string().trim().min(1)).nonempty(),
    impactReportMustInclude: z.array(z.string().trim().min(1)).nonempty(),
    expectedTouchedFiles: z.array(z.string().trim().min(1)),
    forbiddenTouchedFiles: z.array(z.string().trim().min(1)).default([]),
    expectedPatchHints: z.array(z.string().trim().min(1)).default([]),
    requiredDiffText: z.array(z.string().trim().min(1)).default([]),
    mustNotDo: z.array(z.string().trim().min(1)).nonempty(),
    checks: z.array(userTestCheckSchema).default([]),
  }),
});

export type UserTestScenario = z.infer<typeof userTestScenarioSchema>;
