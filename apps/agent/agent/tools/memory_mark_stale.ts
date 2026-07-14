import { defineDynamic, defineTool } from "eve/tools";

import {
  markWorkspaceMemoryStale,
  markWorkspaceMemoryStaleInputSchema,
  workspaceMemoryDetailSchema,
} from "../lib/workspace-memory";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("memory_mark_stale")) return null;
  return defineTool({
  description:
    "Mark an active or proposed workspace memory stale with a reason. Use when provenance has expired, been contradicted, or needs maintainer review before reuse.",
  inputSchema: markWorkspaceMemoryStaleInputSchema,
  outputSchema: workspaceMemoryDetailSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("memory_mark_stale", ctx);
    return markWorkspaceMemoryStale(input);
  },
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        id: output.id,
        status: output.status,
        staleReason: output.staleReason,
        freshnessState: output.freshnessState,
        latestEvent: output.events[0],
      },
    };
  },
  });
} } });
