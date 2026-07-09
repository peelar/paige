import { defineDynamic, defineInstructions } from "eve/instructions";

import {
  buildWorkspaceKnowledgeInstructions,
  loadWorkspaceKnowledgeForInstructions,
} from "../lib/workspace-knowledge.js";

export default defineDynamic({
  events: {
    "turn.started": async () => {
      const knowledge = await loadWorkspaceKnowledgeForInstructions({ limit: 8 });

      return defineInstructions({
        markdown: buildWorkspaceKnowledgeInstructions(knowledge),
      });
    },
  },
});
