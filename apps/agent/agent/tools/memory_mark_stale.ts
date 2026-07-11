import { defineTool } from "eve/tools";

import {
  markWorkspaceMemoryStale,
  markWorkspaceMemoryStaleInputSchema,
  workspaceMemoryDetailSchema,
} from "../lib/workspace-memory.js";

export default defineTool({
  description:
    "Mark an active or proposed workspace memory stale with a reason. Use when provenance has expired, been contradicted, or needs maintainer review before reuse.",
  inputSchema: markWorkspaceMemoryStaleInputSchema,
  outputSchema: workspaceMemoryDetailSchema,
  execute: markWorkspaceMemoryStale,
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
