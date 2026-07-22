import { fileURLToPath } from "node:url";

import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const migrationsFolder = fileURLToPath(
  new URL("../../../database/migrations", import.meta.url),
);

/** Applies the same committed migrations used by local and hosted databases. */
export async function migrateTestDatabase(client: Client): Promise<void> {
  await migrate(drizzle(client), { migrationsFolder });
}
