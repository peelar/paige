import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { LibSqlChatStateAdapter } from "../src/libsql-chat-state.js";

if (!process.env.DOCS_AGENT_DATABASE_URL?.startsWith("libsql://")) throw new Error("Set DOCS_AGENT_DATABASE_URL to a migrated remote libSQL/Turso database.");
if (!process.env.DOCS_AGENT_DATABASE_AUTH_TOKEN) throw new Error("Set DOCS_AGENT_DATABASE_AUTH_TOKEN for the remote Turso database.");
const adapter = new LibSqlChatStateAdapter();
await adapter.connect();
const suffix = randomUUID();
const key = `chat-sdk-remote-smoke:${suffix}`;
const threadId = `chat-sdk-remote-smoke:${suffix}`;
try {
  await adapter.subscribe(threadId);
  assert.equal(await adapter.isSubscribed(threadId), true);
  const lock = await adapter.acquireLock(threadId, 60_000);
  assert.notEqual(lock, null);
  await adapter.set(key, { ok: true }, 60_000);
  assert.deepEqual(await adapter.get(key), { ok: true });
  assert.equal(await adapter.setIfNotExists(key, { ok: false }), false);
  await adapter.delete(key);
  assert.equal(await adapter.get(key), null);
  if (lock !== null) await adapter.releaseLock(lock);
  await adapter.unsubscribe(threadId);
} finally {
  await adapter.forceReleaseLock(threadId);
  await adapter.unsubscribe(threadId);
  await adapter.delete(key);
  await adapter.disconnect();
}
console.log("Remote Turso Chat SDK state smoke passed.");
