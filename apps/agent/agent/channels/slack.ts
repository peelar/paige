import { createSlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { connectSlackAdapter } from "@vercel/connect/chat";
import type { Message, Thread } from "chat";
import { chatSdkChannel } from "eve/channels/chat-sdk";

const connector = process.env.PAIGE_SLACK_CONNECTOR?.trim() || "slack/paige";

export const { bot, channel, send } = chatSdkChannel({
  adapters: {
    slack: createSlackAdapter(connectSlackAdapter(connector)),
  },
  state: createMemoryState(),
  streaming: false,
  userName: "Paige",
});

type DirectMessageBot = {
  onDirectMessage(
    handler: (thread: Thread, message: Message) => void | Promise<void>,
  ): void;
};

type DirectMessageSend = (
  message: string,
  options: { thread: Thread },
) => Promise<unknown>;

export function registerDirectMessages(
  directMessageBot: DirectMessageBot,
  sendMessage: DirectMessageSend,
): void {
  directMessageBot.onDirectMessage(async (thread, message) => {
    await sendMessage(message.text, { thread });
  });
}

registerDirectMessages(bot, send);

export default channel;
