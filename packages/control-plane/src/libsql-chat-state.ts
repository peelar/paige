import { randomUUID } from "node:crypto";

import type { Lock, QueueEntry, StateAdapter } from "chat";
import { and, asc, count, desc, eq, gt, lte, lt } from "drizzle-orm";

import {
  acquireSharedDocsAgentDatabase,
  releaseSharedDocsAgentDatabase,
  type DocsAgentDatabase,
} from "./db/client.js";
import {
  chatSdkKeyValues,
  chatSdkListEntries,
  chatSdkLocks,
  chatSdkQueueEntries,
  chatSdkSubscriptions,
} from "./db/schema.js";

const MAX_BUSY_RETRIES = 5;
let stateOperationTail: Promise<void> = Promise.resolve();

export class LibSqlChatStateAdapter implements StateAdapter {
  private db: DocsAgentDatabase | null = null;

  async connect(): Promise<void> {
    if (this.db === null) this.db = await acquireSharedDocsAgentDatabase();
  }

  async disconnect(): Promise<void> {
    if (this.db === null) return;
    this.db = null;
    releaseSharedDocsAgentDatabase();
  }

  async subscribe(threadId: string): Promise<void> {
    await this.run(async (db) => {
      await db
        .insert(chatSdkSubscriptions)
        .values({ threadId, createdAt: Date.now() })
        .onConflictDoNothing();
    });
  }

  async unsubscribe(threadId: string): Promise<void> {
    await this.run(async (db) => {
      await db
        .delete(chatSdkSubscriptions)
        .where(eq(chatSdkSubscriptions.threadId, threadId));
    });
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    return this.run(async (db) => {
      const rows = await db
        .select({ threadId: chatSdkSubscriptions.threadId })
        .from(chatSdkSubscriptions)
        .where(eq(chatSdkSubscriptions.threadId, threadId))
        .limit(1);
      return rows.length === 1;
    });
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    return this.run(async (db) => {
      const now = Date.now();
      const lock = { threadId, token: randomUUID(), expiresAt: now + ttlMs };
      return db.transaction(async (tx) => {
        await tx
          .delete(chatSdkLocks)
          .where(
            and(
              eq(chatSdkLocks.threadId, threadId),
              lte(chatSdkLocks.expiresAt, now),
            ),
          );
        const inserted = await tx
          .insert(chatSdkLocks)
          .values(lock)
          .onConflictDoNothing()
          .returning({ threadId: chatSdkLocks.threadId });
        return inserted.length === 1 ? lock : null;
      });
    });
  }

  async releaseLock(lock: Lock): Promise<void> {
    await this.run(async (db) => {
      await db
        .delete(chatSdkLocks)
        .where(
          and(
            eq(chatSdkLocks.threadId, lock.threadId),
            eq(chatSdkLocks.token, lock.token),
          ),
        );
    });
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    return this.run(async (db) => {
      const now = Date.now();
      const updated = await db
        .update(chatSdkLocks)
        .set({ expiresAt: now + ttlMs })
        .where(
          and(
            eq(chatSdkLocks.threadId, lock.threadId),
            eq(chatSdkLocks.token, lock.token),
            gt(chatSdkLocks.expiresAt, now),
          ),
        )
        .returning({ threadId: chatSdkLocks.threadId });
      return updated.length === 1;
    });
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    await this.run(async (db) => {
      await db.delete(chatSdkLocks).where(eq(chatSdkLocks.threadId, threadId));
    });
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    return this.run(async (db) => {
      const now = Date.now();
      await db
        .delete(chatSdkKeyValues)
        .where(
          and(
            eq(chatSdkKeyValues.key, key),
            lte(chatSdkKeyValues.expiresAt, now),
          ),
        );
      const row = (
        await db
          .select({ value: chatSdkKeyValues.value })
          .from(chatSdkKeyValues)
          .where(eq(chatSdkKeyValues.key, key))
          .limit(1)
      )[0];
      return row === undefined ? null : (row.value as T);
    });
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    await this.run(async (db) => {
      const expiresAt = expiry(ttlMs);
      await db
        .insert(chatSdkKeyValues)
        .values({ key, value, expiresAt })
        .onConflictDoUpdate({
          target: chatSdkKeyValues.key,
          set: { value, expiresAt },
        });
    });
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number,
  ): Promise<boolean> {
    return this.run(async (db) => {
      const now = Date.now();
      return db.transaction(async (tx) => {
        await tx
          .delete(chatSdkKeyValues)
          .where(
            and(
              eq(chatSdkKeyValues.key, key),
              lte(chatSdkKeyValues.expiresAt, now),
            ),
          );
        const rows = await tx
          .insert(chatSdkKeyValues)
          .values({ key, value, expiresAt: expiry(ttlMs, now) })
          .onConflictDoNothing()
          .returning({ key: chatSdkKeyValues.key });
        return rows.length === 1;
      });
    });
  }

