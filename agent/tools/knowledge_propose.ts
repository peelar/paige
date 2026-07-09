import { defineTool } from "eve/tools";

import {
  proposeWorkspaceKnowledge,
  proposeWorkspaceKnowledgeInputSchema,
  proposeWorkspaceKnowledgeResultSchema,
} from "../lib/workspace-knowledge.js";

export default defineTool({
  description:
    "Propose a provenance-backed workspace knowledge record for future docs routing or triage. This creates proposed knowledge only; promotion requires a separate explicit lifecycle step.",
  inputSchema: proposeWorkspaceKnowledgeInputSchema,
  outputSchema: proposeWorkspaceKnowledgeResultSchema,
  execute: proposeWorkspaceKnowledge,
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
          "This record is proposed only. Promote it explicitly before treating it as active workspace knowledge. Stored source text is provenance, not proof for public docs claims.",
      },
    };
  },
});
