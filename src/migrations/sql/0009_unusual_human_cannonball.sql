CREATE INDEX `idx_applications_user_sort_key` ON `applications` (`user_id`,`sort_key`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `clients_user_id_device_uid_unique` ON `clients` (`user_id`,`device_uid`);--> statement-breakpoint
CREATE INDEX `push_outbox_status_next_retry_idx` ON `push_outbox` (`status`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `push_outbox_user_platform_status_idx` ON `push_outbox` (`user_id`,`platform`,`status`);