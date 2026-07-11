import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  getSetupStatus,
  preflightGitHubWritebackSetup,
  readSetupState,
  setupStatusSchema,
} from "../lib/setup-state.js";

export default defineTool({
  description:
    "Inspect workspace setup readiness. Use checkGitHubWriteback when the user asks to publish or when GitHub draft PR writeback setup must be validated.",
  inputSchema: z.object({
    checkGitHubWriteback: z.boolean().default(false),
  }),
  outputSchema: setupStatusSchema,
  async execute({ checkGitHubWriteback }, ctx) {
    if (!checkGitHubWriteback) {
      return getSetupStatus();
    }

    const state = await readSetupState();
    if (state === null) return getSetupStatus();

    return preflightGitHubWritebackSetup(ctx, state);
  },
});
