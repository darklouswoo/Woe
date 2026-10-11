ALTER TABLE `clients` ADD `device_id` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `device_type` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `push_token` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `push_platform` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `push_token_updated_at` text;--> statement-breakpoint
CREATE INDEX `clients_user_id_device_id_idx` ON `clients` (`user_id`,`device_id`);--> statement-breakpoint
CREATE INDEX `clients_push_platform_idx` ON `clients` (`push_platform`);