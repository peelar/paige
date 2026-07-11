import { connectSlackAdapter } from "@vercel/connect/chat";
import {
  DEFAULT_SLACK_CONNECTOR,
  resolveSlackConnector,
  SLACK_CONNECTOR_ENV,
} from "@docs-agent/control-plane/provider-config";
import { createLibSqlChatStateAdapter } from "@docs-agent/control-plane/agent";
import {
  continueSlackThreadPresence,
  endSlackThreadPresence,
  enrollSlackThreadPresence,
} from "@docs-agent/control-plane/agent";
import { chatSdkChannel } from "eve/channels/chat-sdk";

import {
  buildSlackActionAuth,
  isSilentSlackReply,
  registerSlackTurnHandlers,
} from "../lib/slack-chat-turn.js";
import { createSubscriptionFilteredSlackAdapter } from "../lib/subscription-filtered-slack-adapter.js";

export { DEFAULT_SLACK_CONNECTOR, SLACK_CONNECTOR_ENV };

const slackConnector = resolveSlackConnector();
export const slackAdapter = createSubscriptionFilteredSlackAdapter({
  ...connectSlackAdapter(slackConnector),
  userName: "Paige",
}, {
  admitOrdinaryMessage: async (threadId) =>
    (await continueSlackThreadPresence({ chatThreadId: threadId })).admitted,
});

export const { bot, channel, send } = chatSdkChannel({
  adapters: { slack: slackAdapter },
  concurrency: { strategy: "burst", debounceMs: 1_000 },
  events: {
    async "message.completed"(event, context) {
      if (
        event.finishReason === "tool-calls" ||
        !event.message ||
        isSilentSlackReply(event.message)
      ) return;
      await context.thread?.post({ markdown: event.message });
    },
  },
  resolveInputAuth: buildSlackActionAuth,
  state: createLibSqlChatStateAdapter(),
  streaming: false,
  userName: "Paige",
});

registerSlackTurnHandlers(bot, send, {
  enroll: enrollSlackThreadPresence,
  end: endSlackThreadPresence,
});

export default channel;
