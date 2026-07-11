import { randomUUID } from "node:crypto";

import { z } from "zod";

import { saveRepositoryWorkflowState } from "./repository-workflow-state.js";
import {
  editorialInterventionSchema,
  type WorkflowState,
} from "./repository-workflow-contract.js";

const conciseText = z.string().trim().min(1).max(1_000);
const referenceList = z.array(z.string().trim().min(1).max(500)).max(20);

export const editorialRecommendationDetailsSchema = z.object({
  sourceDecisionReference: z.string().trim().min(1).max(500),
  taskReferences: referenceList.default([]),
  reader: conciseText,
  readerProblem: conciseText,
  chosenIntervention: editorialInterventionSchema,
  rationale: conciseText,
  repositoryEvidence: referenceList.min(1),
  docsProfileReferences: referenceList.min(1),
  sourceEvidence: referenceList.default([]),
  workspaceMemoryReferences: referenceList.default([]),
  alternatives: z.array(z.object({
    intervention: editorialInterventionSchema,
    reasonRejected: conciseText,
  })).max(3).default([]),
  remainingUncertainty: referenceList.default([]),
  blockingDecisions: referenceList.default([]),
  maintainerDirection: z.object({
    requestedIntervention: editorialInterventionSchema,
    reaffirmed: z.boolean(),
  }).optional(),
  overrideReason: z.enum(["unsupported-public-claim", "existing-safety-boundary"]).optional(),
}).superRefine((value, ctx) => {
  const isBlockingChoice = value.chosenIntervention === "wait-for-evidence" || value.chosenIntervention === "ask-maintainer";
  if (isBlockingChoice && value.blockingDecisions.length === 0) {
    ctx.addIssue({ code: "custom", path: ["blockingDecisions"], message: "A blocking intervention must name the missing evidence or decision." });
  }
  if (!isBlockingChoice && value.blockingDecisions.length > 0) {
    ctx.addIssue({ code: "custom", path: ["chosenIntervention"], message: "Choose wait-for-evidence or ask-maintainer while blocking decisions remain." });
  }
  const direction = value.maintainerDirection;
  if (
    direction?.reaffirmed === true &&
    direction.requestedIntervention !== value.chosenIntervention &&
    value.overrideReason === undefined
  ) {
    ctx.addIssue({ code: "custom", path: ["chosenIntervention"], message: "Follow the reaffirmed maintainer intervention unless unsupported claims or an existing safety boundary require an override." });
  }
});

export const createEditorialRecommendationInputSchema = editorialRecommendationDetailsSchema;
export const reviseEditorialRecommendationInputSchema = z.intersection(
  editorialRecommendationDetailsSchema,
  z.object({ recommendationId: z.string().trim().min(1) }),
);

type RecommendationDetails = z.infer<typeof editorialRecommendationDetailsSchema>;
type PersistState = (state: WorkflowState) => Promise<void>;

export async function createEditorialRecommendation(
  input: z.infer<typeof createEditorialRecommendationInputSchema>,
  state: WorkflowState,
  persistState: PersistState = saveRepositoryWorkflowState,
) {
  if (state.draft?.editorialRecommendationId !== undefined) {
    throw new Error("The active authoring draft already has an editorial recommendation. Revise it or abandon the draft before starting another recommendation.");
  }
  const now = new Date().toISOString();
  state.editorialRecommendation = buildRecommendation(editorialRecommendationDetailsSchema.parse(input), {
    id: `editorial-${randomUUID()}`,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  state.contentPlan = undefined;
  await persistState(state);
  return recommendationResult(state.editorialRecommendation);
}

export async function reviseEditorialRecommendation(
  input: z.infer<typeof reviseEditorialRecommendationInputSchema>,
  state: WorkflowState,
  persistState: PersistState = saveRepositoryWorkflowState,
) {
  const current = state.editorialRecommendation;
  if (current === undefined || current.id !== input.recommendationId) {
    throw new Error(`Editorial recommendation not found: ${input.recommendationId}`);
  }
  const details = editorialRecommendationDetailsSchema.parse(input);
  if (state.draft?.editorialRecommendationId === current.id && details.chosenIntervention !== current.chosenIntervention) {
    throw new Error("Abandon the active draft before changing its editorial intervention.");
  }
  state.editorialRecommendation = buildRecommendation(details, {
    id: current.id,
    revision: current.revision + 1,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  });
  if (details.chosenIntervention !== current.chosenIntervention) state.contentPlan = undefined;
  if (state.draft?.editorialRecommendationId === current.id) {
    state.draft.editorialRecommendationRevision = state.editorialRecommendation.revision;
  }
  await persistState(state);
  return recommendationResult(state.editorialRecommendation);
}

export function inspectEditorialRecommendation(state: WorkflowState) {
  return state.editorialRecommendation === undefined
    ? null
    : recommendationResult(state.editorialRecommendation);
}

export function recommendationMatchesTask(
  recommendation: NonNullable<WorkflowState["editorialRecommendation"]>,
  taskReferences: string[],
): boolean {
  return taskReferences.length === 0 || recommendation.taskReferences.length === 0 ||
    taskReferences.some((reference) => recommendation.taskReferences.includes(reference));
}

function buildRecommendation(
  details: RecommendationDetails,
  identity: { id: string; revision: number; createdAt: string; updatedAt: string },
) {
  return {
    ...identity,
    ...details,
    taskReferences: [...new Set(details.taskReferences)],
    status: recommendationStatus(details.chosenIntervention),
  };
}

function recommendationStatus(intervention: z.infer<typeof editorialInterventionSchema>) {
  if (intervention === "no-change") return "complete-no-change" as const;
  if (intervention === "wait-for-evidence" || intervention === "ask-maintainer") return "blocked" as const;
  if (["new-document", "rewrite", "restructure", "consolidate", "remove"].includes(intervention)) return "plan-required" as const;
  return "proceed" as const;
}

function recommendationResult(recommendation: NonNullable<WorkflowState["editorialRecommendation"]>) {
  const alternatives = recommendation.alternatives
    .slice(0, 2)
    .map(({ intervention, reasonRejected }) => `${intervention}: ${reasonRejected.slice(0, 250)}`)
    .join("; ");
  const summary = `Editorial recommendation: ${recommendation.chosenIntervention}. ${recommendation.rationale.slice(0, 600)}${alternatives === "" ? "" : ` Alternatives: ${alternatives}.`}`;
  const nextAction = recommendation.status === "plan-required"
    ? "Share the recommendation, then create a content plan and continue reversible sandbox drafting."
    : recommendation.status === "proceed"
      ? "Share the recommendation, then continue reversible sandbox drafting."
      : recommendation.status === "complete-no-change"
        ? "Share the recommendation and stop without a draft."
        : "Share the blocker and pause before drafting.";
  return { recommendation, summary, nextAction };
}
