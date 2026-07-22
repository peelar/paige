import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";
import { test } from "vitest";

import { migrateTestDatabase } from "./database";

test("adopts an existing Paige database and remains idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paige-migration-"));
  const client = createClient({ url: `file:${join(directory, "state.db")}` });

  try {
    // Earlier Paige versions created this table at runtime. The baseline
    // migration must preserve its data while adopting the migration ledger.
    await client.execute(`
      CREATE TABLE agent_repository_configuration (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
        configuration TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await client.execute({
      sql: `
        INSERT INTO agent_repository_configuration
          (id, configuration, revision, updated_at)
        VALUES (1, ?, 7, '2026-07-22T00:00:00.000Z')
      `,
      args: [JSON.stringify({ preserved: true })],
    });

    await migrateTestDatabase(client);
    await migrateTestDatabase(client);

    const configuration = await client.execute(
      "SELECT configuration, revision FROM agent_repository_configuration",
    );
    assert.equal(configuration.rows[0]?.configuration, '{"preserved":true}');
    assert.equal(configuration.rows[0]?.revision, 7);

    const tables = await client.execute(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'agent_repository_configuration',
        'agent_sessions',
        'slack_chat_cache',
        'slack_chat_locks',
        'slack_chat_queue',
        'slack_chat_subscriptions'
      )
    `);
    assert.equal(tables.rows.length, 6);

    const ledger = await client.execute(
      "SELECT COUNT(*) AS count FROM __drizzle_migrations",
    );
    assert.equal(Number(ledger.rows[0]?.count), 1);
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
