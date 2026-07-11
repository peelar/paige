import { defineTool } from "eve/tools";

import {
  docsSignalDetailSchema,
  updateDocsSignalLifecycle,
  updateDocsSignalLifecycleInputSchema,
} from "../lib/docs-signals.js";

export default defineTool({
  description:
    "Update a docs signal lifecycle status with a reason, optional missing evidence, links, or artifacts. Use this for workflow state changes, not arbitrary data edits.",
  inputSchema: updateDocsSignalLifecycleInputSchema,
  outputSchema: docsSignalDetailSchema,
  execute: updateDocsSignalLifecycle,
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        id: output.id,
        status: output.status,
        missingEvidence: output.missingEvidence,
        uncertainty: output.uncertainty,
        nextActionAt: output.nextActionAt,
        latestEvent: output.events[0],
      },
    };
  },
});
