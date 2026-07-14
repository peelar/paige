import { defineDynamic, defineTool } from "eve/tools";

import {
  captureSlackDocsSignal,
  captureSlackDocsSignalInputSchema,
  captureSlackDocsSignalResultSchema,
} from "../lib/slack-docs-signal";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({
  events: {
    "step.started": async (event, context) => {
      if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("capture_slack_docs_signal")) return null;
      return defineTool({
        description:
          "Load the docs-signal-intake skill, then capture an explicit Slack mention or DM thread as structured communication-thread context, create or return the existing docs signal through the shared provider-neutral intake pipeline, and return Slack reply guidance. Use this before any patch or writeback workflow.",
        inputSchema: captureSlackDocsSignalInputSchema,
        outputSchema: captureSlackDocsSignalResultSchema,
        async execute(input, ctx) {
          await requireCapabilityToolExecution("capture_slack_docs_signal", ctx);
          return captureSlackDocsSignal(input);
        },
        toModelOutput(output) {
          return { type: "json", value: {
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
          } };
        },
      });
    },
  },
});
