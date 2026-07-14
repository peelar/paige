CREATE TABLE `internal_document_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`relationship` text NOT NULL,
	`operation_key` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`session_id` text NOT NULL,
	`run_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `internal_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_document_attachments_relationship_idx` ON `internal_document_attachments` (`workspace_id`,`resource_type`,`resource_id`,`relationship`);--> statement-breakpoint
CREATE UNIQUE INDEX `internal_document_attachments_operation_idx` ON `internal_document_attachments` (`workspace_id`,`operation_key`);--> statement-breakpoint
CREATE INDEX `internal_document_attachments_document_idx` ON `internal_document_attachments` (`workspace_id`,`document_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `internal_document_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_key` text NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`content` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`session_id` text NOT NULL,
	`run_id` text NOT NULL,
	`source_references` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `internal_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_document_revisions_revision_idx` ON `internal_document_revisions` (`workspace_id`,`document_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `internal_document_revisions_operation_idx` ON `internal_document_revisions` (`workspace_id`,`document_id`,`operation_key`);--> statement-breakpoint
CREATE INDEX `internal_document_revisions_created_idx` ON `internal_document_revisions` (`workspace_id`,`document_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `internal_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`editing_profile` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	`current_revision` integer NOT NULL,
	`creation_operation_key` text NOT NULL,
	`retention_expires_at` text NOT NULL,
	`archived_at` text,
	`expired_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_documents_creation_operation_idx` ON `internal_documents` (`workspace_id`,`creation_operation_key`);--> statement-breakpoint
CREATE INDEX `internal_documents_lifecycle_idx` ON `internal_documents` (`workspace_id`,`lifecycle_state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `internal_documents_retention_idx` ON `internal_documents` (`workspace_id`,`retention_expires_at`);