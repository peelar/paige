import { defineTool } from "eve/tools";

import {
  docsSignalDetailSchema,
  getDocsSignal,
  getDocsSignalInputSchema,
} from "../lib/docs-signals.js";

export default defineTool({
  description:
    "Read one docs signal with its source provenance, related links, artifacts, and lifecycle events.",
  inputSchema: getDocsSignalInputSchema,
  outputSchema: docsSignalDetailSchema,
  execute: getDocsSignal,
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        id: output.id,
        status: output.status,
        sourceKind: output.sourceKind,
        sourceSummary: output.sourceSummary,
        extractedClaims: output.extractedClaims,
        likelyDocsConcepts: output.likelyDocsConcepts,
        likelyDocsPages: output.likelyDocsPages,
        productSurfaces: output.productSurfaces,
        missingEvidence: output.missingEvidence,
        uncertainty: output.uncertainty,
        sources: output.sources.map((source) => ({
          kind: source.kind,
          provider: source.provider,
          providerId: source.providerId,
          permalink: source.permalink,
          title: source.title,
          authors: source.authors,
          capturedAt: source.capturedAt,
          hasSourceText: source.sourceText !== null,
        })),
        links: output.links,
        artifacts: output.artifacts,
        events: output.events,
      },
    };
  },
});
