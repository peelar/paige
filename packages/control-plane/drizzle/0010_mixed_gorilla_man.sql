CREATE TABLE `product_run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`product_run_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`step_key` text NOT NULL,
	`label` text NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`failure_summary` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_run_id`) REFERENCES `product_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_run_steps_identity_idx` ON `product_run_steps` (`product_run_id`,`step_key`);--> statement-breakpoint
CREATE INDEX `product_run_steps_run_idx` ON `product_run_steps` (`product_run_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `product_run_trace_links` (
	`id` text PRIMARY KEY NOT NULL,
	`product_run_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`url` text,
	`availability` text NOT NULL,
	`unavailable_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_run_id`) REFERENCES `product_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_run_trace_links_kind_idx` ON `product_run_trace_links` (`product_run_id`,`kind`);--> statement-breakpoint
CREATE TABLE `product_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`operation_key` text NOT NULL,
	`run_type` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`session_id` text NOT NULL,
	`run_id` text NOT NULL,
	`signal_id` text,
	`workflow_id` text,
	`model` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`waiting_summary` text,
	`failure_summary` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`signal_id`) REFERENCES `docs_signals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_runs_operation_idx` ON `product_runs` (`workspace_id`,`operation_key`);--> statement-breakpoint
CREATE INDEX `product_runs_status_idx` ON `product_runs` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `product_runs_session_idx` ON `product_runs` (`workspace_id`,`session_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `product_runs_expiry_idx` ON `product_runs` (`workspace_id`,`expires_at`);