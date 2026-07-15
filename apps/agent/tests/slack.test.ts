import assert from "node:assert/strict";

import type { Message, Thread } from "chat";
import { test } from "vitest";

import { registerDirectMessages } from "../agent/channels/slack";

test("Slack registers only the direct-message path", async () => {
  let handler:
    | ((thread: Thread, message: Message) => void | Promise<void>)
    | undefined;
  const bot = {
    onDirectMessage(candidate: NonNullable<typeof handler>) {
      handler = candidate;
    },
  };
  const calls: Array<{ message: string; thread: Thread }> = [];

  registerDirectMessages(bot, async (message, { thread }) => {
    calls.push({ message, thread });
  });

  assert.ok(handler, "the direct-message handler is registered");
  const thread = { id: "slack:D123:" } as Thread;
  await handler(thread, { text: "Hello Paige" } as Message);
  assert.deepEqual(calls, [{ message: "Hello Paige", thread }]);
});
