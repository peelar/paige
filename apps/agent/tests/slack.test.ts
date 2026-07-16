import assert from "node:assert/strict";

import type { Message, Thread } from "chat";
import { test } from "vitest";

import {
  extractSlackWorkspaceId,
  registerDirectMessages,
} from "../agent/channels/slack";

test("Slack registers only the direct-message path", async () => {
  let handler:
    | ((thread: Thread, message: Message) => void | Promise<void>)
    | undefined;
  const bot = {
    onDirectMessage(candidate: NonNullable<typeof handler>) {
      handler = candidate;
    },
  };
  const calls: Array<{
    message: string;
    thread: Thread;
    auth: {
      authenticator: "slack";
      principalType: "user";
      principalId: string;
      attributes: { slackWorkspaceId: string };
    };
  }> = [];

  registerDirectMessages(bot, async (message, { thread, auth }) => {
    calls.push({ message, thread, auth });
  });

  assert.ok(handler, "the direct-message handler is registered");
  const thread = { id: "slack:D123:" } as Thread;
  await handler(thread, {
    text: "Hello Paige",
    raw: { team_id: "T123" },
    author: { userId: "U123" },
  } as Message);
  assert.deepEqual(calls, [{
    message: "Hello Paige",
    thread,
    auth: {
      authenticator: "slack",
      principalType: "user",
      principalId: "U123",
      attributes: { slackWorkspaceId: "T123" },
    },
  }]);
});

test("Slack workspace identity fails closed when the verified payload omits it", () => {
  assert.throws(
    () => extractSlackWorkspaceId({ raw: {} } as Message),
    /verified workspace ID/,
  );
});
