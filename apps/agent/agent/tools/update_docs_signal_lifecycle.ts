import { defineTool } from "eve/tools";

import {
  docsSignalDetailSchema,
  updateDocsSignalLifecycle,
  updateDocsSignalLifecycleInputSchema,
} from "../lib/docs-signals.js";

export default defineTool({
  description:
    "Record a non-privileged docs-signal triage change: captured, needs a maintainer answer, or needs source evidence. Verification, patch, draft-PR, skipped, and closed states are owned by their dedicated workflow tools.",
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
