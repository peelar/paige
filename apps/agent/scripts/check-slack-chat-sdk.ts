import assert from "node:assert/strict";

import type { SlackEvent } from "@chat-adapter/slack";
import type { Message, Thread, WebhookOptions } from "chat";

import {
  buildSlackActionAuth,
  registerSlackTurnHandlers,
  sendSlackTurn,
} from "../agent/lib/slack-chat-turn.js";
import { SubscriptionFilteredSlackAdapter } from "../agent/lib/subscription-filtered-slack-adapter.js";

class TestSlackAdapter extends SubscriptionFilteredSlackAdapter {
  forwarded: SlackEvent[] = [];
  subscriptionChecks: string[] = [];
  subscribed = false;

  constructor() {
    super({ botToken: "xoxb-test", webhookVerifier: () => true });
  }

  async emit(event: SlackEvent): Promise<void> {
    const tasks: Promise<unknown>[] = [];
    const options: WebhookOptions = { waitUntil: (task) => tasks.push(task) };
    this.handleMessageEvent(event, options);
    await Promise.all(tasks);
  }

  setBotUserId(userId: string): void {
    this._botUserId = userId;
  }

  protected override forwardAcceptedMessage(event: SlackEvent): void {
    this.forwarded.push(event);
  }

  protected override async isThreadSubscribed(threadId: string): Promise<boolean> {
    this.subscriptionChecks.push(threadId);
    return this.subscribed;
  }
}

const adapter = new TestSlackAdapter();
await adapter.emit(event({ type: "app_mention", text: "@Paige help" }));
await adapter.emit(event({ channel: "D123", channel_type: "im", text: "help" }));
assert.equal(adapter.forwarded.length, 2, "mentions and DMs bypass subscription lookup");
assert.deepEqual(adapter.subscriptionChecks, []);

await adapter.emit(event({ text: "unenrolled private content" }));
assert.equal(adapter.forwarded.length, 2, "unenrolled channel content is not forwarded");
assert.deepEqual(adapter.subscriptionChecks, ["slack:C123:100.000"]);

adapter.subscribed = true;
await adapter.emit(event({ channel_type: "group", text: "followed private-channel reply" }));
assert.equal(adapter.forwarded.at(-1)?.text, "followed private-channel reply");
assert.equal(adapter.subscriptionChecks.length, 2);

adapter.setBotUserId("U_BOT");
await adapter.emit(event({ user: "U_BOT", text: "self" }));
await adapter.emit(event({ bot_id: "B_OTHER", text: "other bot" }));
await adapter.emit(event({ subtype: "message_changed", text: "edited secret" }));
await adapter.emit(event({ subtype: "me_message", text: "unsupported" }));
assert.equal(adapter.forwarded.length, 3);
assert.equal(adapter.subscriptionChecks.length, 2, "ignored traffic is dropped before state lookup");

const registered: Record<string, (thread: Thread, message: Message) => Promise<void>> = {};
let registeredSendCalls = 0;
registerSlackTurnHandlers(
  {
    onDirectMessage: (handler) => { registered.dm = handler; },
    onNewMention: (handler) => { registered.mention = handler; },
    onSubscribedMessage: (handler) => { registered.subscribed = handler; },
  },
  async () => { registeredSendCalls += 1; },
);
assert.deepEqual(Object.keys(registered).sort(), ["dm", "mention", "subscribed"]);
const rootMessage = message("200.000", "root request", false, "200.000");
const rootThread = {
  id: "slack:C123:200.000",
  startTyping: async () => undefined,
} as unknown as Thread;
await registered.mention!(rootThread, rootMessage);
await registered.dm!(rootThread, rootMessage);
await registered.subscribed!(rootThread, rootMessage);
assert.equal(registeredSendCalls, 3, "mention, DM, and subscribed handlers all dispatch to Eve");

const sent: Array<{ input: unknown; options: Record<string, unknown> }> = [];
const typing: string[] = [];
const priorMessages = [
  message("100.000", "root context", false),
  message("101.000", "previous agent reply", true),
  message("102.000", "new human context", false),
  message("103.000", "@Paige current request", false),
];
const thread = {
  adapter: {
    fetchMessages: async () => ({ messages: priorMessages }),
  },
  id: "slack:C123:100.000",
  startTyping: async (status: string) => { typing.push(status); },
} as unknown as Thread;
await sendSlackTurn(
  async (input, options) => { sent.push({ input, options: options as unknown as Record<string, unknown> }); },
  thread,
  priorMessages[3]!,
);
assert.deepEqual(typing, ["Thinking..."]);
assert.equal(sent.length, 1);
const serializedInput = JSON.stringify(sent[0]?.input);
assert.match(serializedInput, /new human context/);
assert.match(serializedInput, /current request/);
assert.doesNotMatch(serializedInput, /root context/);
assert.doesNotMatch(serializedInput, /previous agent reply/);
assert.equal((sent[0]?.options.auth as { principalId?: string }).principalId, "slack:T123:U_USER");
assert.equal(sent[0]?.options.thread, thread);

const actionAuth = buildSlackActionAuth({
  messageId: "200.000",
  raw: { channel: { id: "C123" }, team: { id: "T123" } },
  threadId: "slack:C123:100.000",
  user: {
    fullName: "Approver",
    isBot: false,
    isMe: false,
    userId: "U_APPROVER",
    userName: "approver",
  },
} as never);
assert.equal(actionAuth?.principalId, "slack:T123:U_APPROVER", "HITL resumes as the clicking Slack user");

const slackChannelModule = await import("../agent/channels/slack.js");
const route = slackChannelModule.channel.routes[0] as {
  method?: string;
  path?: string;
  transport?: string;
};
assert.deepEqual(
  { method: route.method, path: route.path, transport: route.transport },
  { method: "POST", path: "/eve/v1/slack", transport: "http" },
  "the externally configured Slack route remains stable",
);
assert.equal(slackChannelModule.slackAdapter instanceof SubscriptionFilteredSlackAdapter, true);

console.log("Slack Chat SDK integration checks passed.");

function event(overrides: Partial<SlackEvent>): SlackEvent {
  return {
    channel: "C123",
    channel_type: "channel",
    team_id: "T123",
    text: "message",
    ts: "100.000",
    type: "message",
    user: "U_USER",
    ...overrides,
  };
}

function message(
  id: string,
  text: string,
  isMe: boolean,
  threadTs = "100.000",
): Message {
  return {
    attachments: [],
    author: {
      fullName: isMe ? "Paige" : "User",
      isBot: isMe,
      isMe,
      userId: isMe ? "U_BOT" : "U_USER",
      userName: isMe ? "paige" : "user",
    },
    id,
    raw: {
      channel: "C123",
      team_id: "T123",
      text,
      thread_ts: threadTs,
      ts: id,
    },
    text,
    threadId: `slack:C123:${threadTs}`,
  } as Message;
}
