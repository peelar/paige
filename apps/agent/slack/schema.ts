import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const slackChatSubscriptions = sqliteTable(
  "slack_chat_subscriptions",
  {
    threadId: text("thread_id").primaryKey(),
  },
);

export const slackChatLocks = sqliteTable("slack_chat_locks", {
  threadId: text("thread_id").primaryKey(),
  token: text("token").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const slackChatCache = sqliteTable("slack_chat_cache", {
  stateKey: text("state_key").primaryKey(),
  stateValue: text("state_value").notNull(),
  expiresAt: integer("expires_at"),
});

export const slackChatQueue = sqliteTable(
  "slack_chat_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    threadId: text("thread_id").notNull(),
    entry: text("entry").notNull(),
  },
  (table) => [
    index("slack_chat_queue_thread_id_idx").on(table.threadId, table.id),
  ],
);
