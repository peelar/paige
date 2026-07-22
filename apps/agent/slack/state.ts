import { createClient } from "@libsql/client";
import type { Client, Value } from "@libsql/client";
import type { Lock, QueueEntry, StateAdapter } from "chat";

type ClientProvider = () => Client;

interface LibsqlChatStateAdapterOptions {
  client: ClientProvider;
  ownsClient?: boolean;
}

/** Durable Chat SDK state backed by Paige's required libSQL database. */
export class LibsqlChatStateAdapter implements StateAdapter {
  readonly #clientProvider: ClientProvider;
  readonly #ownsClient: boolean;
  #client: Client | undefined;
  #connecting: Promise<void> | undefined;
  #connected = false;

  constructor(options: LibsqlChatStateAdapterOptions) {
    this.#clientProvider = options.client;
    this.#ownsClient = options.ownsClient ?? false;
  }

  async connect(): Promise<void> {
    if (this.#connected) return;
    if (this.#connecting !== undefined) return await this.#connecting;

    const connecting = (async () => {
      const client = this.#clientProvider();
      try {
        await verifySchema(client);
        this.#client = client;
        this.#connected = true;
      } catch (error) {
        if (this.#ownsClient) client.close();
        throw error;
      }
    })();
    this.#connecting = connecting;
    try {
      await connecting;
    } finally {
      this.#connecting = undefined;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    this.#connected = false;
    if (client !== undefined && this.#ownsClient) client.close();
  }

  async subscribe(threadId: string): Promise<void> {
    await this.#database().execute({
      sql: `INSERT OR IGNORE INTO slack_chat_subscriptions (thread_id) VALUES (?)`,
      args: [threadId],
    });
  }

  async unsubscribe(threadId: string): Promise<void> {
    await this.#database().execute({
      sql: `DELETE FROM slack_chat_subscriptions WHERE thread_id = ?`,
      args: [threadId],
    });
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    const result = await this.#database().execute({
      sql: `SELECT 1 FROM slack_chat_subscriptions WHERE thread_id = ? LIMIT 1`,
      args: [threadId],
    });
    return result.rows.length > 0;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const now = Date.now();
    const lock = {
      threadId,
      token: `libsql_${crypto.randomUUID()}`,
      expiresAt: now + ttlMs,
    };
    const result = await this.#database().execute({
      sql: `
        INSERT INTO slack_chat_locks (thread_id, token, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT (thread_id) DO UPDATE SET
          token = excluded.token,
          expires_at = excluded.expires_at
        WHERE slack_chat_locks.expires_at <= ?
        RETURNING thread_id
      `,
      args: [lock.threadId, lock.token, lock.expiresAt, now],
    });
    return result.rows.length === 0 ? null : lock;
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    await this.#database().execute({
      sql: `DELETE FROM slack_chat_locks WHERE thread_id = ?`,
      args: [threadId],
    });
  }

  async releaseLock(lock: Lock): Promise<void> {
    await this.#database().execute({
      sql: `DELETE FROM slack_chat_locks WHERE thread_id = ? AND token = ?`,
      args: [lock.threadId, lock.token],
    });
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const result = await this.#database().execute({
      sql: `
        UPDATE slack_chat_locks
        SET expires_at = ?
        WHERE thread_id = ? AND token = ? AND expires_at > ?
        RETURNING thread_id
      `,
      args: [now + ttlMs, lock.threadId, lock.token, now],
    });
    return result.rows.length > 0;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const result = await this.#database().execute({
      sql: `
        SELECT state_value
        FROM slack_chat_cache
        WHERE state_key = ? AND (expires_at IS NULL OR expires_at > ?)
        LIMIT 1
      `,
      args: [key, Date.now()],
    });
    const row = result.rows[0];
    return row === undefined ? null : parseJson<T>(row.state_value);
  }

  async set<T = unknown>(
    key: string,
    value: T,
    ttlMs?: number,
  ): Promise<void> {
    await this.#database().execute({
      sql: `
        INSERT INTO slack_chat_cache (state_key, state_value, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT (state_key) DO UPDATE SET
          state_value = excluded.state_value,
          expires_at = excluded.expires_at
      `,
      args: [key, JSON.stringify(value), expiresAt(ttlMs)],
    });
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number,
  ): Promise<boolean> {
    const now = Date.now();
    const result = await this.#database().execute({
      sql: `
        INSERT INTO slack_chat_cache (state_key, state_value, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT (state_key) DO UPDATE SET
          state_value = excluded.state_value,
          expires_at = excluded.expires_at
        WHERE slack_chat_cache.expires_at IS NOT NULL
          AND slack_chat_cache.expires_at <= ?
        RETURNING state_key
      `,
      args: [key, JSON.stringify(value), expiresAt(ttlMs, now), now],
    });
    return result.rows.length > 0;
  }

  async delete(key: string): Promise<void> {
    await this.#database().execute({
      sql: `DELETE FROM slack_chat_cache WHERE state_key = ?`,
      args: [key],
    });
  }

  async appendToList(
    key: string,
    value: unknown,
    options: { maxLength?: number; ttlMs?: number } = {},
  ): Promise<void> {
    const transaction = await this.#database().transaction("write");
    try {
      const result = await transaction.execute({
        sql: `
          SELECT state_value
          FROM slack_chat_cache
          WHERE state_key = ? AND (expires_at IS NULL OR expires_at > ?)
          LIMIT 1
        `,
        args: [key, Date.now()],
      });
      const stored = result.rows[0]?.state_value;
      const parsed = stored === undefined ? [] : parseJson<unknown>(stored);
      const list = Array.isArray(parsed) ? parsed : [];
      list.push(value);
      const maxLength = options.maxLength;
      const trimmed = maxLength !== undefined && list.length > maxLength
        ? list.slice(list.length - maxLength)
        : list;
      await transaction.execute({
        sql: `
          INSERT INTO slack_chat_cache (state_key, state_value, expires_at)
          VALUES (?, ?, ?)
          ON CONFLICT (state_key) DO UPDATE SET
            state_value = excluded.state_value,
            expires_at = excluded.expires_at
        `,
        args: [key, JSON.stringify(trimmed), expiresAt(options.ttlMs)],
      });
      await transaction.commit();
    } finally {
      transaction.close();
    }
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    const value = await this.get<unknown>(key);
    return Array.isArray(value) ? value as T[] : [];
  }

  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number,
  ): Promise<number> {
    const limit = Math.max(1, maxSize);
    const results = await this.#database().batch([
      {
        sql: `INSERT INTO slack_chat_queue (thread_id, entry) VALUES (?, ?)`,
        args: [threadId, JSON.stringify(entry)],
      },
      {
        sql: `
          DELETE FROM slack_chat_queue
          WHERE thread_id = ? AND id NOT IN (
            SELECT id FROM slack_chat_queue
            WHERE thread_id = ?
            ORDER BY id DESC
            LIMIT ?
          )
        `,
        args: [threadId, threadId, limit],
      },
      {
        sql: `SELECT COUNT(*) AS depth FROM slack_chat_queue WHERE thread_id = ?`,
        args: [threadId],
      },
    ], "write");
    return numberValue(results[2]?.rows[0]?.depth);
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    const result = await this.#database().execute({
      sql: `
        DELETE FROM slack_chat_queue
        WHERE id = (
          SELECT id FROM slack_chat_queue
          WHERE thread_id = ?
          ORDER BY id ASC
          LIMIT 1
        )
        RETURNING entry
      `,
      args: [threadId],
    });
    const row = result.rows[0];
    return row === undefined ? null : parseJson<QueueEntry>(row.entry);
  }

  async queueDepth(threadId: string): Promise<number> {
    const result = await this.#database().execute({
      sql: `SELECT COUNT(*) AS depth FROM slack_chat_queue WHERE thread_id = ?`,
      args: [threadId],
    });
    return numberValue(result.rows[0]?.depth);
  }

  #database(): Client {
    if (!this.#connected || this.#client === undefined) {
      throw new Error("Slack chat state is not connected.");
    }
    return this.#client;
  }
}

