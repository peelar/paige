import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { docsAgentMigrationsFolder } from "./migrations.js";
import * as dbSchema from "./schema.js";
import { assertDocsAgentDatabaseReady } from "./schema-readiness.js";

export const DOCS_AGENT_DATABASE_URL_ENV = "DOCS_AGENT_DATABASE_URL";
export const DOCS_AGENT_DATABASE_AUTH_TOKEN_ENV = "DOCS_AGENT_DATABASE_AUTH_TOKEN";
export const DEFAULT_LOCAL_DATABASE_URL = "file:../../.docs-agent/docs-agent.sqlite";

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
    await migrate(connection.db, {
      migrationsFolder: docsAgentMigrationsFolder(),
    });
    await assertDocsAgentDatabaseReady(connection.db);
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
      await assertDocsAgentDatabaseReady(connection.db);
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

function isDeployedRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.VERCEL === "1" || env.NODE_ENV === "production";
}

function resolveLocalFilePath(url: string): string | undefined {
  if (!url.startsWith("file:")) return undefined;

  if (url === "file::memory:") return undefined;

  const rawPath = url.slice("file:".length);
  if (rawPath === "" || rawPath === ":memory:") return undefined;

  if (!isAbsolute(rawPath) && !rawPath.startsWith("//")) {
    return resolve(process.cwd(), rawPath);
  }

  return fileURLToPath(url);
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
