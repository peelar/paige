import assert from "node:assert/strict";

import type { Message, Thread } from "chat";
import { test, vi } from "vitest";

import { postSlackAuthorizationRequired } from "../slack/authorization";
import { registerSlackMessages } from "../slack/messages";
import { quietSlackProgressEvents } from "../slack/progress";
import {
  agentSlackReactionNameSchema,
  setSlackReactionPresence,
  slackReactionTurnForThread,
} from "../slack/reactions";
import {
  extractSlackWorkspaceId,
  SlackChannelService,
} from "../slack/service";

test("Slack follows mentioned threads and continues every later message", async () => {
  let directMessageHandler:
    | ((thread: Thread, message: Message) => void | Promise<void>)
    | undefined;
  let mentionHandler:
    | ((thread: Thread, message: Message) => void | Promise<void>)
    | undefined;
  let subscribedMessageHandler:
    | ((thread: Thread, message: Message) => void | Promise<void>)
    | undefined;
  const bot = {
    onDirectMessage(candidate: NonNullable<typeof directMessageHandler>) {
      directMessageHandler = candidate;
    },
    onNewMention(candidate: NonNullable<typeof mentionHandler>) {
      mentionHandler = candidate;
    },
    onSubscribedMessage(
      candidate: NonNullable<typeof subscribedMessageHandler>,
    ) {
      subscribedMessageHandler = candidate;
    },
  };
  const calls: Array<{
    message: unknown;
    thread: Thread;
    auth: {
      authenticator: "slack";
      principalType: "user";
      principalId: string;
      attributes: { slackWorkspaceId: string };
    };
  }> = [];
  const reactions: Array<{
    messageId: string;
    reaction: string;
    threadId: string;
  }> = [];
  const order: string[] = [];
  const service = new SlackChannelService(async (message, { thread, auth }) => {
    order.push(`dispatch:${message}`);
    calls.push({ message, thread, auth });
    return undefined;
  });
  registerSlackMessages(bot, service);

  assert.ok(directMessageHandler, "the direct-message handler is registered");
  assert.ok(mentionHandler, "the mention handler is registered");
  assert.ok(
    subscribedMessageHandler,
    "the subscribed-thread handler is registered",
  );
  const adapter = {
    async addReaction(threadId: string, messageId: string, reaction: string) {
      order.push(`reaction:${messageId}`);
      reactions.push({ messageId, reaction, threadId });
    },
    async removeReaction() {},
  };
  const createThread = (id: string, isDM = false): Thread => ({
    adapter,
    id,
    isDM,
  }) as unknown as Thread;
  const directMessageThread = createThread("slack:D123:", true);
  await Reflect.apply(directMessageHandler, undefined, [
    directMessageThread,
    {
      id: "1111.0001",
      threadId: "slack:D123:",
      text: "Hello Paige",
      raw: { team_id: "T123" },
      author: { userId: "U123" },
    } as Message,
    { sdk: "channel argument" },
    { sdk: "message context" },
  ]);
  let subscriptionCount = 0;
  const mentionThread = Object.assign(
    createThread("slack:C123:1234.5678"),
    {
      async subscribe() {
        subscriptionCount += 1;
      },
    },
  );
  await mentionHandler(mentionThread, {
    id: "1234.5678",
    threadId: "slack:C123:1234.5678",
    isMention: true,
    text: "<@UPAIGE> can you help?",
    raw: { team_id: "T123" },
    author: { userId: "U456" },
  } as Message);
  await subscribedMessageHandler(mentionThread, {
    id: "1234.9999",
    threadId: "slack:C123:1234.5678",
    text: "yup!",
    raw: { team_id: "T123" },
    author: { userId: "U456" },
  } as Message);
  assert.equal(subscriptionCount, 1);
  assert.deepEqual(reactions, [
    {
      messageId: "1111.0001",
      reaction: "ice_cube",
      threadId: "slack:D123:",
    },
    {
      messageId: "1234.5678",
      reaction: "ice_cube",
      threadId: "slack:C123:1234.5678",
    },
  ]);
  assert.deepEqual(order, [
    "reaction:1111.0001",
    "dispatch:Hello Paige",
    "reaction:1234.5678",
    "dispatch:<@UPAIGE> can you help?",
    "dispatch:yup!",
  ]);
  assert.deepEqual(calls, [
    {
      message: "Hello Paige",
      thread: directMessageThread,
      auth: {
        authenticator: "slack",
        principalType: "user",
        principalId: "U123",
        attributes: { slackWorkspaceId: "T123" },
      },
    },
    {
      message: "<@UPAIGE> can you help?",
      thread: mentionThread,
      auth: {
        authenticator: "slack",
        principalType: "user",
        principalId: "U456",
        attributes: { slackWorkspaceId: "T123" },
      },
    },
    {
      message: "yup!",
      thread: mentionThread,
      auth: {
        authenticator: "slack",
        principalType: "user",
        principalId: "U456",
        attributes: { slackWorkspaceId: "T123" },
      },
    },
  ]);
});

