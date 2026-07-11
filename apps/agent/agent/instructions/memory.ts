import { defineDynamic, defineInstructions } from "eve/instructions";

import {
  buildWorkspaceMemoryInstructions,
  loadWorkspaceMemoryForInstructions,
} from "../lib/workspace-memory.js";

export default defineDynamic({
  events: {
    "turn.started": async () => {
      const memory = await loadWorkspaceMemoryForInstructions({ limit: 8 });

      return defineInstructions({
        markdown: buildWorkspaceMemoryInstructions(memory),
      });
    },
  },
});
