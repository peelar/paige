import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import type { QueueEntry } from "chat";
import { describe, test } from "vitest";

import { LibsqlChatStateAdapter } from "../slack/state";
import { migrateTestDatabase } from "./database";

describe("durable Slack Chat SDK state", () => {
  test("requires the database migration before connecting", async () => {
    const client = createClient({ url: ":memory:" });
    const state = new LibsqlChatStateAdapter({ client: () => client });

    await assert.rejects(state.connect(), /slack_chat_subscriptions/);
  });

  test("shares subscriptions, cache, and locks across adapter instances", async () => {
    await withDatabase(async (client) => {
      const first = new LibsqlChatStateAdapter({ client: () => client });
      const second = new LibsqlChatStateAdapter({ client: () => client });
      await Promise.all([first.connect(), second.connect()]);

      await first.subscribe("slack:D123:");
      assert.equal(await second.isSubscribed("slack:D123:"), true);

      assert.equal(await first.setIfNotExists("dedupe:event-1", true), true);
      assert.equal(await second.setIfNotExists("dedupe:event-1", false), false);
      await first.set("expired", "old", -1);
      assert.equal(await second.setIfNotExists("expired", "new"), true);
      assert.equal(await first.get("expired"), "new");

      const firstLock = await first.acquireLock("slack:D123:", 10_000);
      assert.ok(firstLock);
      assert.equal(await second.acquireLock("slack:D123:", 10_000), null);
      await second.releaseLock({ ...firstLock, token: "not-the-owner" });
      assert.equal(await second.acquireLock("slack:D123:", 10_000), null);
      await first.releaseLock(firstLock);
      assert.ok(await second.acquireLock("slack:D123:", 10_000));
    });
  });

  test("persists bounded lists and per-thread queues", async () => {
    await withDatabase(async (client) => {
      const state = new LibsqlChatStateAdapter({ client: () => client });
      await state.connect();

      await state.appendToList("history", 1, { maxLength: 2 });
      await state.appendToList("history", 2, { maxLength: 2 });
      await state.appendToList("history", 3, { maxLength: 2 });
      assert.deepEqual(await state.getList("history"), [2, 3]);

      assert.equal(await state.enqueue("thread", queueEntry("one"), 2), 1);
      assert.equal(await state.enqueue("thread", queueEntry("two"), 2), 2);
      assert.equal(await state.enqueue("thread", queueEntry("three"), 2), 2);
      assert.equal(await state.queueDepth("thread"), 2);
      assert.equal((await state.dequeue("thread"))?.message.text, "two");
      assert.equal((await state.dequeue("thread"))?.message.text, "three");
      assert.equal(await state.dequeue("thread"), null);
    });
  });
});

async function withDatabase(
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "paige-slack-state-"));
  const client = createClient({ url: `file:${join(directory, "state.db")}` });
  try {
    await migrateTestDatabase(client);
    await run(client);
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function queueEntry(text: string): QueueEntry {
  return {
    enqueuedAt: 1,
    expiresAt: 2,
    message: { text } as QueueEntry["message"],
  };
}
