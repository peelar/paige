CREATE TABLE `capability_resolution_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`context_class` text NOT NULL,
	`status` text NOT NULL,
	`capability_families` text NOT NULL,
	`tool_names` text NOT NULL,
	`reason_codes` text NOT NULL,
	`reservation_id` text,
	`watch_id` text,
	`effective_revision_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `capability_resolution_events_session_idx` ON `capability_resolution_events` (`workspace_id`,`session_id`,`created_at`);
