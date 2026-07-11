import { defineTool } from "eve/tools";

import {
  createDocsSignal,
  createDocsSignalInputSchema,
  createDocsSignalResultSchema,
} from "../lib/docs-signals.js";

export default defineTool({
  description:
    "Create or dedupe a provider-neutral docs signal from structured provenance. Use this for Slack, Linear, watched release, scheduled scan, or manual context that may need docs verification later.",
  inputSchema: createDocsSignalInputSchema,
  outputSchema: createDocsSignalResultSchema,
  execute: createDocsSignal,
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        created: output.created,
        signal: {
          id: output.signal.id,
          status: output.signal.status,
          sourceKind: output.signal.sourceKind,
          sourceSummary: output.signal.sourceSummary,
          extractedClaims: output.signal.extractedClaims,
          likelyDocsConcepts: output.signal.likelyDocsConcepts,
          likelyDocsPages: output.signal.likelyDocsPages,
          missingEvidence: output.signal.missingEvidence,
          uncertainty: output.signal.uncertainty,
        },
        nextAction:
          "Use this signal id for later docs-impact decisions, verification, or lifecycle updates. Stored source text is provenance, not proof for public docs claims.",
      },
    };
  },
});
