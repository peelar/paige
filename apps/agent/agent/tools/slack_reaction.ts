import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { slackAdapter } from "../../slack/adapter";
import {
  agentSlackReactionNameSchema,
  claimAgentSlackReaction,
  releaseAgentSlackReactionClaim,
  setSlackReactionPresence,
  slackReactionTurnState,
} from "../../slack/reactions";

export default defineDynamic({
  events: {
    "turn.started": () => {
      const target = slackReactionTurnState.get().target;
      if (target === null) return null;

      return defineTool({
        description:
          "Add one lightweight emoji reaction to the Slack message that started this turn. Use it only when a reaction adds useful social meaning, such as appreciation, agreement, or celebration. Do not use it for routine acknowledgement, progress, success or failure status, approval, rejection, or as a substitute for the requested response. Call it at most once.",
        inputSchema: z.object({
          emoji: agentSlackReactionNameSchema.describe(
            "A Slack emoji name without colons, such as heart, thumbs_up, tada, or bulb.",
          ),
        }).strict(),
        async execute({ emoji }) {
          claimAgentSlackReaction(target, emoji);
          try {
            await setSlackReactionPresence(
              slackAdapter,
              target,
              emoji,
              true,
            );
          } catch (error) {
            releaseAgentSlackReactionClaim(target, emoji);
            throw error;
          }
          return { emoji, reacted: true };
        },
      });
    },
  },
});
