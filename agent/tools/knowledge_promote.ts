import { defineTool } from "eve/tools";

import {
  promoteWorkspaceKnowledge,
  promoteWorkspaceKnowledgeInputSchema,
  workspaceKnowledgeDetailSchema,
} from "../lib/workspace-knowledge.js";

export default defineTool({
  description:
    "Promote a proposed workspace knowledge record to active after explicit maintainer or workflow confirmation. This makes it eligible for compact dynamic-instruction loading.",
  inputSchema: promoteWorkspaceKnowledgeInputSchema,
  outputSchema: workspaceKnowledgeDetailSchema,
  execute: promoteWorkspaceKnowledge,
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
