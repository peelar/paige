import { defineTool } from "eve/tools";

import {
  verifyDocsSignalCurrentDocs,
  verifyDocsSignalCurrentDocsInputSchema,
  verifyDocsSignalCurrentDocsResultSchema,
} from "../lib/docs-signal-verification.js";

export default defineTool({
  description:
    "Verify current docs for a captured docs signal by materializing the configured working documentation repository, reading likely docs pages, searching likely docs terms, recording a docs-verified lifecycle event, and returning evidence. Use after a signal decision requires current-docs verification. This tool does not patch, publish, or open a PR.",
  inputSchema: verifyDocsSignalCurrentDocsInputSchema,
  outputSchema: verifyDocsSignalCurrentDocsResultSchema,
  execute: verifyDocsSignalCurrentDocs,
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        signal: {
          id: output.signal.id,
          status: output.signal.status,
          sourceSummary: output.signal.sourceSummary,
          likelyDocsPages: output.signal.likelyDocsPages,
          missingEvidence: output.signal.missingEvidence,
          uncertainty: output.signal.uncertainty,
        },
        materialization: output.materialization,
        consideredPages: output.consideredPages,
        searchResults: output.searchResults,
        checks: output.checks.map((check) => ({
          name: check.name,
          status: check.status,
          exitCode: check.exitCode,
        })),
        changedFiles: output.changedFiles,
        noDiff: output.noDiff,
        actionProvenance: output.actionProvenance,
        verificationSummary: output.verificationSummary,
        nextAction:
          "Use this verification evidence to decide whether current docs already cover the signal, are likely stale, need maintainer input, or should move to a later approved patch handoff. Do not publish from this tool result.",
      },
    };
  },
});
