CREATE TABLE IF NOT EXISTS `agent_repository_configuration` (
	`id` integer PRIMARY KEY NOT NULL,
	`configuration` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "agent_repository_configuration_singleton" CHECK("agent_repository_configuration"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agent_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`source` text,
	`title` text,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_sessions_updated_at_idx` ON `agent_sessions` (`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `slack_chat_cache` (
	`state_key` text PRIMARY KEY NOT NULL,
	`state_value` text NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `slack_chat_locks` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `slack_chat_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`entry` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `slack_chat_queue_thread_id_idx` ON `slack_chat_queue` (`thread_id`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `slack_chat_subscriptions` (
	`thread_id` text PRIMARY KEY NOT NULL
);
