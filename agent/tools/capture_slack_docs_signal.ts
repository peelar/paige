import { defineTool } from "eve/tools";

import {
  captureSlackDocsSignal,
  captureSlackDocsSignalInputSchema,
  captureSlackDocsSignalResultSchema,
} from "../lib/slack-docs-signal.js";

export default defineTool({
  description:
    "Capture an explicit Slack mention or DM thread as structured communication-thread context, create or update the docs signal queue, run the shared docs-impact decision model, and return Slack reply guidance. Use this for Slack docs-signal intake before any patch or writeback workflow.",
  inputSchema: captureSlackDocsSignalInputSchema,
  outputSchema: captureSlackDocsSignalResultSchema,
  execute: captureSlackDocsSignal,
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
          "Reply in-thread from this structured result. Stored Slack source text is provenance and is not included in model output. Do not patch or publish without a later approved handoff.",
      },
    };
  },
});
