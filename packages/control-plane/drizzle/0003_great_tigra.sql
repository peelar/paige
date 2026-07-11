CREATE TABLE `docs_profiles` (
	`workspace_id` text NOT NULL,
	`repository_url` text NOT NULL,
	`requested_ref` text NOT NULL,
	`docs_root` text NOT NULL,
	`resolved_revision` text NOT NULL,
	`format_version` integer NOT NULL,
	`source_fingerprint` text NOT NULL,
	`profile` text NOT NULL,
	`invalidated_reason` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `docs_profiles_identity_idx` ON `docs_profiles` (`workspace_id`,`repository_url`,`requested_ref`,`docs_root`);--> statement-breakpoint
CREATE INDEX `docs_profiles_expiry_idx` ON `docs_profiles` (`workspace_id`,`expires_at`);