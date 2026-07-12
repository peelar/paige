import type { ChatSdkSendOptions } from "eve/channels/chat-sdk";
import { messageToUserContent } from "eve/channels/chat-sdk";
import type { ActionEvent, Message, MessageContext, Thread } from "chat";
import type { UserContent } from "ai";

import {
  discardStagedSlackSearchRequest,
  runWithStagedSlackSearchRequest,
} from "./slack-context-retrieval.js";

export const SLACK_SILENT_REPLY = "[[SILENT]]";

type SlackTurnHandler = (
  thread: Thread,
  message: Message,
  context?: MessageContext,
) => Promise<void>;
type SlackHandlerRegistrar = {
  onDirectMessage(handler: SlackTurnHandler): unknown;
  onNewMention(handler: SlackTurnHandler): unknown;
  onSubscribedMessage(handler: SlackTurnHandler): unknown;
};
type SlackTurnSender = (
  input: string | UserContent | {
    message: string | UserContent;
    context?: readonly string[];
  },
  options: ChatSdkSendOptions,
) => Promise<unknown>;
type SlackPresenceLifecycle = {
  verifyInbound(): Promise<unknown>;
  enroll(input: {
    teamId?: string;
    channelId: string;
    threadTs: string;
    chatThreadId: string;
    continuationToken: string;
    inviterUserId: string;
  }): Promise<unknown>;
  end(input: {
    chatThreadId: string;
    status: "dismissed" | "enrollment-failed";
    reason: string;
  }): Promise<unknown>;
};

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
  presence: SlackPresenceLifecycle,
): void {
  bot.onNewMention(async (thread, message, context) => {
    await presence.verifyInbound();
    const metadata = slackPresenceMetadata(thread, message);
    await presence.enroll(metadata);
    try {
      await thread.subscribe();
    } catch (error) {
      await presence.end({
        chatThreadId: thread.id,
        status: "enrollment-failed",
        reason: "chat-sdk-subscribe-failed",
      });
      throw error;
    }
    await sendSlackTurn(send, thread, message, { skipped: context?.skipped });
  });
  bot.onDirectMessage(async (thread, message, context) => {
    await presence.verifyInbound();
    await sendSlackTurn(send, thread, message, { skipped: context?.skipped });
  });
  bot.onSubscribedMessage(async (thread, message, context) => {
    await presence.verifyInbound();
    if (isSlackThreadDismissal(message.text)) {
      discardStagedSlackSearchRequest(message.id);
      await presence.end({
        chatThreadId: thread.id,
        status: "dismissed",
        reason: "explicit-slack-dismissal",
      });
      await thread.unsubscribe();
      await thread.post("Got it — I’ll stop following this thread.");
      return;
    }
    await sendSlackTurn(send, thread, message, {
      observingFollowedThread: true,
      skipped: context?.skipped,
    });
  });
}

export async function sendSlackTurn(
  send: SlackTurnSender,
  thread: Thread,
  message: Message,
  options: {
    observingFollowedThread?: boolean;
    skipped?: Message[];
  } = {},
): Promise<void> {
  const skipped = options.skipped ?? [];
  return runWithStagedSlackSearchRequest(
    [message.id, ...skipped.map(({ id }) => id).reverse()],
    message.author.userId,
    async () => {
      await thread.startTyping("Thinking...");
      const context = await loadSlackThreadContext(thread, message);
      const current = formatSlackMessage(message);
      const burst = formatBurstContext(skipped, context);
      const text = [context, burst, current].filter(Boolean).join("\n\n");
      const input = withAttributedText(messageToUserContent(message), text);
      await send(
        {
          message: input,
          ...(options.observingFollowedThread
            ? { context: [SLACK_FOLLOWED_THREAD_POLICY] }
            : {}),
        },
        {
          auth: buildSlackChatAuth(message),
          thread,
          title: message.text,
        },
      );
    },
  );
}

export function isSlackThreadDismissal(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/<@[a-z0-9]+>/giu, "paige")
    .replace(/[^a-z0-9\s']/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return [
    /^(?:paige )?(?:please )?(?:stop following|leave|go away|dismiss yourself)(?: this thread)?$/u,
    /^(?:thanks |thank you )?(?:paige )?(?:you can|you may) (?:leave|go now|stop following)$/u,
    /^dismiss paige$/u,
  ].some((pattern) => pattern.test(normalized));
}

export function isSilentSlackReply(message: string): boolean {
  return message.trim() === SLACK_SILENT_REPLY;
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

function formatBurstContext(
  skipped: Message[],
  existingContext: string | undefined,
): string | undefined {
  const missing = skipped.filter(
    ({ id }) => !existingContext?.includes(`message_ts: ${id}`),
  );
  if (missing.length === 0) return undefined;
  return [
    "<slack_burst_context>",
    ...missing.map(formatSlackMessage),
    "</slack_burst_context>",
  ].join("\n");
}

function slackPresenceMetadata(
  thread: Thread,
  message: Message,
): {
  teamId?: string;
  channelId: string;
  threadTs: string;
  chatThreadId: string;
  continuationToken: string;
  inviterUserId: string;
} {
  const raw = slackRaw(message);
  return {
    ...(raw.team_id ?? raw.team ? { teamId: raw.team_id ?? raw.team } : {}),
    channelId: raw.channel ?? channelIdFromThread(thread.id),
    threadTs: raw.thread_ts ?? raw.ts ?? message.id,
    chatThreadId: thread.id,
    continuationToken: thread.id,
    inviterUserId: message.author.userId,
  };
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

export const SLACK_FOLLOWED_THREAD_POLICY = [
  "You are observing a Slack thread that explicitly invited Paige to participate.",
  "Reply when the latest message directly continues the exchange, addresses Paige, or asks a documentation, product, API, release, or support question Paige can usefully answer.",
  "Use capture_slack_docs_signal when the conversation contains a plausible documentation concern, but do not create a signal for greetings, coordination, or unrelated chatter.",
  `When no reply would help, finish with exactly ${SLACK_SILENT_REPLY} and no other text.`,
].join(" ");
