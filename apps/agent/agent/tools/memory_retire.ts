import { defineTool } from "eve/tools";

import {
  retireWorkspaceMemory,
  retireWorkspaceMemoryInputSchema,
  workspaceMemoryDetailSchema,
} from "../lib/workspace-memory.js";

export default defineTool({
  description:
    "Retire a workspace memory with a reason. Use when the memory should no longer be returned by normal memory search or dynamic instructions.",
  inputSchema: retireWorkspaceMemoryInputSchema,
  outputSchema: workspaceMemoryDetailSchema,
  execute: retireWorkspaceMemory,
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
