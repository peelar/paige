import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  loadRepositoryWorkflowState,
  readRepositoryFile,
  saveRepositoryWorkflowState,
} from "../lib/repository-workflow.js";

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
    const state = await loadRepositoryWorkflowState();
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
