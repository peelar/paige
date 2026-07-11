import type { ToolContext } from "eve/tools";

import {
  detectScenarioKind,
  runScenarioFixture,
} from "./docs-maintenance-scenarios.js";
import {
  exportRepositoryDiff,
  listChangedFiles,
} from "./repository-operations.js";
import {
  recordRepositoryAction,
  type RepositoryActionRecord,
} from "./repository-materialization.js";
import { saveRepositoryWorkflowState } from "./repository-workflow-state.js";
import type {
  DocsMaintenanceWorkflowResult,
  RunDocsMaintenanceScenarioInput,
} from "./repository-workflow-contract.js";
import {
  loadOrMaterializeRepositoryWorkflowState,
  reuseMaterializedWorkingRepository,
} from "./working-repository-lifecycle.js";

export {
  repositoryActionRecordSchema,
  type RepositoryActionRecord,
} from "./repository-materialization.js";
export {
  docsMaintenanceWorkflowResultSchema,
  documentationImpactReportSchema,
  impactDecisionSchema,
  repositoryCheckNameSchema,
  repositoryCheckResultSchema,
  repositoryMaterializationSchema,
  runDocsMaintenanceScenarioInputSchema,
  type DocsMaintenanceWorkflowResult,
  type DocumentationImpactReport,
  type RepositoryCheckName,
  type RepositoryCheckResult,
  type RunDocsMaintenanceScenarioInput,
  type WorkflowState,
} from "./repository-workflow-contract.js";
export {
  exportRepositoryDiff,
  listChangedFiles,
  readRepositoryFile,
  replaceRepositoryText,
  runRepositoryCheck,
  searchRepository,
} from "./repository-operations.js";
export {
  loadRepositoryWorkflowState,
  saveConfiguredRepositoryInput,
  saveRepositoryWorkflowState,
} from "./repository-workflow-state.js";
export {
  loadOrMaterializeRepositoryWorkflowState,
  materializeWorkingRepository,
  reuseMaterializedWorkingRepository,
  validateWorkingRepositorySetup,
} from "./working-repository-lifecycle.js";

const RAW_SANDBOX_TOOLS_POLICY =
  "Repository work is executed through authored tools and the policy-aware repository workflow; raw Eve bash/read_file/write_file/glob/grep tools are disabled for this agent.";

export async function runDocsMaintenanceScenario(
  input: RunDocsMaintenanceScenarioInput,
  ctx: ToolContext,
): Promise<DocsMaintenanceWorkflowResult> {
  const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
  const repositoryInput = state.repositoryInput;
  const repository = repositoryInput.workingDocumentationRepository;
  const sandbox = await ctx.getSandbox();
  const actionProvenance: RepositoryActionRecord[] = [...state.actionProvenance];
  const scenarioKind = detectScenarioKind(input.scenarioText, repositoryInput.externalContext);

  try {
    const materialization = await reuseMaterializedWorkingRepository(
      ctx,
      state,
      actionProvenance,
    );
    const report = await runScenarioFixture(
      ctx,
      scenarioKind,
      repositoryInput,
      actionProvenance,
    );
    const changedFiles = await listChangedFiles(ctx, repository, actionProvenance);
    const diff = await exportRepositoryDiff(ctx, repository, actionProvenance);

    const result: DocsMaintenanceWorkflowResult = {
      ok: report.checks.every((check) => check.status === "passed"),
      scenarioKind,
      materialization,
      report,
      changedFiles,
      diff,
      noDiff: changedFiles.length === 0 && diff.trim().length === 0,
      actionProvenance,
      rawSandboxToolsPolicy: RAW_SANDBOX_TOOLS_POLICY,
    };

    await sandbox.writeTextFile({
      path: ".docs-agent/last-result.json",
      content: `${JSON.stringify(result, null, 2)}\n`,
    });
    await saveRepositoryWorkflowState({
      repositoryInput,
      materialization,
      actionProvenance,
      lastResult: result,
    });

    return result;
  } catch (error) {
    const materialization = {
      repositoryUrl: repository.source.url,
      requestedRef: repository.ref,
      docsRoot: repository.docsRoot,
      sandboxPath: repository.sandboxPath,
      status: "failed" as const,
    };
    const reason = error instanceof Error ? error.message : String(error);
    actionProvenance.push(
      recordRepositoryAction(repository, "workflow", "failure", { reason }),
    );

    return {
      ok: false,
      scenarioKind,
      materialization,
      report: {
        decision: "ask-maintainer",
        affectedPages: [],
        proposedAction: "Fix the repository workflow failure before attempting docs work.",
        evidence: [reason],
        consideredPages: [],
        uncertainty: ["The workflow failed before a reliable docs decision could be made."],
        patchSummary: "No patch prepared.",
        checks: [],
      },
      changedFiles: [],
      diff: "",
      noDiff: true,
      actionProvenance,
      rawSandboxToolsPolicy: RAW_SANDBOX_TOOLS_POLICY,
    };
  }
}
