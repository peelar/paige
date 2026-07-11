import { defineTool } from "eve/tools";

import {
  proposeWorkspaceMemory,
  proposeWorkspaceMemoryInputSchema,
  proposeWorkspaceMemoryResultSchema,
} from "../lib/workspace-memory.js";

export default defineTool({
  description:
    "Propose a provenance-backed workspace memory for future docs routing or triage. This creates proposed memory only; promotion requires a separate explicit lifecycle step.",
  inputSchema: proposeWorkspaceMemoryInputSchema,
  outputSchema: proposeWorkspaceMemoryResultSchema,
  execute: proposeWorkspaceMemory,
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        record: {
          id: output.record.id,
          kind: output.record.kind,
          status: output.record.status,
          statement: output.record.statement,
          scope: output.record.scope,
          tags: output.record.tags,
          confidence: output.record.confidence,
          freshnessState: output.record.freshnessState,
          sources: output.record.sources.map((source) => ({
            kind: source.kind,
            label: source.label,
            url: source.url,
            externalId: source.externalId,
            hasSourceText: source.sourceText !== null,
          })),
        },
        nextAction:
          "This memory is proposed only. Promote it explicitly before treating it as active workspace memory. Stored source text is provenance, not proof for public docs claims.",
      },
    };
  },
});
