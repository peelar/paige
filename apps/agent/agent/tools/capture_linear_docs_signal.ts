import { defineTool } from "eve/tools";

import {
  captureLinearDocsSignal,
  captureLinearDocsSignalInputSchema,
  captureLinearDocsSignalResultSchema,
} from "../lib/linear-docs-signal.js";

export default defineTool({
  description:
    "Capture a delegated or prompted Linear Agent Session issue as structured issue-tracker-item context, create or update the docs signal queue, run the shared docs-impact decision model, and return Linear Agent Activity reply guidance. Use this for Linear docs-signal intake before any patch or writeback workflow.",
  inputSchema: captureLinearDocsSignalInputSchema,
  outputSchema: captureLinearDocsSignalResultSchema,
  execute: captureLinearDocsSignal,
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
          productSurfaces: output.signal.productSurfaces,
          missingEvidence: output.signal.missingEvidence,
          uncertainty: output.signal.uncertainty,
        },
        externalContext: output.externalContext,
        decision: output.decision,
        shouldVerifyCurrentDocs: output.shouldVerifyCurrentDocs,
        verificationStatus: output.verificationStatus,
        replyGuidance: output.replyGuidance,
        nextAction:
          "Reply through Linear Agent Activities from this structured result. Stored Linear source text is provenance and is not included in model output. Do not patch or publish without a later approved handoff.",
      },
    };
  },
});
