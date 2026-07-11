import type { ChatSdkSendOptions } from "eve/channels/chat-sdk";
import { messageToUserContent } from "eve/channels/chat-sdk";
import type { ActionEvent, Message, Thread } from "chat";
import type { UserContent } from "ai";

type SlackTurnHandler = (thread: Thread, message: Message) => Promise<void>;
type SlackHandlerRegistrar = {
  onDirectMessage(handler: SlackTurnHandler): unknown;
  onNewMention(handler: SlackTurnHandler): unknown;
  onSubscribedMessage(handler: SlackTurnHandler): unknown;
};
type SlackTurnSender = (
  input: string | UserContent | { message: string | UserContent },
  options: ChatSdkSendOptions,
) => Promise<unknown>;

type SlackRawMessage = {
  channel?: string;
  team?: string;
  team_id?: string;
  text?: string;
  thread_ts?: string;
  ts?: string;
};

export function registerSlackTurnHandlers(
  bot: SlackHandlerRegistrar,
  send: SlackTurnSender,
): void {
  const handler: SlackTurnHandler = async (thread, message) => {
    await sendSlackTurn(send, thread, message);
  };
  bot.onNewMention(handler);
  bot.onDirectMessage(handler);
  bot.onSubscribedMessage(handler);
}

export async function sendSlackTurn(
  send: SlackTurnSender,
  thread: Thread,
  message: Message,
): Promise<void> {
  await thread.startTyping("Thinking...");
  const context = await loadSlackThreadContext(thread, message);
  const current = formatSlackMessage(message);
  const text = context === undefined ? current : `${context}\n\n${current}`;
  const input = withAttributedText(messageToUserContent(message), text);
  await send(
    { message: input },
    {
      auth: buildSlackChatAuth(message),
      thread,
      title: message.text,
    },
  );
}

export async function loadSlackThreadContext(
  thread: Thread,
  current: Message,
): Promise<string | undefined> {
  const currentRaw = slackRaw(current);
  if (!currentRaw.thread_ts || currentRaw.thread_ts === current.id) return undefined;

  let messages: Message[];
  try {
    messages = (
      await thread.adapter.fetchMessages(thread.id, {
        direction: "backward",
        limit: 50,
      })
    ).messages;
  } catch (error) {
    console.warn("Slack thread context could not be loaded; continuing with the triggering message.", error);
    return undefined;
  }

  const currentIndex = messages.findIndex(({ id }) => id === current.id);
  const prior = currentIndex === -1
    ? messages.filter(({ id }) => id !== current.id)
    : messages.slice(0, currentIndex);
  const lastAgentReply = findLastIndex(prior, ({ author }) => author.isMe);
  const incremental = prior.slice(lastAgentReply + 1);
  if (incremental.length === 0) return undefined;

  return [
    "<slack_thread_context>",
    ...incremental.map(formatSlackMessage),
    "</slack_thread_context>",
  ].join("\n");
}

export function buildSlackChatAuth(
  message: Pick<Message, "author" | "id" | "raw" | "threadId">,
): Exclude<ChatSdkSendOptions["auth"], undefined> {
  const raw = slackRaw(message);
  const teamId = raw.team_id ?? raw.team;
  const channelId = raw.channel ?? channelIdFromThread(message.threadId);
  const threadTs = raw.thread_ts ?? raw.ts ?? message.id;
  const author = message.author;
  const isBot = author.isBot === true;
  const principalId = teamId
    ? isBot
      ? `slack:${teamId}:bot:${author.userId}`
      : `slack:${teamId}:${author.userId}`
    : isBot
      ? `slack:bot:${author.userId}`
      : `slack:${author.userId}`;

  return {
    attributes: {
      author_type: isBot ? "bot" : "user",
      channel_id: channelId,
      full_name: author.fullName,
      ...(teamId ? { team_id: teamId } : {}),
      thread_ts: threadTs,
      user_id: author.userId,
      user_name: author.userName,
    },
    authenticator: "slack-webhook",
    issuer: teamId ? `slack:${teamId}` : "slack",
    principalId,
    principalType: isBot ? "service" : "user",
  };
}

export function buildSlackActionAuth(
  event: ActionEvent,
): Exclude<ChatSdkSendOptions["auth"], undefined> {
  const raw = event.raw as {
    channel?: { id?: string };
    team?: { id?: string };
  };
  return buildSlackChatAuth({
    author: event.user,
    id: event.messageId,
    raw: {
      channel: raw.channel?.id ?? channelIdFromThread(event.threadId),
      team_id: raw.team?.id,
      thread_ts: threadTimestampFromThread(event.threadId),
      ts: event.messageId,
    },
    threadId: event.threadId,
  });
}

function formatSlackMessage(message: Message): string {
  const raw = slackRaw(message);
  const senderType = message.author.isMe
    ? "agent"
    : message.author.isBot === true
      ? "bot"
      : "user";
  return [
    "<slack_message>",
    `sender_type: ${senderType}`,
    `sender_id: ${message.author.userId}`,
    `channel_id: ${raw.channel ?? channelIdFromThread(message.threadId)}`,
    `thread_ts: ${raw.thread_ts ?? raw.ts ?? message.id}`,
    `message_ts: ${raw.ts ?? message.id}`,
    ...(raw.team_id ?? raw.team ? [`team_id: ${raw.team_id ?? raw.team}`] : []),
    "<content>",
    message.text,
    "</content>",
    "</slack_message>",
  ].join("\n");
}

function withAttributedText(
  input: string | UserContent,
  text: string,
): string | UserContent {
  if (typeof input === "string") return text;
  return [
    { text, type: "text" },
    ...input.filter((part) => part.type !== "text"),
  ];
}

function slackRaw(message: Pick<Message, "raw">): SlackRawMessage {
  return message.raw as SlackRawMessage;
}

function channelIdFromThread(threadId: string): string {
  return threadId.split(":")[1] ?? "";
}

function threadTimestampFromThread(threadId: string): string {
  return threadId.split(":").slice(2).join(":");
}

function findLastIndex<T>(values: T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) return index;
  }
  return -1;
}
