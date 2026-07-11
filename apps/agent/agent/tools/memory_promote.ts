import { defineTool } from "eve/tools";

import {
  promoteWorkspaceMemory,
  promoteWorkspaceMemoryInputSchema,
  workspaceMemoryDetailSchema,
} from "../lib/workspace-memory.js";

export default defineTool({
  description:
    "Promote a proposed workspace memory to active after explicit maintainer or workflow confirmation. This makes it eligible for compact dynamic-instruction loading.",
  inputSchema: promoteWorkspaceMemoryInputSchema,
  outputSchema: workspaceMemoryDetailSchema,
  execute: promoteWorkspaceMemory,
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
