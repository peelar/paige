import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import {
  getSetupStatus,
  preflightGitHubWritebackSetup,
  saveGitHubWritebackSetup,
  setupStatusSchema,
} from "../lib/setup-state";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({
  events: {
    "step.started": async (event, context) => {
      if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("configure_github_writeback")) return null;
      return defineTool({
        description:
          "Configure and validate GitHub draft PR writeback setup for the persisted working documentation repository. Provide the Vercel Connect GitHub connector UID, such as github/docs-agent.",
        inputSchema: z.object({
          connector: z.string().trim().min(1).optional(),
          validateNow: z.boolean().default(true),
        }),
        outputSchema: setupStatusSchema,
        async execute(input, ctx) {
          await requireCapabilityToolExecution("configure_github_writeback", ctx);
          const state = await saveGitHubWritebackSetup({ connector: input.connector });

          if (!input.validateNow) return getSetupStatus();

          return preflightGitHubWritebackSetup(ctx, state);
        },
      });
    },
  },
});
