import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { RepositoryConfigurationData } from "./types";

export const repositoryConfigurations = sqliteTable(
  "repository_configurations",
  {
    workspaceId: text("workspace_id").primaryKey(),
    configuration: text("configuration", { mode: "json" })
      .$type<RepositoryConfigurationData>()
      .notNull(),
    revision: integer("revision").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);
