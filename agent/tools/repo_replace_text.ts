import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  loadRepositoryWorkflowState,
  replaceRepositoryText,
  saveRepositoryWorkflowState,
} from "../lib/repository-workflow.js";

export default defineTool({
  description:
    "Replace exact text in one file in the materialized working documentation repository through the policy-aware repository runner.",
  inputSchema: z.object({
    path: z.string().trim().min(1),
    expectedText: z.string().min(1),
    replacementText: z.string().min(1),
    reason: z.string().trim().min(1),
  }),
  outputSchema: z.object({
    path: z.string(),
    patched: z.boolean(),
  }),
  async execute({ path, expectedText, replacementText }, ctx) {
    const state = await loadRepositoryWorkflowState();
    await replaceRepositoryText(
      ctx,
      state.repositoryInput.workingDocumentationRepository,
      path,
      expectedText,
      replacementText,
      state.actionProvenance,
    );
    await saveRepositoryWorkflowState(state);
    return { path, patched: true };
  },
});
