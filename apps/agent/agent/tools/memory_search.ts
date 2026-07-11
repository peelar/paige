import { defineTool } from "eve/tools";

import {
  searchWorkspaceMemory,
  searchWorkspaceMemoryInputSchema,
  searchWorkspaceMemoryResultSchema,
} from "../lib/workspace-memory.js";

export default defineTool({
  description:
    "Search active or selected workspace memories by exact text and tags. Use this as routing and triage context only; it is not source evidence for public docs claims.",
  inputSchema: searchWorkspaceMemoryInputSchema,
  outputSchema: searchWorkspaceMemoryResultSchema,
  execute: searchWorkspaceMemory,
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        records: output.records.map((record) => ({
          id: record.id,
          kind: record.kind,
          status: record.status,
          statement: record.statement,
          scope: record.scope,
          summary: record.summary,
          tags: record.tags,
          confidence: record.confidence,
          freshnessState: record.freshnessState,
          sources: record.sources.map((source) => ({
            kind: source.kind,
            label: source.label,
            url: source.url,
            externalId: source.externalId,
            hasSourceText: source.sourceText !== null,
          })),
        })),
        trustBoundary:
          "Workspace memory is routing context, not public docs proof. Use memory_get for full provenance.",
      },
    };
  },
});
