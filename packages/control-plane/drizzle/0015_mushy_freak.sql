CREATE TABLE `watch_effective_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`watch_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`proposal_revision_id` text NOT NULL,
	`contract_version` integer NOT NULL,
	`policy` text NOT NULL,
	`approval_key` text NOT NULL,
	`approved_by_id` text NOT NULL,
	`approved_by_login` text NOT NULL,
	`approved_at` text NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposal_revision_id`) REFERENCES `watch_policy_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_effective_revisions_proposal_idx` ON `watch_effective_revisions` (`workspace_id`,`watch_id`,`proposal_revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `watch_effective_revisions_approval_key_idx` ON `watch_effective_revisions` (`workspace_id`,`watch_id`,`approval_key`);--> statement-breakpoint
ALTER TABLE `policy_bound_watches` ADD `effective_revision_id` text;