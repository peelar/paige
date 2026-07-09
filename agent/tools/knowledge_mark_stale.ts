import { defineTool } from "eve/tools";

import {
  markWorkspaceKnowledgeStale,
  markWorkspaceKnowledgeStaleInputSchema,
  workspaceKnowledgeDetailSchema,
} from "../lib/workspace-knowledge.js";

export default defineTool({
  description:
    "Mark an active or proposed workspace knowledge record stale with a reason. Use when provenance has expired, been contradicted, or needs maintainer review before reuse.",
  inputSchema: markWorkspaceKnowledgeStaleInputSchema,
  outputSchema: workspaceKnowledgeDetailSchema,
  execute: markWorkspaceKnowledgeStale,
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
