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
  recordConnectorDeliveryVerification,
  readBehaviorSettings,
  slackEntryAllows,
} from "@docs-agent/control-plane/agent";
import { chatSdkChannel } from "eve/channels/chat-sdk";

import {
  buildSlackActionAuth,
  isSilentSlackReply,
  registerSlackTurnHandlers,
} from "../lib/slack-chat-turn";
import { createSubscriptionFilteredSlackAdapter } from "../lib/subscription-filtered-slack-adapter";
import { resolveSlackWatchEventAdmissions } from "../lib/slack-watch-admission";

export { DEFAULT_SLACK_CONNECTOR, SLACK_CONNECTOR_ENV };

const slackConnector = resolveSlackConnector();
export const slackAdapter = createSubscriptionFilteredSlackAdapter({
  ...connectSlackAdapter(slackConnector),
  userName: "Paige",
}, {
  admitEntryMessage: async (entry) =>
    slackEntryAllows((await readBehaviorSettings()).settings.participation, entry),
  admitWatchEvent: resolveSlackWatchEventAdmissions,
  admitOrdinaryMessage: async (threadId) => {
    const participation = (await readBehaviorSettings()).settings.participation;
    if (participation.slackContinuation === "off") {
      await endSlackThreadPresence({
        chatThreadId: threadId,
        status: "dismissed",
        reason: "workspace-participation-disabled",
      });
      return false;
    }
    return (await continueSlackThreadPresence({ chatThreadId: threadId })).admitted;
  },
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
  verifyInbound: () =>
    recordConnectorDeliveryVerification({
      provider: "slack",
      evidence: "slack-verified-webhook",
    }),
}, async () => (await readBehaviorSettings()).settings.participation);

export default channel;
