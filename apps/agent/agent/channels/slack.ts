import { createSlackAdapter } from "@chat-adapter/slack";
import { connectSlackAdapter } from "@vercel/connect/chat";
import type { Message, Thread } from "chat";
import { chatSdkChannel } from "eve/channels/chat-sdk";

import { postSlackAuthorizationRequired } from "../../slack/authorization";
import { SlackChannelService } from "../../slack/service";
import { createSlackState } from "../../slack/state";

const connector = process.env.PAIGE_SLACK_CONNECTOR?.trim() || "slack/paige";

export const { bot, channel, send } = chatSdkChannel({
  adapters: {
    slack: createSlackAdapter(connectSlackAdapter(connector)),
  },
  events: {
    "authorization.required": async (event, context) => {
      await postSlackAuthorizationRequired(event, context.thread);
    },
  },
  state: createSlackState(),
  streaming: false,
  userName: "Paige",
});

type SlackMessageBot = {
  onDirectMessage(
    handler: (thread: Thread, message: Message) => void | Promise<void>,
  ): void;
  onNewMention(
    handler: (thread: Thread, message: Message) => void | Promise<void>,
  ): void;
};

export function registerSlackMessages(
  slackMessageBot: SlackMessageBot,
  service: Pick<SlackChannelService, "handleMessage">,
): void {
  const handleMessage = async (thread: Thread, message: Message) => {
    const result = await service.handleMessage(thread, message);
    if (result.isErr()) throw result.error;
  };

  slackMessageBot.onDirectMessage(handleMessage);
  // Do not subscribe to mentioned threads: Paige should keep listening only
  // when someone explicitly asks for her with another @mention.
  slackMessageBot.onNewMention(handleMessage);
}

registerSlackMessages(
  bot,
  new SlackChannelService(send),
);

export default channel;
