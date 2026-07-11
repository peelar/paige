CREATE TABLE `chat_sdk_key_values` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `chat_sdk_list_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`sequence` integer NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_sdk_list_entries_sequence_idx` ON `chat_sdk_list_entries` (`key`,`sequence`);--> statement-breakpoint
CREATE INDEX `chat_sdk_list_entries_expiry_idx` ON `chat_sdk_list_entries` (`expires_at`);--> statement-breakpoint
CREATE TABLE `chat_sdk_locks` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_sdk_queue_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`entry` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_sdk_queue_entries_sequence_idx` ON `chat_sdk_queue_entries` (`thread_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `chat_sdk_queue_entries_expiry_idx` ON `chat_sdk_queue_entries` (`expires_at`);--> statement-breakpoint
CREATE TABLE `chat_sdk_subscriptions` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
