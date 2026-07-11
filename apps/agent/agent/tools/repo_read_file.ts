import { defineTool } from "eve/tools";
import { z } from "zod";

import { readRepositoryFile } from "../lib/repository-operations.js";
import { saveRepositoryWorkflowState } from "../lib/repository-workflow-state.js";
import { loadOrMaterializeRepositoryWorkflowState } from "../lib/working-repository-lifecycle.js";

export default defineTool({
  description:
    "Read one file from the materialized working documentation repository through the policy-aware repository runner.",
  inputSchema: z.object({
    path: z.string().trim().min(1),
  }),
  outputSchema: z.object({
    path: z.string(),
    content: z.string(),
  }),
  async execute({ path }, ctx) {
    const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
    const content = await readRepositoryFile(
      ctx,
      state.repositoryInput.workingDocumentationRepository,
      path,
      state.actionProvenance,
    );
    await saveRepositoryWorkflowState(state);
    return { path, content };
  },
});
