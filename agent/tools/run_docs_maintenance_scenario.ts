import { defineTool } from "eve/tools";

import {
  docsMaintenanceWorkflowResultSchema,
  runDocsMaintenanceScenario,
  runDocsMaintenanceScenarioInputSchema,
} from "../lib/repository-workflow.js";

export default defineTool({
  description:
    "Run the sandboxed docs-maintenance workflow for a provided working documentation repository scenario. Use this for repository materialization, docs impact analysis, patching, checks, and diff export.",
  inputSchema: runDocsMaintenanceScenarioInputSchema,
  outputSchema: docsMaintenanceWorkflowResultSchema,
  execute: runDocsMaintenanceScenario,
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        ok: output.ok,
        decision: output.report.decision,
        scenarioKind: output.scenarioKind,
        report: output.report,
        repository: output.materialization.repositoryUrl,
        materialization: output.materialization,
        sandboxPath: output.materialization.sandboxPath,
        changedFiles: output.changedFiles,
        noDiff: output.noDiff,
        diff: output.diff,
        actionProvenance: output.actionProvenance,
        patchSummary: output.report.patchSummary,
        checks: output.report.checks.map((check) => ({
          name: check.name,
          status: check.status,
          exitCode: check.exitCode,
        })),
        evidence: output.report.evidence,
        consideredPages: output.report.consideredPages,
        uncertainty: output.report.uncertainty,
      },
    };
  },
});
