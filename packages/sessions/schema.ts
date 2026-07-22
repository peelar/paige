import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { AgentSessionSource, AgentSessionStatus } from "./types.js";

export const agentSessions = sqliteTable(
  "agent_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    source: text("source").$type<AgentSessionSource>(),
    title: text("title"),
    status: text("status").$type<AgentSessionStatus>().notNull(),
    startedAt: text("started_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("agent_sessions_updated_at_idx").on(table.updatedAt),
  ],
);
