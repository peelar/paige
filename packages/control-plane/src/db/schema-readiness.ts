import { sql } from "drizzle-orm";
import { getTableConfig, type AnySQLiteTable } from "drizzle-orm/sqlite-core";

import type { DocsAgentDatabase } from "./client.ts";
import { schema } from "./schema.ts";

export const DOCS_AGENT_SCHEMA_MIGRATION_COUNT = 19;
export const DOCS_AGENT_SCHEMA_LATEST_MIGRATION_AT = 1783984962093;

const tableConfigs = Object.values(schema).map((table) =>
  getTableConfig(table as AnySQLiteTable),
);
const expectedTables = tableConfigs.map(({ name }) => name);
const expectedIndexes = tableConfigs.flatMap(({ indexes }) =>
  indexes.map((index) => index.config.name),
);

export class DatabaseSchemaNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseSchemaNotReadyError";
  }
}

export async function assertDocsAgentDatabaseReady(
  db: DocsAgentDatabase,
): Promise<void> {
  let migrationRows: Array<{ hash: string; createdAt: string | number }>;
  let databaseObjects: Array<{ type: "table" | "index"; name: string }>;

  try {
    migrationRows = await db.all<{ hash: string; createdAt: string | number }>(sql`
      SELECT hash, created_at AS createdAt
      FROM __drizzle_migrations
      ORDER BY created_at
    `);
    databaseObjects = await db.all<{ type: "table" | "index"; name: string }>(sql`
      SELECT type, name
      FROM sqlite_master
      WHERE type IN ('table', 'index')
        AND name NOT LIKE 'sqlite_%'
    `);
  } catch (error) {
    throw notReady(
      `Migration metadata or schema objects could not be read: ${formatUnknownError(error)}`,
    );
  }

  const latestMigrationAt = Number(migrationRows.at(-1)?.createdAt ?? 0);
  if (
    migrationRows.length !== DOCS_AGENT_SCHEMA_MIGRATION_COUNT ||
    latestMigrationAt !== DOCS_AGENT_SCHEMA_LATEST_MIGRATION_AT
  ) {
    throw notReady(
      `Expected ${DOCS_AGENT_SCHEMA_MIGRATION_COUNT} migrations through ${DOCS_AGENT_SCHEMA_LATEST_MIGRATION_AT}, found ${migrationRows.length} through ${latestMigrationAt}.`,
    );
  }

  const tableNames = new Set(
    databaseObjects.filter(({ type }) => type === "table").map(({ name }) => name),
  );
  const indexNames = new Set(
    databaseObjects.filter(({ type }) => type === "index").map(({ name }) => name),
  );
  const missingTables = expectedTables.filter((name) => !tableNames.has(name));
  const missingIndexes = expectedIndexes.filter((name) => !indexNames.has(name));

  if (missingTables.length > 0 || missingIndexes.length > 0) {
    throw notReady(
      [
        missingTables.length > 0 ? `missing tables: ${missingTables.join(", ")}` : "",
        missingIndexes.length > 0 ? `missing indexes: ${missingIndexes.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
}

function notReady(reason: string): DatabaseSchemaNotReadyError {
  return new DatabaseSchemaNotReadyError(
    `Paige database schema is not ready. Run pnpm db:migrate before starting the agent. ${reason}`,
  );
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
