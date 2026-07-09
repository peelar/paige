import { defineTool } from "eve/tools";

import {
  retireWorkspaceKnowledge,
  retireWorkspaceKnowledgeInputSchema,
  workspaceKnowledgeDetailSchema,
} from "../lib/workspace-knowledge.js";

export default defineTool({
  description:
    "Retire a workspace knowledge record with a reason. Use when the record should no longer be returned by normal knowledge search or dynamic instructions.",
  inputSchema: retireWorkspaceKnowledgeInputSchema,
  outputSchema: workspaceKnowledgeDetailSchema,
  execute: retireWorkspaceKnowledge,
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
