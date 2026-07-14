import { defineDynamic, defineTool } from "eve/tools";

import {
  retrieveSlackContext,
  retrieveSlackContextInputSchema,
  retrieveSlackContextResultSchema,
} from "../lib/slack-context-retrieval";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({
  events: {
    "step.started": async (event, context) => {
      if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("retrieve_slack_context")) return null;
      return defineTool({
        description:
          "Retrieve a small amount of missing Slack context with Slack Real-time Search during the current user-triggered Slack turn. Use only when a concrete missing discussion prevents a useful documentation-related answer. Never use for ambient discovery, monitoring, or evidence verification. Results are reduced to an ephemeral derived summary and Slack permalinks; do not capture them as a docs signal or workspace memory.",
        inputSchema: retrieveSlackContextInputSchema,
        outputSchema: retrieveSlackContextResultSchema,
        async execute(input, ctx) {
          await requireCapabilityToolExecution("retrieve_slack_context", ctx);
          return retrieveSlackContext(input, ctx.session.auth.current, { abortSignal: ctx.abortSignal });
        },
      });
    },
  },
});
