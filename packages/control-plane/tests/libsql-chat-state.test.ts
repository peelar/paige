import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QueueEntry } from "chat";

import { migrateDocsAgentDatabase } from "../src/db/client.ts";
import { LibSqlChatStateAdapter } from "../src/libsql-chat-state.ts";
import { test } from "vitest";

test("libsql chat state", async () => {
const root = await mkdtemp(join(tmpdir(), "docs-agent-chat-state-"));
const originalUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalToken = process.env.DOCS_AGENT_DATABASE_AUTH_TOKEN;
const originalVercel = process.env.VERCEL;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(root, "chat.sqlite")}`;
delete process.env.DOCS_AGENT_DATABASE_AUTH_TOKEN;
delete process.env.VERCEL;

try {
  await migrateDocsAgentDatabase();
  const first = new LibSqlChatStateAdapter();
  await assert.rejects(first.get("before-connect"), /not connected/i);
  await first.connect();
  await first.subscribe("thread-persistent");
  assert.equal(await first.isSubscribed("thread-persistent"), true);
  await first.disconnect();

  const second = new LibSqlChatStateAdapter();
  await second.connect();
  assert.equal(await second.isSubscribed("thread-persistent"), true, "subscriptions survive database reconnects");
  await first.connect();
  await second.unsubscribe("thread-persistent");
  assert.equal(await first.isSubscribed("thread-persistent"), false);

  const locks = await Promise.all([first.acquireLock("thread-lock", 5_000), second.acquireLock("thread-lock", 5_000)]);
  assert.equal(locks.filter(Boolean).length, 1, "lock acquisition is atomic");
  const owner = locks.find((lock) => lock !== null)!;
  const staleOwner = { ...owner, token: "not-owner" };
  await second.releaseLock(staleOwner);
  assert.equal(await second.acquireLock("thread-lock", 5_000), null);
  assert.equal(await second.extendLock(staleOwner, 5_000), false);
  assert.equal(await first.extendLock(owner, 5_000), true);
  await first.releaseLock(owner);
  assert.notEqual(await second.acquireLock("thread-lock", 5_000), null);
  await first.forceReleaseLock("thread-lock");
  const expiring = await first.acquireLock("thread-expiring", 1);
  assert.notEqual(expiring, null);
  await delay(5);
  assert.notEqual(await second.acquireLock("thread-expiring", 5_000), null, "expired locks are lazily replaced");

  await first.set("state", { value: 1 });
  assert.deepEqual(await second.get("state"), { value: 1 });
  assert.equal(await first.setIfNotExists("state", { value: 2 }), false);
  await first.delete("state");
  assert.equal(await second.setIfNotExists("state", { value: 3 }), true);
  assert.deepEqual(await first.get("state"), { value: 3 });
  await first.set("ttl", "gone", 1);
  await delay(5);
  assert.equal(await second.get("ttl"), null);
  const nxResults = await Promise.all([
    first.setIfNotExists("concurrent-nx", "first"),
    second.setIfNotExists("concurrent-nx", "second"),
  ]);
  assert.equal(nxResults.filter(Boolean).length, 1, "NX writes have one winner");

  await Promise.all(Array.from({ length: 20 }, (_, index) => first.appendToList("history", index, { maxLength: 10, ttlMs: 5_000 })));
  const history = await second.getList<number>("history");
  assert.equal(history.length, 10);
  assert.equal(new Set(history).size, 10);
  await first.appendToList("short-list", "a", { ttlMs: 1 });
  await delay(5);
  assert.deepEqual(await second.getList("short-list"), []);
  await first.appendToList("refreshed-list", "a", { ttlMs: 100 });
  await first.appendToList("refreshed-list", "b");
  await delay(120);
  assert.deepEqual(await second.getList("refreshed-list"), ["a", "b"], "an append without TTL clears the previous expiry");
  await first.delete("refreshed-list");
  assert.deepEqual(await second.getList("refreshed-list"), [], "delete removes list state");

  const now = Date.now();
  assert.equal(await first.enqueue("thread-queue", entry("one", now + 5_000), 2), 1);
  assert.equal(await first.enqueue("thread-queue", entry("two", now + 5_000), 2), 2);
  assert.equal(await first.enqueue("thread-queue", entry("three", now + 5_000), 2), 2);
  assert.equal(await second.queueDepth("thread-queue"), 2);
  assert.equal(messageId(await second.dequeue("thread-queue")), "two");
  assert.equal(messageId(await second.dequeue("thread-queue")), "three");
  assert.equal(await second.dequeue("thread-queue"), null);
  await first.enqueue("thread-expired-queue", entry("expired", now - 1), 10);
  assert.equal(await second.queueDepth("thread-expired-queue"), 0);
  await Promise.all(Array.from({ length: 20 }, (_, index) => first.enqueue("thread-concurrent-queue", entry(String(index), now + 5_000), 10)));
  assert.equal(await second.queueDepth("thread-concurrent-queue"), 10);
  const concurrentMessages = [];
  for (let index = 0; index < 10; index += 1) concurrentMessages.push(messageId(await second.dequeue("thread-concurrent-queue")));
  assert.equal(new Set(concurrentMessages).size, 10, "concurrent queue writes preserve distinct FIFO entries");

  await first.disconnect();
  await second.disconnect();
  delete process.env.DOCS_AGENT_DATABASE_URL;
  process.env.VERCEL = "1";
  await assert.rejects(new LibSqlChatStateAdapter().connect(), /DOCS_AGENT_DATABASE_URL is required/);
} finally {
  restore("DOCS_AGENT_DATABASE_URL", originalUrl);
  restore("DOCS_AGENT_DATABASE_AUTH_TOKEN", originalToken);
  restore("VERCEL", originalVercel);
  await rm(root, { recursive: true, force: true });
}

console.log("LibSQL Chat SDK state adapter checks passed.");
function entry(id: string, expiresAt: number): QueueEntry { return { enqueuedAt: Date.now(), expiresAt, message: { id } } as unknown as QueueEntry; }
function messageId(value: QueueEntry | null): string | null { return value === null ? null : (value.message as unknown as { id: string }).id; }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function restore(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});
