import { defineDynamic, defineTool } from "eve/tools";

import {
  promoteWorkspaceMemory,
  promoteWorkspaceMemoryInputSchema,
  workspaceMemoryDetailSchema,
} from "../lib/workspace-memory";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("memory_promote")) return null;
  return defineTool({
  description:
    "Promote a proposed workspace memory to active after explicit maintainer or workflow confirmation. This makes it eligible for compact dynamic-instruction loading.",
  inputSchema: promoteWorkspaceMemoryInputSchema,
  outputSchema: workspaceMemoryDetailSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("memory_promote", ctx);
    return promoteWorkspaceMemory(input);
  },
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        id: output.id,
        status: output.status,
        statement: output.statement,
        tags: output.tags,
        confidence: output.confidence,
        freshUntil: output.freshUntil,
        freshnessState: output.freshnessState,
        latestEvent: output.events[0],
      },
    };
  },
  });
} } });
