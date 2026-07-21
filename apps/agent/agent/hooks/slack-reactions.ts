import { defineHook } from "eve/hooks";

import { slackAdapter } from "../../slack/adapter";
import { clearSlackWorkingReaction } from "../../slack/reactions";

export default defineHook({
  events: {
    async "session.failed"(_event, ctx) {
      if (ctx.channel.kind !== "channel:slack") return;
      await clearSlackWorkingReaction(slackAdapter);
    },
  },
});
