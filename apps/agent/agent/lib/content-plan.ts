import { randomUUID } from "node:crypto";

import { z } from "zod";

import { saveRepositoryWorkflowState } from "./repository-workflow-state.js";
import { recommendationMatchesTask } from "./editorial-recommendation.js";
import {
  contentPlanDecisionSchema,
  contentPlanEvidenceSchema,
  contentPlanSurfaceSchema,
  type WorkflowState,
} from "./repository-workflow-contract.js";

export const contentPlanDetailsSchema = z.object({
  sourceDecisionReference: z
    .string()
    .trim()
    .min(1)
    .describe("Reference to the prior docs-impact decision; do not repeat that judgment here."),
  taskReferences: z.array(z.string().trim().min(1)).max(20).default([]),
  reader: z.string().trim().min(1),
  desiredOutcome: z.string().trim().min(1),
  contentType: z.string().trim().min(1),
  placement: z.string().trim().min(1),
  affectedSurfaces: z.array(contentPlanSurfaceSchema).min(1).max(50),
  outline: z.array(z.string().trim().min(1)).min(1).max(30),
  requiredEvidence: z.array(contentPlanEvidenceSchema).max(30).default([]),
  examples: z.array(z.string().trim().min(1)).max(20).default([]),
  assets: z.array(z.string().trim().min(1)).max(20).default([]),
  unresolvedDecisions: z.array(contentPlanDecisionSchema).max(20).default([]),
  validation: z.array(z.string().trim().min(1)).min(1).max(20),
  definitionOfDone: z.array(z.string().trim().min(1)).min(1).max(20),
});

export const createContentPlanInputSchema = contentPlanDetailsSchema;
export const reviseContentPlanInputSchema = contentPlanDetailsSchema.extend({
  planId: z.string().trim().min(1),
});

type ContentPlanDetails = z.infer<typeof contentPlanDetailsSchema>;
type PersistState = (state: WorkflowState) => Promise<void>;

export async function createContentPlan(
  input: z.infer<typeof createContentPlanInputSchema>,
  state: WorkflowState,
  persistState: PersistState = saveRepositoryWorkflowState,
) {
  if (state.draft?.contentPlanId !== undefined) {
    throw new Error("The active authoring draft already has a content plan. Revise that plan or abandon the draft before starting another one.");
  }

  const details = contentPlanDetailsSchema.parse(input);
  const recommendation = state.editorialRecommendation;
  if (recommendation === undefined) {
    throw new Error("Choose and share an editorial recommendation before creating a substantial-work content plan.");
  }
  if (recommendation.status !== "plan-required") {
    throw new Error(`Editorial intervention ${recommendation.chosenIntervention} does not require a substantial-work content plan.`);
  }
  if (!recommendationMatchesTask(recommendation, details.taskReferences)) {
    throw new Error("The editorial recommendation and content plan refer to different tasks.");
  }
  if (recommendation.sourceDecisionReference !== details.sourceDecisionReference) {
    throw new Error("The editorial recommendation and content plan must reference the same docs-impact decision.");
  }

  const now = new Date().toISOString();
  state.contentPlan = buildContentPlan(details, {
    id: `content-plan-${randomUUID()}`,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await persistState(state);
  return contentPlanResult(state.contentPlan);
}

export async function reviseContentPlan(
  input: z.infer<typeof reviseContentPlanInputSchema>,
  state: WorkflowState,
  persistState: PersistState = saveRepositoryWorkflowState,
) {
  const current = state.contentPlan;
  if (current === undefined || current.id !== input.planId) {
    throw new Error(`Content plan not found: ${input.planId}`);
  }

  state.contentPlan = buildContentPlan(contentPlanDetailsSchema.parse(input), {
    id: current.id,
    revision: current.revision + 1,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  });
  if (state.draft?.contentPlanId === current.id) {
    state.draft.contentPlanRevision = state.contentPlan.revision;
  }
  await persistState(state);
  return contentPlanResult(state.contentPlan);
}

export function inspectContentPlan(state: WorkflowState) {
  return state.contentPlan === undefined ? null : contentPlanResult(state.contentPlan);
}

function buildContentPlan(
  details: ContentPlanDetails,
  identity: { id: string; revision: number; createdAt: string; updatedAt: string },
) {
  const blockers = [
    ...details.requiredEvidence
      .filter(({ status }) => status === "missing")
      .map(({ need }) => `Missing evidence: ${need}`),
    ...details.unresolvedDecisions
      .filter(({ consequential, resolution }) => consequential && resolution === undefined)
      .map(({ question }) => `Consequential decision: ${question}`),
  ];

  return {
    ...identity,
    ...details,
    taskReferences: [...new Set(details.taskReferences)],
    status: blockers.length === 0 ? "ready" as const : "blocked" as const,
    blockers,
  };
}

function contentPlanResult(plan: NonNullable<WorkflowState["contentPlan"]>) {
  const surfaces = plan.affectedSurfaces
    .slice(0, 4)
    .map(({ action, path, destination }) => `${action} ${path}${destination === undefined ? "" : ` -> ${destination}`}`)
    .join("; ");
  const progressUpdate = plan.status === "ready"
    ? `Content plan: ${plan.reader} should be able to ${plan.desiredOutcome}. ${plan.contentType} in ${plan.placement}; ${surfaces}. Next: draft in the reversible sandbox and validate ${plan.validation.slice(0, 3).join(", ")}.`
    : `Content plan paused before drafting: ${plan.blockers.slice(0, 3).join("; ")}`;

  return {
    plan,
    progressUpdate,
    continuesToDraft: plan.status === "ready",
  };
}
