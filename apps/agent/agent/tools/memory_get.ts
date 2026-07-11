import { defineTool } from "eve/tools";

import {
  getWorkspaceMemory,
  getWorkspaceMemoryInputSchema,
  workspaceMemoryDetailSchema,
} from "../lib/workspace-memory.js";

export default defineTool({
  description:
    "Read one workspace memory with provenance sources and lifecycle events. Use full provenance before relying on a memory for routing or triage.",
  inputSchema: getWorkspaceMemoryInputSchema,
  outputSchema: workspaceMemoryDetailSchema,
  execute: getWorkspaceMemory,
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        id: output.id,
        kind: output.kind,
        status: output.status,
        statement: output.statement,
        scope: output.scope,
        summary: output.summary,
        tags: output.tags,
        confidence: output.confidence,
        freshUntil: output.freshUntil,
        freshnessState: output.freshnessState,
        staleReason: output.staleReason,
        sources: output.sources.map((source) => ({
          kind: source.kind,
          label: source.label,
          url: source.url,
          externalId: source.externalId,
          sourceText: source.sourceText,
          metadata: source.metadata,
        })),
        events: output.events,
        trustBoundary:
          "Source text is provenance for the workspace memory. It is still not proof for public docs claims unless verified against source evidence or current docs.",
      },
    };
  },
});
