import { defineDynamic, defineTool } from "eve/tools";

import {
  getWorkspaceMemory,
  getWorkspaceMemoryInputSchema,
  workspaceMemoryDetailSchema,
} from "../lib/workspace-memory";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("memory_get")) return null;
  return defineTool({
  description:
    "Read one workspace memory with provenance sources and lifecycle events. Use full provenance before relying on a memory for routing or triage.",
  inputSchema: getWorkspaceMemoryInputSchema,
  outputSchema: workspaceMemoryDetailSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("memory_get", ctx);
    return getWorkspaceMemory(input);
  },
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
} } });
