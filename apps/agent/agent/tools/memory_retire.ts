import { defineDynamic, defineTool } from "eve/tools";

import {
  retireWorkspaceMemory,
  retireWorkspaceMemoryInputSchema,
  workspaceMemoryDetailSchema,
} from "../lib/workspace-memory";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("memory_retire")) return null;
  return defineTool({
  description:
    "Retire a workspace memory with a reason. Use when the memory should no longer be returned by normal memory search or dynamic instructions.",
  inputSchema: retireWorkspaceMemoryInputSchema,
  outputSchema: workspaceMemoryDetailSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("memory_retire", ctx);
    return retireWorkspaceMemory(input);
  },
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        id: output.id,
        status: output.status,
        retiredAt: output.retiredAt,
        latestEvent: output.events[0],
      },
    };
  },
  });
} } });
