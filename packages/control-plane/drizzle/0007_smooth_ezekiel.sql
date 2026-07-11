CREATE TABLE `slack_thread_presence` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`team_id` text,
	`channel_id` text NOT NULL,
	`thread_ts` text NOT NULL,
	`chat_thread_id` text NOT NULL,
	`continuation_token` text NOT NULL,
	`inviter_user_id` text NOT NULL,
	`status` text NOT NULL,
	`enrolled_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`ended_at` integer,
	`end_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_thread_presence_thread_idx` ON `slack_thread_presence` (`workspace_id`,`channel_id`,`thread_ts`);--> statement-breakpoint
CREATE UNIQUE INDEX `slack_thread_presence_chat_thread_idx` ON `slack_thread_presence` (`workspace_id`,`chat_thread_id`);--> statement-breakpoint
CREATE INDEX `slack_thread_presence_expiry_idx` ON `slack_thread_presence` (`workspace_id`,`status`,`expires_at`);