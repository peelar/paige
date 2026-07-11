import { connectSlackAdapter } from "@vercel/connect/chat";
import {
  DEFAULT_SLACK_CONNECTOR,
  resolveSlackConnector,
  SLACK_CONNECTOR_ENV,
} from "@docs-agent/control-plane/provider-config";
import { createLibSqlChatStateAdapter } from "@docs-agent/control-plane/agent";
import { chatSdkChannel } from "eve/channels/chat-sdk";

import {
  buildSlackActionAuth,
  registerSlackTurnHandlers,
} from "../lib/slack-chat-turn.js";
import { createSubscriptionFilteredSlackAdapter } from "../lib/subscription-filtered-slack-adapter.js";

export { DEFAULT_SLACK_CONNECTOR, SLACK_CONNECTOR_ENV };

const slackConnector = resolveSlackConnector();
export const slackAdapter = createSubscriptionFilteredSlackAdapter({
  ...connectSlackAdapter(slackConnector),
  userName: "Paige",
});

export const { bot, channel, send } = chatSdkChannel({
  adapters: { slack: slackAdapter },
  resolveInputAuth: buildSlackActionAuth,
  state: createLibSqlChatStateAdapter(),
  userName: "Paige",
});

registerSlackTurnHandlers(bot, send);

export default channel;
