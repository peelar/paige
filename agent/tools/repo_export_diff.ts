import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  exportRepositoryDiff,
  listChangedFiles,
  loadRepositoryWorkflowState,
  saveRepositoryWorkflowState,
} from "../lib/repository-workflow.js";

export default defineTool({
  description:
    "Export the current git diff from the materialized working documentation repository through the policy-aware repository runner.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    changedFiles: z.array(z.string()),
    diff: z.string(),
    noDiff: z.boolean(),
  }),
  async execute(_, ctx) {
    const state = await loadRepositoryWorkflowState();
    const changedFiles = await listChangedFiles(
      ctx,
      state.repositoryInput.workingDocumentationRepository,
      state.actionProvenance,
    );
    const diff = await exportRepositoryDiff(
      ctx,
      state.repositoryInput.workingDocumentationRepository,
      state.actionProvenance,
    );
    await saveRepositoryWorkflowState(state);
    return { changedFiles, diff, noDiff: changedFiles.length === 0 && diff.trim().length === 0 };
  },
});
