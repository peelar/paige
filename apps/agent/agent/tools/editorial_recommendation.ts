import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  createEditorialRecommendation,
  createEditorialRecommendationInputSchema,
  inspectEditorialRecommendation,
  reviseEditorialRecommendation,
  reviseEditorialRecommendationInputSchema,
} from "../lib/editorial-recommendation.js";
import { editorialRecommendationSchema } from "../lib/repository-workflow-contract.js";
import { loadOrMaterializeRepositoryWorkflowState } from "../lib/working-repository-lifecycle.js";

const inputSchema = z.discriminatedUnion("mode", [
  createEditorialRecommendationInputSchema.extend({ mode: z.literal("create") }),
  z.object({ mode: z.literal("revise"), recommendation: reviseEditorialRecommendationInputSchema }),
  z.object({ mode: z.literal("inspect") }),
]);
const resultSchema = z.object({
  recommendation: editorialRecommendationSchema,
  summary: z.string(),
  nextAction: z.string(),
});
const outputSchema = z.union([
  resultSchema.extend({ mode: z.literal("create") }),
  resultSchema.extend({ mode: z.literal("revise") }),
  z.object({ mode: z.literal("inspect"), result: resultSchema.nullable() }),
]);

export default defineTool({
  description: "Record, revise, or inspect Paige's concise editorial intervention after current-docs verification. Choose the smallest intervention that solves the reader problem, explain repository evidence and at most three important alternatives, and share the summary. This is model judgment, not an approval gate. Substantial choices hand off to content_plan; blocked choices pause before authoring.",
  inputSchema,
  outputSchema,
  async execute(input, ctx) {
    const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
    switch (input.mode) {
      case "create": return { mode: "create" as const, ...(await createEditorialRecommendation(input, state)) };
      case "revise": return { mode: "revise" as const, ...(await reviseEditorialRecommendation(input.recommendation, state)) };
      case "inspect": return { mode: "inspect" as const, result: inspectEditorialRecommendation(state) };
    }
  },
});
