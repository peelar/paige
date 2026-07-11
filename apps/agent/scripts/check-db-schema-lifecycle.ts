import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";

import {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
} from "../agent/lib/db/client.js";
import { readDocsAgentMigrations } from "../agent/lib/db/migrations.js";

const migrations = readDocsAgentMigrations();
const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-schema-lifecycle-"));
const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;
const originalNodeEnv = process.env.NODE_ENV;

delete process.env.VERCEL;
delete process.env.NODE_ENV;

try {
  const freshUrl = databaseUrl("fresh");
  process.env.DOCS_AGENT_DATABASE_URL = freshUrl;

  await assert.rejects(
    () => withDocsAgentDatabase((db) => db.all(sql`SELECT 1`)),
    /database schema is not ready.*pnpm db:migrate/i,
  );
  assert.equal(await databaseObjectExists(freshUrl, "__drizzle_migrations"), false);

  await migrateDocsAgentDatabase();
  assert.equal(await readWorkspaceSetupCount(), 0);
  await assertAppliedMigrations(freshUrl, migrations.length);

  for (let prefixCount = 1; prefixCount <= migrations.length; prefixCount += 1) {
    const upgradeUrl = databaseUrl(`upgrade-${prefixCount}`);
    await seedMigrationPrefix(upgradeUrl, prefixCount);
    process.env.DOCS_AGENT_DATABASE_URL = upgradeUrl;

    await migrateDocsAgentDatabase();
    assert.equal(await readWorkspaceSetupCount(), 0);
    await assertAppliedMigrations(upgradeUrl, migrations.length);
  }

  const stalePrefixCount = Math.max(1, migrations.length - 1);
  const staleUrl = databaseUrl("stale");
  await seedMigrationPrefix(staleUrl, stalePrefixCount);
  process.env.DOCS_AGENT_DATABASE_URL = staleUrl;

  await assert.rejects(
    () => readWorkspaceSetupCount(),
    new RegExp(`Expected ${migrations.length} migrations.*found ${stalePrefixCount}`),
  );
  await assertAppliedMigrations(staleUrl, stalePrefixCount);

  const partialUrl = databaseUrl("partial");
  await seedMigrationPrefix(partialUrl, 1);
  const partialClient = createClient({ url: partialUrl });
  try {
    await partialClient.execute(
      "CREATE TABLE docs_signal_events (id text PRIMARY KEY NOT NULL)",
    );
  } finally {
    partialClient.close();
  }
  process.env.DOCS_AGENT_DATABASE_URL = partialUrl;

  await assert.rejects(migrateDocsAgentDatabase, /already exists/i);
  await assertAppliedMigrations(partialUrl, 1);
  assert.equal(await databaseObjectExists(partialUrl, "docs_signal_artifacts"), false);
  await assert.rejects(
    () => readWorkspaceSetupCount(),
    /database schema is not ready/i,
  );

  process.env.DOCS_AGENT_DATABASE_URL = freshUrl;
  const readerResults = await Promise.all(
    Array.from({ length: 20 }, () => readWorkspaceSetupCount()),
  );
  assert.deepEqual(readerResults, Array.from({ length: 20 }, () => 0));
  await assertAppliedMigrations(freshUrl, migrations.length);
} finally {
  restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
  restoreEnvironment("VERCEL", originalVercel);
  restoreEnvironment("NODE_ENV", originalNodeEnv);
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Database schema lifecycle checks passed.");

function databaseUrl(name: string): string {
  return `file:${join(tempRoot, `${name}.sqlite`)}`;
}

async function seedMigrationPrefix(url: string, prefixCount: number): Promise<void> {
  const client = createClient({ url });

  try {
    await client.execute(`
      CREATE TABLE __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )
    `);

    for (const migration of migrations.slice(0, prefixCount)) {
      for (const statement of migration.sql) {
        await client.execute(statement);
      }
      await client.execute({
        sql: "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        args: [migration.hash, migration.folderMillis],
      });
    }
  } finally {
    client.close();
  }
}

async function assertAppliedMigrations(url: string, expectedCount: number): Promise<void> {
  const client = createClient({ url });

  try {
    const result = await client.execute(
      "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at",
    );
    assert.deepEqual(
      result.rows.map((row) => ({
        hash: String(row.hash),
        createdAt: Number(row.created_at),
      })),
      migrations.slice(0, expectedCount).map((migration) => ({
        hash: migration.hash,
        createdAt: migration.folderMillis,
      })),
    );
  } finally {
    client.close();
  }
}

async function databaseObjectExists(url: string, name: string): Promise<boolean> {
  const client = createClient({ url });

  try {
    const result = await client.execute({
      sql: "SELECT 1 FROM sqlite_master WHERE name = ? LIMIT 1",
      args: [name],
    });
    return result.rows.length > 0;
  } finally {
    client.close();
  }
}

async function readWorkspaceSetupCount(): Promise<number> {
  return withDocsAgentDatabase(async (db) => {
    const rows = await db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count
      FROM workspace_setup
    `);
    return Number(rows[0]?.count ?? 0);
  });
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
