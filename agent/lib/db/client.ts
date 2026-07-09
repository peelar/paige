import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as dbSchema from "./schema.js";

export const DOCS_AGENT_DATABASE_URL_ENV = "DOCS_AGENT_DATABASE_URL";
export const DOCS_AGENT_DATABASE_AUTH_TOKEN_ENV = "DOCS_AGENT_DATABASE_AUTH_TOKEN";
export const DEFAULT_LOCAL_DATABASE_URL = "file:.docs-agent/docs-agent.sqlite";

const docsAgentMigrations = [
  {
    tag: "0000_illegal_the_twelve",
    createdAt: 1783631990960,
    statements: [
      `
CREATE TABLE IF NOT EXISTS \`workspace_setup\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`version\` integer NOT NULL,
  \`working_repository_input\` text,
  \`github_writeback\` text NOT NULL,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  \`updated_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
      `.trim(),
    ],
  },
  {
    tag: "0001_exotic_ikaris",
    createdAt: 1783632640235,
    statements: [
      `
CREATE TABLE IF NOT EXISTS \`docs_signals\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`workspace_id\` text NOT NULL,
  \`status\` text NOT NULL,
  \`source_kind\` text NOT NULL,
  \`dedupe_key\` text,
  \`source_summary\` text NOT NULL,
  \`extracted_claims\` text NOT NULL,
  \`likely_docs_concepts\` text NOT NULL,
  \`likely_docs_pages\` text NOT NULL,
  \`product_surfaces\` text NOT NULL,
  \`missing_evidence\` text NOT NULL,
  \`uncertainty\` text,
  \`priority\` integer DEFAULT 0 NOT NULL,
  \`next_action_at\` text,
  \`captured_at\` text NOT NULL,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  \`updated_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
      `.trim(),
      `
CREATE TABLE IF NOT EXISTS \`docs_signal_sources\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`signal_id\` text NOT NULL,
  \`workspace_id\` text NOT NULL,
  \`source_kind\` text NOT NULL,
  \`provider\` text,
  \`provider_id\` text,
  \`permalink\` text,
  \`title\` text,
  \`authors\` text NOT NULL,
  \`source_text\` text,
  \`source_created_at\` text,
  \`source_updated_at\` text,
  \`captured_at\` text NOT NULL,
  \`metadata\` text NOT NULL,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (\`signal_id\`) REFERENCES \`docs_signals\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
      `.trim(),
      `
CREATE TABLE IF NOT EXISTS \`docs_signal_links\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`signal_id\` text NOT NULL,
  \`workspace_id\` text NOT NULL,
  \`kind\` text NOT NULL,
  \`label\` text,
  \`url\` text,
  \`external_id\` text,
  \`metadata\` text NOT NULL,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (\`signal_id\`) REFERENCES \`docs_signals\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
      `.trim(),
      `
CREATE TABLE IF NOT EXISTS \`docs_signal_artifacts\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`signal_id\` text NOT NULL,
  \`workspace_id\` text NOT NULL,
  \`kind\` text NOT NULL,
  \`label\` text,
  \`url\` text,
  \`path\` text,
  \`metadata\` text NOT NULL,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (\`signal_id\`) REFERENCES \`docs_signals\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
      `.trim(),
      `
CREATE TABLE IF NOT EXISTS \`docs_signal_events\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`signal_id\` text NOT NULL,
  \`workspace_id\` text NOT NULL,
  \`event_type\` text NOT NULL,
  \`from_status\` text,
  \`to_status\` text,
  \`reason\` text NOT NULL,
  \`actor\` text NOT NULL,
  \`metadata\` text NOT NULL,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (\`signal_id\`) REFERENCES \`docs_signals\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
      `.trim(),
      "CREATE UNIQUE INDEX IF NOT EXISTS `docs_signals_workspace_dedupe_idx` ON `docs_signals` (`workspace_id`,`dedupe_key`);",
      "CREATE INDEX IF NOT EXISTS `docs_signals_workspace_status_idx` ON `docs_signals` (`workspace_id`,`status`,`updated_at`);",
      "CREATE INDEX IF NOT EXISTS `docs_signals_workspace_source_idx` ON `docs_signals` (`workspace_id`,`source_kind`,`updated_at`);",
      "CREATE INDEX IF NOT EXISTS `docs_signals_next_action_idx` ON `docs_signals` (`workspace_id`,`next_action_at`);",
      "CREATE INDEX IF NOT EXISTS `docs_signal_sources_signal_idx` ON `docs_signal_sources` (`signal_id`);",
      "CREATE INDEX IF NOT EXISTS `docs_signal_sources_provider_idx` ON `docs_signal_sources` (`workspace_id`,`provider`,`provider_id`);",
      "CREATE INDEX IF NOT EXISTS `docs_signal_sources_permalink_idx` ON `docs_signal_sources` (`workspace_id`,`permalink`);",
      "CREATE INDEX IF NOT EXISTS `docs_signal_links_signal_idx` ON `docs_signal_links` (`signal_id`);",
      "CREATE INDEX IF NOT EXISTS `docs_signal_links_kind_idx` ON `docs_signal_links` (`workspace_id`,`kind`);",
      "CREATE INDEX IF NOT EXISTS `docs_signal_artifacts_signal_idx` ON `docs_signal_artifacts` (`signal_id`);",
      "CREATE INDEX IF NOT EXISTS `docs_signal_artifacts_kind_idx` ON `docs_signal_artifacts` (`workspace_id`,`kind`);",
      "CREATE INDEX IF NOT EXISTS `docs_signal_events_signal_idx` ON `docs_signal_events` (`signal_id`,`created_at`);",
      "CREATE INDEX IF NOT EXISTS `docs_signal_events_workspace_idx` ON `docs_signal_events` (`workspace_id`,`created_at`);",
    ],
  },
  {
    tag: "0002_workspace_knowledge",
    createdAt: 1783637000000,
    statements: [
      `
CREATE TABLE IF NOT EXISTS \`workspace_knowledge_records\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`workspace_id\` text NOT NULL,
  \`kind\` text NOT NULL,
  \`status\` text NOT NULL,
  \`statement\` text NOT NULL,
  \`scope\` text,
  \`summary\` text,
  \`tags\` text NOT NULL,
  \`confidence\` text NOT NULL,
  \`fresh_until\` text,
  \`last_validated_at\` text,
  \`stale_reason\` text,
  \`proposed_by\` text NOT NULL,
  \`promoted_at\` text,
  \`retired_at\` text,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  \`updated_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
      `.trim(),
      `
CREATE TABLE IF NOT EXISTS \`workspace_knowledge_sources\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`record_id\` text NOT NULL,
  \`workspace_id\` text NOT NULL,
  \`kind\` text NOT NULL,
  \`label\` text,
  \`url\` text,
  \`external_id\` text,
  \`source_text\` text,
  \`metadata\` text NOT NULL,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (\`record_id\`) REFERENCES \`workspace_knowledge_records\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
      `.trim(),
      `
CREATE TABLE IF NOT EXISTS \`workspace_knowledge_events\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`record_id\` text NOT NULL,
  \`workspace_id\` text NOT NULL,
  \`event_type\` text NOT NULL,
  \`from_status\` text,
  \`to_status\` text,
  \`reason\` text NOT NULL,
  \`actor\` text NOT NULL,
  \`metadata\` text NOT NULL,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (\`record_id\`) REFERENCES \`workspace_knowledge_records\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
      `.trim(),
      "CREATE INDEX IF NOT EXISTS `workspace_knowledge_status_idx` ON `workspace_knowledge_records` (`workspace_id`,`status`,`updated_at`);",
      "CREATE INDEX IF NOT EXISTS `workspace_knowledge_kind_idx` ON `workspace_knowledge_records` (`workspace_id`,`kind`,`updated_at`);",
      "CREATE INDEX IF NOT EXISTS `workspace_knowledge_fresh_until_idx` ON `workspace_knowledge_records` (`workspace_id`,`fresh_until`);",
      "CREATE INDEX IF NOT EXISTS `workspace_knowledge_sources_record_idx` ON `workspace_knowledge_sources` (`record_id`);",
      "CREATE INDEX IF NOT EXISTS `workspace_knowledge_sources_kind_idx` ON `workspace_knowledge_sources` (`workspace_id`,`kind`);",
      "CREATE INDEX IF NOT EXISTS `workspace_knowledge_sources_external_idx` ON `workspace_knowledge_sources` (`workspace_id`,`kind`,`external_id`);",
      "CREATE INDEX IF NOT EXISTS `workspace_knowledge_events_record_idx` ON `workspace_knowledge_events` (`record_id`,`created_at`);",
      "CREATE INDEX IF NOT EXISTS `workspace_knowledge_events_workspace_idx` ON `workspace_knowledge_events` (`workspace_id`,`created_at`);",
    ],
  },
] as const;

