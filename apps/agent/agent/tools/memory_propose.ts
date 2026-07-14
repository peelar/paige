import { defineDynamic, defineTool } from "eve/tools";

import {
  proposeWorkspaceMemory,
  proposeWorkspaceMemoryInputSchema,
  proposeWorkspaceMemoryResultSchema,
} from "../lib/workspace-memory";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("memory_propose")) return null;
  return defineTool({
  description:
    "Propose a provenance-backed workspace memory for future docs routing or triage. This creates proposed memory only; promotion requires a separate explicit lifecycle step.",
  inputSchema: proposeWorkspaceMemoryInputSchema,
  outputSchema: proposeWorkspaceMemoryResultSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("memory_propose", ctx);
    return proposeWorkspaceMemory(input);
  },
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
} } });
