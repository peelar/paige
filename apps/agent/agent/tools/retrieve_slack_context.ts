import { defineTool } from "eve/tools";

import {
  retrieveSlackContext,
  retrieveSlackContextInputSchema,
  retrieveSlackContextResultSchema,
} from "../lib/slack-context-retrieval.js";

export default defineTool({
  description:
    "Retrieve a small amount of missing Slack context with Slack Real-time Search during the current user-triggered Slack turn. Use only when a concrete missing discussion prevents a useful documentation-related answer. Never use for ambient discovery, monitoring, or evidence verification. Results are reduced to an ephemeral derived summary and Slack permalinks; do not capture them as a docs signal or workspace memory.",
  inputSchema: retrieveSlackContextInputSchema,
  outputSchema: retrieveSlackContextResultSchema,
  execute(input, ctx) {
    return retrieveSlackContext(input, ctx.session.auth.current, {
      abortSignal: ctx.abortSignal,
    });
  },
});