export type DocsAgentDatabase = LibSQLDatabase<typeof dbSchema>;

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

type DatabaseConfig = {
  url: string;
  authToken?: string;
  localFilePath?: string;
};

export function resolveDocsAgentDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  const configuredUrl = env[DOCS_AGENT_DATABASE_URL_ENV]?.trim();
  const url = configuredUrl === "" || configuredUrl === undefined
    ? undefined
    : configuredUrl;

  if (url === undefined && isDeployedRuntime(env)) {
    throw new DatabaseConfigurationError(
      `${DOCS_AGENT_DATABASE_URL_ENV} is required for deployed Docs Agent setup persistence.`,
    );
  }

  const resolvedUrl = url ?? DEFAULT_LOCAL_DATABASE_URL;
  const authToken = env[DOCS_AGENT_DATABASE_AUTH_TOKEN_ENV]?.trim() || undefined;

  return {
    url: resolvedUrl,
    authToken,
    localFilePath: resolveLocalFilePath(resolvedUrl),
  };
}

export function docsAgentDatabaseLocation(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const config = resolveDocsAgentDatabaseConfig(env);
    return config.localFilePath === undefined
      ? DOCS_AGENT_DATABASE_URL_ENV
      : `file:${config.localFilePath}`;
  } catch {
    return DOCS_AGENT_DATABASE_URL_ENV;
  }
}