test("Slack workspace identity fails closed when the verified payload omits it", () => {
  const result = extractSlackWorkspaceId({ raw: {} } as Message);
  assert.equal(result.isErr(), true);
  if (result.isErr()) {
    assert.equal(result.error.code, "SLACK_INVALID_MESSAGE");
    assert.match(result.error.message, /verified workspace ID/);
  }
});

test("Slack maps Eve dispatch failures into its channel contract", async () => {
  const service = new SlackChannelService(async () => {
    throw new Error("Eve is unavailable");
  });

  const result = await service.handleMessage(
    {} as Thread,
    {
      text: "Hello Paige",
      raw: { team_id: "T123" },
      author: { userId: "U123" },
    } as Message,
  );

  assert.equal(result.isErr(), true);
  if (result.isErr()) {
    assert.equal(result.error.code, "SLACK_SESSION_DISPATCH_FAILED");
  }
});

test("Slack dispatches accepted work when acknowledgement fails", async () => {
  let directMessageHandler:
    | ((thread: Thread, message: Message) => void | Promise<void>)
    | undefined;
  let dispatchCount = 0;
  const service = new SlackChannelService(async () => {
    dispatchCount += 1;
  });
  registerSlackMessages({
    onDirectMessage(handler) {
      directMessageHandler = handler;
    },
    onNewMention() {},
    onSubscribedMessage() {},
  }, service);
  assert.ok(directMessageHandler);
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

  await directMessageHandler(
    {
      adapter: {
        async addReaction() {
          throw new Error("Slack reactions are unavailable");
        },
      },
    } as unknown as Thread,
    {
      id: "1111.0001",
      threadId: "slack:D123:",
      text: "Hello Paige",
      raw: { team_id: "T123" },
      author: { userId: "U123" },
    } as Message,
  );

  assert.equal(dispatchCount, 1);
  assert.equal(errorLog.mock.calls.length, 1);
  errorLog.mockRestore();
});

test("Slack suppresses Eve progress and tool trace statuses", () => {
  assert.doesNotThrow(() => quietSlackProgressEvents["actions.requested"]());
  assert.equal(typeof quietSlackProgressEvents["turn.started"], "function");
});

test("Slack harness and agent reactions use the same operation", async () => {
  const calls: string[] = [];
  const client = {
    async addReaction(threadId: string, messageId: string, reaction: string) {
      calls.push(`add:${threadId}:${messageId}:${reaction}`);
    },
    async removeReaction(threadId: string, messageId: string, reaction: string) {
      calls.push(`remove:${threadId}:${messageId}:${reaction}`);
    },
  };
  const target = {
    messageId: "1234.9999",
    threadId: "slack:C123:1234.5678",
  };

  await setSlackReactionPresence(client, target, "ice_cube", true);
  await setSlackReactionPresence(client, target, "ice_cube", false);
  await assert.rejects(
    setSlackReactionPresence(client, target, ":heart:", true),
    /without surrounding colons/,
  );

  assert.deepEqual(calls, [
    "add:slack:C123:1234.5678:1234.9999:ice_cube",
    "remove:slack:C123:1234.5678:1234.9999:ice_cube",
  ]);
  assert.equal(agentSlackReactionNameSchema.safeParse("heart").success, true);
  assert.equal(
    agentSlackReactionNameSchema.safeParse("custom_emoji").success,
    true,
  );
  assert.equal(
    agentSlackReactionNameSchema.safeParse("ice_cube").success,
    false,
  );
});

test("Slack reaction turns distinguish explicit and followed messages", () => {
  const explicit = slackReactionTurnForThread({
    currentMessage: {
      id: "1234.5678",
      isMention: true,
      threadId: "slack:C123:1234.5678",
    },
    isDM: false,
  });
  const followed = slackReactionTurnForThread({
    currentMessage: {
      id: "1234.9999",
      threadId: "slack:C123:1234.5678",
    },
    isDM: false,
  });

  assert.equal(explicit.workingReactionPresent, true);
  assert.equal(followed.workingReactionPresent, false);
  assert.deepEqual(followed.target, {
    messageId: "1234.9999",
    threadId: "slack:C123:1234.5678",
  });
});

test("Slack sends Eve authorization challenges to direct messages", async () => {
  const posts: Array<{ markdown: string }> = [];

  await postSlackAuthorizationRequired({
    description: "Connect with GitHub to continue.",
    authorization: {
      url: "https://example.com/authorize",
      userCode: "ABCD-1234",
    },
  }, {
    isDM: true,
    async post(message) {
      posts.push(message);
      return undefined;
    },
  });

  assert.deepEqual(posts, [{
    markdown: [
      "Connect with GitHub to continue.",
      "https://example.com/authorize",
      "Code: `ABCD-1234`",
    ].join("\n\n"),
  }]);
});

test("Slack never exposes authorization challenges outside direct messages", async () => {
  await assert.rejects(
    postSlackAuthorizationRequired({
      description: "Connect with GitHub to continue.",
      authorization: { url: "https://example.com/authorize" },
    }, {
      isDM: false,
      async post() {
        throw new Error("post must not be called");
      },
    }),
    /outside a direct message/,
  );
});
