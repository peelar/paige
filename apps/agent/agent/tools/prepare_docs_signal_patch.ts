import { defineTool } from "eve/tools";

import {
  prepareDocsSignalPatch,
  prepareDocsSignalPatchInputSchema,
  prepareDocsSignalPatchResultSchema,
} from "../lib/docs-signal-patch-handoff.js";

export default defineTool({
  description:
    "Prepare a minimal docs patch or close as no-patch from an existing verified docs signal. Reuses the configured working documentation repository, existing patch/check/diff workflow state, and records signal lifecycle. This does not publish; draft PR creation still requires explicit approval through publish_working_repository_pr.",
  inputSchema: prepareDocsSignalPatchInputSchema,
  outputSchema: prepareDocsSignalPatchResultSchema,
  execute: prepareDocsSignalPatch,
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        ok: output.ok,
        outcome: output.outcome,
        signal: {
          id: output.signal.id,
          status: output.signal.status,
          sourceSummary: output.signal.sourceSummary,
          missingEvidence: output.signal.missingEvidence,
          uncertainty: output.signal.uncertainty,
        },
        decision: output.report.decision,
        patchSummary: output.report.patchSummary,
        changedFiles: output.changedFiles,
        noDiff: output.noDiff,
        checks: output.report.checks.map((check) => ({
          name: check.name,
          status: check.status,
          exitCode: check.exitCode,
        })),
        approvalRequiredForPublish: output.approvalRequiredForPublish,
        nextAction:
          output.outcome === "patch-prepared"
            ? "Ask for explicit approval before calling publish_working_repository_pr. Include signalId when publishing so the signal can move to draft-pr-opened."
            : "Report the no-patch or failed-check outcome and do not call publish_working_repository_pr.",
      },
    };
  },
});
