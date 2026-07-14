import { defineDynamic, defineTool } from "eve/tools";
import { cachedDocsProfileSchema } from "@docs-agent/control-plane/agent";
import { z } from "zod";

import { ensureDocsProfile, loadTaskExamples } from "../lib/docs-profile";
import { saveRepositoryWorkflowState } from "../lib/repository-workflow-state";
import { requireSetupReady } from "../lib/setup-state";
import {
  loadOrMaterializeRepositoryWorkflowState,
  runWorkingRepositoryOperationSerially,
  workingRepositoryOperationKey,
} from "../lib/working-repository-lifecycle";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

const inputSchema = z.object({
  taskPaths: z.array(z.string().trim().min(1)).max(5).default([]),
  refreshReason: z.enum(["maintainer-correction", "contradiction", "manual-refresh"]).optional(),
});
const outputSchema = z.object({
  profile: cachedDocsProfileSchema,
  taskExamples: z.array(z.object({ path: z.string(), excerpt: z.string() })),
});

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("get_docs_profile")) return null;
  return defineTool({
  description: "Read or refresh the current repository docs profile and load up to five task-relevant pages. Use before writing so repository-wide conventions and nearby examples both inform the work.",
  inputSchema,
  outputSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("get_docs_profile", ctx);
    const setup = await requireSetupReady("docs-maintenance");
    const configuredRepository = setup.workingRepositoryInput.workingDocumentationRepository;
    const operationKey = workingRepositoryOperationKey(ctx.session.id, configuredRepository);
    return runWorkingRepositoryOperationSerially(operationKey, async () => {
      const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
      const repository = state.repositoryInput.workingDocumentationRepository;
      const profile = await ensureDocsProfile({
        ctx,
        repository,
        materialization: state.materialization,
        actionProvenance: state.actionProvenance,
        refreshReason: input.refreshReason,
      });
      const taskExamples = await loadTaskExamples({
        ctx,
        repository,
        materialization: state.materialization,
        actionProvenance: state.actionProvenance,
        paths: input.taskPaths,
      });
      await saveRepositoryWorkflowState(state);
      return { profile, taskExamples };
    });
  },
  });
} } });
