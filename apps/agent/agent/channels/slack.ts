import { chatSdkChannel } from "eve/channels/chat-sdk";

import { slackAdapter } from "../../slack/adapter";
import { postSlackAuthorizationRequired } from "../../slack/authorization";
import { registerSlackMessages } from "../../slack/messages";
import { quietSlackProgressEvents } from "../../slack/progress";
import { clearSlackWorkingReaction } from "../../slack/reactions";
import { SlackChannelService } from "../../slack/service";
import { createSlackState } from "../../slack/state";

export const { bot, channel, send } = chatSdkChannel({
  adapters: {
    // Slack calls Paige directly so Connect cannot filter thread replies.
    // Keep Connect only for rotating outbound bot credentials.
    slack: slackAdapter,
  },
  events: {
    ...quietSlackProgressEvents,
    "authorization.required": async (event, context) => {
      await clearSlackWorkingReaction(context.thread?.adapter ?? null);
      await postSlackAuthorizationRequired(event, context.thread);
    },
  },
  state: createSlackState(),
  streaming: false,
  userName: "Paige",
});

registerSlackMessages(
  bot,
  new SlackChannelService(send),
);

export default channel;
