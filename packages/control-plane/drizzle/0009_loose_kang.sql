CREATE TABLE `connector_delivery_verifications` (
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`connector_fingerprint` text NOT NULL,
	`evidence` text NOT NULL,
	`verified_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_delivery_workspace_provider_idx` ON `connector_delivery_verifications` (`workspace_id`,`provider`);