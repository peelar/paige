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
  options: {
    thread: Thread;
    auth: {
      authenticator: "slack";
      principalType: "user";
      principalId: string;
      attributes: { slackWorkspaceId: string };
    };
  },
) => Promise<unknown>;

export function registerDirectMessages(
  directMessageBot: DirectMessageBot,
  sendMessage: DirectMessageSend,
): void {
  directMessageBot.onDirectMessage(async (thread, message) => {
    const slackWorkspaceId = extractSlackWorkspaceId(message);
    await sendMessage(message.text, {
      thread,
      auth: {
        authenticator: "slack",
        principalType: "user",
        principalId: message.author.userId,
        attributes: { slackWorkspaceId },
      },
    });
  });
}

export function extractSlackWorkspaceId(message: Message): string {
  if (typeof message.raw !== "object" || message.raw === null) {
    throw new Error("Slack message is missing its verified workspace ID.");
  }

  const raw = message.raw as Record<string, unknown>;
  const workspaceId = typeof raw.team_id === "string"
    ? raw.team_id
    : typeof raw.team === "string"
    ? raw.team
    : undefined;
  if (!workspaceId) {
    throw new Error("Slack message is missing its verified workspace ID.");
  }
  return workspaceId;
}

registerDirectMessages(bot, send);

export default channel;
