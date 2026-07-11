import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  getSetupStatus,
  preflightGitHubWritebackSetup,
  saveGitHubWritebackSetup,
  setupStatusSchema,
} from "../lib/setup-state.js";

export default defineTool({
  description:
    "Configure and validate GitHub draft PR writeback setup for the persisted working documentation repository. Provide the Vercel Connect GitHub connector UID, such as github/docs-agent.",
  inputSchema: z.object({
    connector: z.string().trim().min(1).optional(),
    validateNow: z.boolean().default(true),
  }),
  outputSchema: setupStatusSchema,
  async execute(input, ctx) {
    const state = await saveGitHubWritebackSetup({
      connector: input.connector,
    });

    if (!input.validateNow) {
      return getSetupStatus();
    }

    return preflightGitHubWritebackSetup(ctx, state);
  },
});