export async function migrateDocsAgentDatabase(): Promise<void> {
  const connection = await openDocsAgentDatabase();

  try {
    await applyDocsAgentMigrations(connection.db);
  } catch (error) {
    throw new Error(`Docs Agent database migration failed: ${formatUnknownError(error)}`);
  } finally {
    connection.client.close();
  }
}

export async function withDocsAgentDatabase<T>(
  fn: (db: DocsAgentDatabase) => Promise<T>,
): Promise<T> {
  const connection = await openDocsAgentDatabase();

  try {
    try {
      await applyDocsAgentMigrations(connection.db);
    } catch (error) {
      throw new Error(`Docs Agent database is unavailable: ${formatUnknownError(error)}`);
    }

    return await fn(connection.db);
  } finally {
    connection.client.close();
  }
}

async function openDocsAgentDatabase() {
  const config = resolveDocsAgentDatabaseConfig();

  if (config.localFilePath !== undefined) {
    await mkdir(dirname(config.localFilePath), { recursive: true });
  }

  const client = createClient({
    url: config.url,
    authToken: config.authToken,
  });

  return {
    client,
    db: drizzle(client, { schema: dbSchema }),
  };
}

async function applyDocsAgentMigrations(db: DocsAgentDatabase): Promise<void> {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  const dbMigrations = await db.values<[number, string, string | number]>(sql`
    SELECT id, hash, created_at
    FROM __drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const latestMigrationTime = Number(dbMigrations[0]?.[2] ?? 0);

  for (const migration of docsAgentMigrations) {
    if (latestMigrationTime >= migration.createdAt) continue;

    const migrationSql = migration.statements.join("\n--> statement-breakpoint\n");
    const hash = createHash("sha256").update(migrationSql).digest("hex");

    for (const statement of migration.statements) {
      await db.run(sql.raw(statement));
    }

    await db.run(sql`
      INSERT INTO __drizzle_migrations ("hash", "created_at")
      VALUES (${hash}, ${migration.createdAt})
    `);
  }
}

function isDeployedRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.VERCEL === "1" || env.NODE_ENV === "production";
}

function resolveLocalFilePath(url: string): string | undefined {
  if (!url.startsWith("file:")) return undefined;

  if (url === "file::memory:") return undefined;

  try {
    return fileURLToPath(url);
  } catch {
    const rawPath = url.slice("file:".length);
    if (rawPath === "" || rawPath === ":memory:") return undefined;
    return isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);
  }
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
