import { defineTool } from "eve/tools";

import {
  getWorkspaceKnowledge,
  getWorkspaceKnowledgeInputSchema,
  workspaceKnowledgeDetailSchema,
} from "../lib/workspace-knowledge.js";

export default defineTool({
  description:
    "Read one workspace knowledge record with provenance sources and lifecycle events. Use full provenance before relying on a record for routing or triage.",
  inputSchema: getWorkspaceKnowledgeInputSchema,
  outputSchema: workspaceKnowledgeDetailSchema,
  execute: getWorkspaceKnowledge,
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
          "Source text is provenance for the knowledge record. It is still not proof for public docs claims unless verified against source evidence or current docs.",
      },
    };
  },
});
