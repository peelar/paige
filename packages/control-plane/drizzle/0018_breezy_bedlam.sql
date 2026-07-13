CREATE TABLE `watch_observation_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`watch_id` text NOT NULL,
	`effective_revision_id` text NOT NULL,
	`provider` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`failure_code` text,
	`claimed_at` text NOT NULL,
	`failed_at` text,
	`completed_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`effective_revision_id`) REFERENCES `watch_effective_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_observation_claims_occurrence_idx` ON `watch_observation_claims` (`workspace_id`,`effective_revision_id`,`provider`,`resource_type`,`resource_id`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `watch_observation_claims_status_idx` ON `watch_observation_claims` (`workspace_id`,`status`,`updated_at`);