ALTER TABLE `clients` ADD `platform` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `device_uid` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `device_token` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `token_updated_at` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `token_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `app_version` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `device_model` text;--> statement-breakpoint
CREATE TABLE `push_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`platform` text NOT NULL,
	`client_id` integer,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);--> statement-breakpoint
CREATE UNIQUE INDEX `clients_user_id_device_uid_unique` ON `clients` (`user_id`,`device_uid`);--> statement-breakpoint
CREATE INDEX `push_outbox_status_next_retry_idx` ON `push_outbox` (`status`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `push_outbox_user_platform_status_idx` ON `push_outbox` (`user_id`,`platform`,`status`);
