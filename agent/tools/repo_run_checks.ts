import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  loadRepositoryWorkflowState,
  repositoryCheckNameSchema,
  repositoryCheckResultSchema,
  runRepositoryCheck,
  saveRepositoryWorkflowState,
} from "../lib/repository-workflow.js";

export default defineTool({
  description:
    "Run allowed checks in the materialized working documentation repository through the policy-aware repository runner.",
  inputSchema: z.object({
    checks: z.array(repositoryCheckNameSchema).nonempty(),
  }),
  outputSchema: z.object({
    checks: z.array(repositoryCheckResultSchema),
  }),
  async execute({ checks }, ctx) {
    const state = await loadRepositoryWorkflowState();
    const results = [];
    for (const check of checks) {
      results.push(
        await runRepositoryCheck(
          ctx,
          state.repositoryInput.workingDocumentationRepository,
          check,
          state.actionProvenance,
        ),
      );
    }
    await saveRepositoryWorkflowState(state);
    return { checks: results };
  },
});