export function createSlackState(): LibsqlChatStateAdapter {
  return new LibsqlChatStateAdapter({
    ownsClient: true,
    client: () => {
      const url = process.env.PAIGE_DATABASE_URL?.trim();
      if (!url) throw new Error("Paige database is not configured.");
      return createClient({
        url,
        authToken: process.env.PAIGE_DATABASE_AUTH_TOKEN?.trim() || undefined,
      });
    },
  });
}

function expiresAt(ttlMs?: number, now = Date.now()): number | null {
  return ttlMs === undefined ? null : now + ttlMs;
}

function parseJson<T>(value: Value): T {
  if (typeof value !== "string") {
    throw new Error("Slack chat state contains invalid JSON storage.");
  }
  return JSON.parse(value) as T;
}

function numberValue(value: Value | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

async function verifySchema(client: Client): Promise<void> {
  // Connecting is intentionally read-only. Operators apply schema changes with
  // the migration command before starting Paige.
  await client.batch([
    `
      SELECT thread_id FROM slack_chat_subscriptions LIMIT 0
    `,
    `
      SELECT thread_id, token, expires_at FROM slack_chat_locks LIMIT 0
    `,
    `
      SELECT state_key, state_value, expires_at FROM slack_chat_cache LIMIT 0
    `,
    `
      SELECT id, thread_id, entry FROM slack_chat_queue LIMIT 0
    `,
  ], "read");
}
