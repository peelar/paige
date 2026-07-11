import assert from "node:assert/strict";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createClient } from "@libsql/client";
import {
  getTableConfig,
  type AnySQLiteTable,
} from "drizzle-orm/sqlite-core";

import { migrateDocsAgentDatabase } from "../agent/lib/db/client.js";
import {
  docsAgentMigrationsFolder,
  readDocsAgentMigrations,
} from "../agent/lib/db/migrations.js";
import { schema } from "../agent/lib/db/schema.js";
import {
  DOCS_AGENT_SCHEMA_LATEST_MIGRATION_AT,
  DOCS_AGENT_SCHEMA_MIGRATION_COUNT,
} from "../agent/lib/db/schema-readiness.js";

const migrationsFolder = docsAgentMigrationsFolder();
const journal = JSON.parse(
  await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};
const migrations = readDocsAgentMigrations();

assert.equal(migrations.length, journal.entries.length);
assert.equal(migrations.length, DOCS_AGENT_SCHEMA_MIGRATION_COUNT);
assert.equal(migrations.at(-1)?.folderMillis, DOCS_AGENT_SCHEMA_LATEST_MIGRATION_AT);
assert.deepEqual(
  migrations.map(({ folderMillis }) => folderMillis),
  journal.entries.map(({ when }) => when),
);
for (const entry of journal.entries) {
  await readFile(join(migrationsFolder, `${entry.tag}.sql`), "utf8");
}

const latestEntry = journal.entries.at(-1);
assert.notEqual(latestEntry, undefined);
const latestSnapshot = JSON.parse(
  await readFile(
    join(
      migrationsFolder,
      "meta",
      `${String(latestEntry.idx).padStart(4, "0")}_snapshot.json`,
    ),
    "utf8",
  ),
) as { tables: Record<string, unknown> };

const tableConfigs = Object.values(schema).map((table) =>
  getTableConfig(table as AnySQLiteTable),
);
const expectedTables = tableConfigs.map(({ name }) => name).sort();
const expectedIndexes = tableConfigs
  .flatMap(({ indexes }) => indexes.map((index) => index.config.name))
  .sort();

assert.deepEqual(Object.keys(latestSnapshot.tables).sort(), expectedTables);

const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-migration-parity-"));
const databaseUrl = `file:${join(tempRoot, "parity.sqlite")}`;
process.env.DOCS_AGENT_DATABASE_URL = databaseUrl;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

await migrateDocsAgentDatabase();
await migrateDocsAgentDatabase();

const client = createClient({ url: databaseUrl });
try {
  const objects = await client.execute(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
  );
  const rows = objects.rows.map((row) => ({
    type: String(row.type),
    name: String(row.name),
    table: String(row.tbl_name),
    sql: row.sql === null ? null : String(row.sql),
  }));

  const actualTables = rows
    .filter(({ type, name }) => type === "table" && name !== "__drizzle_migrations")
    .map(({ name }) => name)
    .sort();
  const actualIndexes = rows
    .filter(({ type, sql }) => type === "index" && sql !== null)
    .map(({ name }) => name)
    .sort();

  assert.deepEqual(actualTables, expectedTables);
  assert.deepEqual(actualIndexes, expectedIndexes);

  for (const config of tableConfigs) {
    const tableInfo = await client.execute(`PRAGMA table_info(${quoteIdentifier(config.name)})`);
    assert.deepEqual(
      tableInfo.rows.map((row) => String(row.name)),
      config.columns.map((column) => column.name),
      `Column parity failed for ${config.name}.`,
    );

    for (const index of config.indexes) {
      const indexInfo = await client.execute(
        `PRAGMA index_info(${quoteIdentifier(index.config.name)})`,
      );
      assert.deepEqual(
        indexInfo.rows.map((row) => String(row.name)),
        index.config.columns.map((column) => {
          assert.equal(typeof column, "object");
          assert.notEqual(column, null);
          assert.equal("name" in column, true);
          return String((column as { name: unknown }).name);
        }),
        `Index parity failed for ${index.config.name}.`,
      );
    }
  }

  const appliedMigrations = await client.execute(
    "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at",
  );
  assert.deepEqual(
    appliedMigrations.rows.map((row) => ({
      hash: String(row.hash),
      createdAt: Number(row.created_at),
    })),
    migrations.map((migration) => ({
      hash: migration.hash,
      createdAt: migration.folderMillis,
    })),
  );
} finally {
  client.close();
  await rm(tempRoot, { recursive: true, force: true });
}

const clientSource = await readFile(
  new URL("../agent/lib/db/client.ts", import.meta.url),
  "utf8",
);
for (const applicationTable of expectedTables) {
  assert.equal(
    clientSource.includes("CREATE TABLE IF NOT EXISTS `" + applicationTable + "`"),
    false,
    `Application table SQL must come from committed Drizzle migrations: ${applicationTable}`,
  );
}

console.log("Database migration parity checks passed.");

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
