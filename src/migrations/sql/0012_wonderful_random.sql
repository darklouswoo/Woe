ALTER TABLE `clients` ADD `expires_after_inactivity_seconds` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `expires_at` text;--> statement-breakpoint
CREATE INDEX `clients_expires_at_idx` ON `clients` (`expires_at`);