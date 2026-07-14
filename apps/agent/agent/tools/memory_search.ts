import { defineDynamic, defineTool } from "eve/tools";

import {
  searchWorkspaceMemory,
  searchWorkspaceMemoryInputSchema,
  searchWorkspaceMemoryResultSchema,
} from "../lib/workspace-memory";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("memory_search")) return null;
  return defineTool({
  description:
    "Search active or selected workspace memories by exact text and tags. Use this as routing and triage context only; it is not source evidence for public docs claims.",
  inputSchema: searchWorkspaceMemoryInputSchema,
  outputSchema: searchWorkspaceMemoryResultSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("memory_search", ctx);
    return searchWorkspaceMemory(input);
  },
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
} } });
