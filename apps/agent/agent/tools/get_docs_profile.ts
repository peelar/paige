import { defineTool } from "eve/tools";
import { cachedDocsProfileSchema } from "@docs-agent/control-plane/agent";
import { z } from "zod";

import { ensureDocsProfile, loadTaskExamples } from "../lib/docs-profile.js";
import { loadOrMaterializeRepositoryWorkflowState } from "../lib/working-repository-lifecycle.js";

const inputSchema = z.object({
  taskPaths: z.array(z.string().trim().min(1)).max(5).default([]),
  refreshReason: z.enum(["maintainer-correction", "contradiction", "manual-refresh"]).optional(),
});
const outputSchema = z.object({
  profile: cachedDocsProfileSchema,
  taskExamples: z.array(z.object({ path: z.string(), excerpt: z.string() })),
});

export default defineTool({
  description: "Read or refresh the current repository docs profile and load up to five task-relevant pages. Use before writing so repository-wide conventions and nearby examples both inform the work.",
  inputSchema,
  outputSchema,
  async execute(input, ctx) {
    const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
    const repository = state.repositoryInput.workingDocumentationRepository;
    const profile = await ensureDocsProfile({ ctx, repository, materialization: state.materialization, refreshReason: input.refreshReason });
    const taskExamples = await loadTaskExamples({ ctx, repository, paths: input.taskPaths });
    return { profile, taskExamples };
  },
});
