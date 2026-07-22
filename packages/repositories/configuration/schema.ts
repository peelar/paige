import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { RepositoryConfigurationData } from "./types.js";

export const repositoryConfiguration = sqliteTable(
  "agent_repository_configuration",
  {
    id: integer("id").primaryKey(),
    configuration: text("configuration", { mode: "json" })
      .$type<RepositoryConfigurationData>()
      .notNull(),
    revision: integer("revision").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("agent_repository_configuration_singleton", sql`${table.id} = 1`),
  ],
);
