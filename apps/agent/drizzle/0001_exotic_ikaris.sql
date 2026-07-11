CREATE TABLE `docs_signal_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`url` text,
	`path` text,
	`metadata` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`signal_id`) REFERENCES `docs_signals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `docs_signal_artifacts_signal_idx` ON `docs_signal_artifacts` (`signal_id`);--> statement-breakpoint
CREATE INDEX `docs_signal_artifacts_kind_idx` ON `docs_signal_artifacts` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE TABLE `docs_signal_events` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`event_type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`signal_id`) REFERENCES `docs_signals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `docs_signal_events_signal_idx` ON `docs_signal_events` (`signal_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `docs_signal_events_workspace_idx` ON `docs_signal_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `docs_signal_links` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`url` text,
	`external_id` text,
	`metadata` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`signal_id`) REFERENCES `docs_signals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `docs_signal_links_signal_idx` ON `docs_signal_links` (`signal_id`);--> statement-breakpoint
CREATE INDEX `docs_signal_links_kind_idx` ON `docs_signal_links` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE TABLE `docs_signal_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`provider` text,
	`provider_id` text,
	`permalink` text,
	`title` text,
	`authors` text NOT NULL,
	`source_text` text,
	`source_created_at` text,
	`source_updated_at` text,
	`captured_at` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`signal_id`) REFERENCES `docs_signals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `docs_signal_sources_signal_idx` ON `docs_signal_sources` (`signal_id`);--> statement-breakpoint
CREATE INDEX `docs_signal_sources_provider_idx` ON `docs_signal_sources` (`workspace_id`,`provider`,`provider_id`);--> statement-breakpoint
CREATE INDEX `docs_signal_sources_permalink_idx` ON `docs_signal_sources` (`workspace_id`,`permalink`);--> statement-breakpoint
CREATE TABLE `docs_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text NOT NULL,
	`source_kind` text NOT NULL,
	`dedupe_key` text,
	`source_summary` text NOT NULL,
	`extracted_claims` text NOT NULL,
	`likely_docs_concepts` text NOT NULL,
	`likely_docs_pages` text NOT NULL,
	`product_surfaces` text NOT NULL,
	`missing_evidence` text NOT NULL,
	`uncertainty` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`next_action_at` text,
	`captured_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `docs_signals_workspace_dedupe_idx` ON `docs_signals` (`workspace_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `docs_signals_workspace_status_idx` ON `docs_signals` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `docs_signals_workspace_source_idx` ON `docs_signals` (`workspace_id`,`source_kind`,`updated_at`);--> statement-breakpoint
CREATE INDEX `docs_signals_next_action_idx` ON `docs_signals` (`workspace_id`,`next_action_at`);