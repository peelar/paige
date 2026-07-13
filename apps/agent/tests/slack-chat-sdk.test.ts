import assert from "node:assert/strict";

import type { SlackEvent } from "@chat-adapter/slack";
import type { Message, Thread, WebhookOptions } from "chat";

import {
  buildSlackActionAuth,
  isSilentSlackReply,
  isSlackThreadDismissal,
  registerSlackTurnHandlers,
  sendSlackTurn,
} from "../agent/lib/slack-chat-turn";
import { SubscriptionFilteredSlackAdapter } from "../agent/lib/subscription-filtered-slack-adapter";
import { test } from "vitest";

test("slack chat sdk", async () => {
class TestSlackAdapter extends SubscriptionFilteredSlackAdapter {
  forwarded: SlackEvent[] = [];
  subscriptionChecks: string[] = [];
  subscribed = false;

  constructor(options: {
    admitEntryMessage?: (
      entry: "mention" | "direct-message",
    ) => Promise<boolean>;
  } = {}) {
    super({ botToken: "xoxb-test", webhookVerifier: () => true }, options);
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

  protected override async forwardAcceptedMessageToChatSdk(event: SlackEvent): Promise<void> {
    this.forwarded.push(event);
  }

  protected override async isThreadSubscribed(threadId: string): Promise<boolean> {
    this.subscriptionChecks.push(threadId);
    return this.subscribed;
  }
}

class AsyncForwardingTestSlackAdapter extends TestSlackAdapter {
  completed = false;

  protected override async forwardAcceptedMessageToChatSdk(
    event: SlackEvent,
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await super.forwardAcceptedMessageToChatSdk(event);
    this.completed = true;
  }
}

class PresenceAdmissionAdapter extends SubscriptionFilteredSlackAdapter {
  constructor(admit: (threadId: string) => Promise<boolean>) {
    super(
      { botToken: "xoxb-test", webhookVerifier: () => true },
      { admitOrdinaryMessage: admit },
    );
  }

  configureState(state: { isSubscribed(id: string): Promise<boolean>; unsubscribe(id: string): Promise<void> }): void {
    this.chat = { getState: () => state } as never;
  }

  check(threadId: string): Promise<boolean> {
    return this.isThreadSubscribed(threadId);
  }
}

const adapter = new TestSlackAdapter();
await adapter.emit(event({
  type: "app_mention",
  text: "@Paige help",
  action_token: "action-token-must-not-persist",
}));
await adapter.emit(event({ channel: "D123", channel_type: "im", text: "help" }));
assert.equal(adapter.forwarded.length, 2, "mentions and DMs bypass subscription lookup");
assert.deepEqual(adapter.subscriptionChecks, []);
assert.doesNotMatch(
  JSON.stringify(adapter.forwarded[0]),
  /action-token-must-not-persist/u,
  "request-scoped action tokens are removed before Chat SDK receives the event",
);

const entryFiltered = new TestSlackAdapter({
  admitEntryMessage: async (entry) => entry === "mention",
});
await entryFiltered.emit(event({ type: "app_mention", text: "@Paige allowed" }));
await entryFiltered.emit(event({ channel: "D123", channel_type: "im", text: "blocked" }));
assert.equal(entryFiltered.forwarded.length, 1, "structured entry policy filters DMs before Chat SDK");
assert.equal(entryFiltered.forwarded[0]?.type, "app_mention");

const asyncForwarding = new AsyncForwardingTestSlackAdapter({
  admitEntryMessage: async () => true,
});
await asyncForwarding.emit(
  event({ type: "app_mention", text: "@Paige await me" }),
);
assert.equal(
  asyncForwarding.completed,
  true,
  "entry admission keeps Chat SDK processing inside the registered waitUntil task",
);

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

const unsubscribed: string[] = [];
const inactivePresence = new PresenceAdmissionAdapter(async () => false);
inactivePresence.configureState({
  isSubscribed: async () => true,
  unsubscribe: async (id) => { unsubscribed.push(id); },
});
assert.equal(await inactivePresence.check("slack:C123:expired"), false);
assert.deepEqual(unsubscribed, ["slack:C123:expired"], "inactive presence removes stale Chat SDK subscription");
const activePresence = new PresenceAdmissionAdapter(async () => true);
activePresence.configureState({
  isSubscribed: async () => true,
  unsubscribe: async () => undefined,
});
assert.equal(await activePresence.check("slack:C123:active"), true);

const registered: Record<string, (thread: Thread, message: Message) => Promise<void>> = {};
let registeredSendCalls = 0;
const registeredInputs: unknown[] = [];
const presenceEvents: Array<Record<string, unknown>> = [];
registerSlackTurnHandlers(
  {
    onDirectMessage: (handler) => { registered.dm = handler; },
    onNewMention: (handler) => { registered.mention = handler; },
    onSubscribedMessage: (handler) => { registered.subscribed = handler; },
  },
  async (input) => { registeredSendCalls += 1; registeredInputs.push(input); },
  {
    verifyInbound: async () => { presenceEvents.push({ action: "verify-inbound" }); },
    enroll: async (input) => { presenceEvents.push({ action: "enroll", ...input }); },
    end: async (input) => { presenceEvents.push({ action: "end", ...input }); },
  },
);
assert.deepEqual(Object.keys(registered).sort(), ["dm", "mention", "subscribed"]);
const rootMessage = message("200.000", "root request", false, "200.000");
const rootThread = {
  id: "slack:C123:200.000",
  post: async () => undefined,
  startTyping: async () => undefined,
  subscribe: async () => undefined,
  unsubscribe: async () => undefined,
} as unknown as Thread;
await registered.mention!(rootThread, rootMessage);
await registered.dm!(rootThread, rootMessage);
await registered.subscribed!(rootThread, rootMessage);
assert.equal(registeredSendCalls, 3, "mention, DM, and subscribed handlers all dispatch to Eve");
assert.doesNotMatch(JSON.stringify(registeredInputs[0]), /\[\[SILENT\]\]/u);
assert.match(JSON.stringify(registeredInputs[2]), /\[\[SILENT\]\]/u, "followed-thread turns receive the speaking policy");
assert.equal(presenceEvents[0]?.action, "verify-inbound");
assert.equal(presenceEvents[1]?.action, "enroll");
assert.equal(presenceEvents[1]?.continuationToken, rootThread.id);

const disabledHandlers: Record<string, (thread: Thread, message: Message) => Promise<void>> = {};
let disabledSends = 0;
let disabledSubscriptions = 0;
const disabledPresenceEvents: Array<Record<string, unknown>> = [];
registerSlackTurnHandlers(
  {
    onDirectMessage: (handler) => { disabledHandlers.dm = handler; },
    onNewMention: (handler) => { disabledHandlers.mention = handler; },
    onSubscribedMessage: (handler) => { disabledHandlers.subscribed = handler; },
  },
  async () => { disabledSends += 1; },
  {
    verifyInbound: async () => undefined,
    enroll: async (input) => { disabledPresenceEvents.push({ action: "enroll", ...input }); },
    end: async (input) => { disabledPresenceEvents.push({ action: "end", ...input }); },
  },
  async () => ({ slackEntry: "mentions-and-dms", slackContinuation: "off" }),
);
const disabledThread = {
  ...rootThread,
  subscribe: async () => { disabledSubscriptions += 1; },
  unsubscribe: async () => { disabledSubscriptions -= 1; },
} as unknown as Thread;
await disabledHandlers.mention!(disabledThread, rootMessage);
assert.equal(disabledSends, 1, "a mention still gets its direct response");
assert.equal(disabledSubscriptions, 0, "continuation off does not enroll the thread");
assert.equal(disabledPresenceEvents.length, 0);
await disabledHandlers.subscribed!(disabledThread, rootMessage);
assert.equal(disabledSends, 1, "a stale subscribed turn is not sent to Eve");
assert.equal(disabledSubscriptions, -1, "the stale Chat SDK subscription is removed");
assert.equal(disabledPresenceEvents[0]?.reason, "workspace-participation-disabled");

await registered.subscribed!(rootThread, message("201.000", "Paige, stop following this thread.", false, "200.000"));
assert.equal(registeredSendCalls, 3, "dismissal does not start an Eve turn");
assert.equal(presenceEvents.at(-1)?.status, "dismissed");
assert.equal(isSlackThreadDismissal("Thanks Paige, you can leave"), true);
assert.equal(isSlackThreadDismissal("Let's stop following the old API"), false);
assert.equal(isSilentSlackReply(" [[SILENT]] "), true);
assert.equal(isSilentSlackReply("I can help"), false);

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
assert.equal((sent[0]!.options.auth as { principalId?: string }).principalId, "slack:T123:U_USER");
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

const slackChannelModule = await import("../agent/channels/slack");
const routes = slackChannelModule.channel.routes
  .map((route) => ({ method: route.method, path: route.path, transport: route.transport }))
  .sort((left, right) => String(left.method).localeCompare(String(right.method)));
assert.deepEqual(
  routes,
  [
    { method: "GET", path: "/eve/v1/slack", transport: "http" },
    { method: "POST", path: "/eve/v1/slack", transport: "http" },
  ],
  "the externally configured Slack route supports verification and message delivery",
);
assert.equal(slackChannelModule.slackAdapter instanceof SubscriptionFilteredSlackAdapter, true);
const botConcurrency = slackChannelModule.bot as unknown as {
  _concurrencyConfig: { debounceMs: number };
  _concurrencyStrategy: string;
};
assert.equal(botConcurrency._concurrencyStrategy, "burst");
assert.equal(botConcurrency._concurrencyConfig.debounceMs, 1_000, "short Slack bursts use the durable Chat SDK burst queue");

console.log("Slack Chat SDK integration checks passed.");

function event(
  overrides: Partial<SlackEvent> & { action_token?: string },
): SlackEvent {
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
});