  async delete(key: string): Promise<void> {
    await this.run(async (db) => {
      await db.delete(chatSdkKeyValues).where(eq(chatSdkKeyValues.key, key));
      await db.delete(chatSdkListEntries).where(eq(chatSdkListEntries.key, key));
    });
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number },
  ): Promise<void> {
    await this.run(async (db) => {
      const now = Date.now();
      await db.transaction(async (tx) => {
        await tx
          .delete(chatSdkListEntries)
          .where(
            and(
              eq(chatSdkListEntries.key, key),
              lte(chatSdkListEntries.expiresAt, now),
            ),
          );
        const latest = (
          await tx
            .select({ sequence: chatSdkListEntries.sequence })
            .from(chatSdkListEntries)
            .where(eq(chatSdkListEntries.key, key))
            .orderBy(desc(chatSdkListEntries.sequence))
            .limit(1)
        )[0]?.sequence ?? 0;
        const expiresAt = expiry(options?.ttlMs, now);
        await tx.insert(chatSdkListEntries).values({
          id: randomUUID(),
          key,
          sequence: latest + 1,
          value,
          expiresAt,
        });
        await tx
          .update(chatSdkListEntries)
          .set({ expiresAt })
          .where(eq(chatSdkListEntries.key, key));

        if (options?.maxLength !== undefined) {
          const keep = await tx
            .select({ sequence: chatSdkListEntries.sequence })
            .from(chatSdkListEntries)
            .where(eq(chatSdkListEntries.key, key))
            .orderBy(desc(chatSdkListEntries.sequence))
            .limit(Math.max(0, options.maxLength));
          const threshold = keep.at(-1)?.sequence;
          if (threshold === undefined) {
            await tx
              .delete(chatSdkListEntries)
              .where(eq(chatSdkListEntries.key, key));
          } else {
            await tx
              .delete(chatSdkListEntries)
              .where(
                and(
                  eq(chatSdkListEntries.key, key),
                  lt(chatSdkListEntries.sequence, threshold),
                ),
              );
          }
        }
      });
    });
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    return this.run(async (db) => {
      await db
        .delete(chatSdkListEntries)
        .where(
          and(
            eq(chatSdkListEntries.key, key),
            lte(chatSdkListEntries.expiresAt, Date.now()),
          ),
        );
      const rows = await db
        .select({ value: chatSdkListEntries.value })
        .from(chatSdkListEntries)
        .where(eq(chatSdkListEntries.key, key))
        .orderBy(asc(chatSdkListEntries.sequence));
      return rows.map(({ value }) => value as T);
    });
  }

  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number,
  ): Promise<number> {
    return this.run(async (db) => {
      const now = Date.now();
      return db.transaction(async (tx) => {
        await tx
          .delete(chatSdkQueueEntries)
          .where(
            and(
              eq(chatSdkQueueEntries.threadId, threadId),
              lte(chatSdkQueueEntries.expiresAt, now),
            ),
          );
        const latest = (
          await tx
            .select({ sequence: chatSdkQueueEntries.sequence })
            .from(chatSdkQueueEntries)
            .where(eq(chatSdkQueueEntries.threadId, threadId))
            .orderBy(desc(chatSdkQueueEntries.sequence))
            .limit(1)
        )[0]?.sequence ?? 0;
        await tx.insert(chatSdkQueueEntries).values({
          id: randomUUID(),
          threadId,
          sequence: latest + 1,
          entry,
          expiresAt: entry.expiresAt,
        });
        const keep = await tx
          .select({ sequence: chatSdkQueueEntries.sequence })
          .from(chatSdkQueueEntries)
          .where(eq(chatSdkQueueEntries.threadId, threadId))
          .orderBy(desc(chatSdkQueueEntries.sequence))
          .limit(Math.max(0, maxSize));
        const threshold = keep.at(-1)?.sequence;
        if (threshold === undefined) {
          await tx
            .delete(chatSdkQueueEntries)
            .where(eq(chatSdkQueueEntries.threadId, threadId));
        } else {
          await tx
            .delete(chatSdkQueueEntries)
            .where(
              and(
                eq(chatSdkQueueEntries.threadId, threadId),
                lt(chatSdkQueueEntries.sequence, threshold),
              ),
            );
        }
        return keep.length;
      });
    });
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    return this.run(async (db) => {
      return db.transaction(async (tx) => {
        await tx
          .delete(chatSdkQueueEntries)
          .where(
            and(
              eq(chatSdkQueueEntries.threadId, threadId),
              lte(chatSdkQueueEntries.expiresAt, Date.now()),
            ),
          );
        const row = (
          await tx
            .select()
            .from(chatSdkQueueEntries)
            .where(eq(chatSdkQueueEntries.threadId, threadId))
            .orderBy(asc(chatSdkQueueEntries.sequence))
            .limit(1)
        )[0];
        if (row === undefined) return null;
        await tx
          .delete(chatSdkQueueEntries)
          .where(eq(chatSdkQueueEntries.id, row.id));
        return row.entry as QueueEntry;
      });
    });
  }

  async queueDepth(threadId: string): Promise<number> {
    return this.run(async (db) => {
      await db
        .delete(chatSdkQueueEntries)
        .where(
          and(
            eq(chatSdkQueueEntries.threadId, threadId),
            lte(chatSdkQueueEntries.expiresAt, Date.now()),
          ),
        );
      return (
        await db
          .select({ value: count() })
          .from(chatSdkQueueEntries)
          .where(eq(chatSdkQueueEntries.threadId, threadId))
      )[0]?.value ?? 0;
    });
  }

  private run<T>(operation: (db: DocsAgentDatabase) => Promise<T>): Promise<T> {
    const db = this.database();
    return serializeStateOperation(() => retryBusy(() => operation(db)));
  }

  private database(): DocsAgentDatabase {
    if (this.db === null) {
      throw new Error(
        "LibSqlChatStateAdapter is not connected. Required Chat SDK persistence is unavailable.",
      );
    }
    return this.db;
  }
}

export function createLibSqlChatStateAdapter(): StateAdapter {
  return new LibSqlChatStateAdapter();
}

function expiry(ttlMs?: number, now = Date.now()): number | null {
  return ttlMs === undefined ? null : now + ttlMs;
}

function serializeStateOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = stateOperationTail.then(operation, operation);
  stateOperationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function retryBusy<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isBusyError(error) || attempt >= MAX_BUSY_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
    }
  }
}

function isBusyError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "SQLITE_BUSY";
}
