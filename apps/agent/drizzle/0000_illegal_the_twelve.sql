CREATE TABLE `workspace_setup` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`working_repository_input` text,
	`github_writeback` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
