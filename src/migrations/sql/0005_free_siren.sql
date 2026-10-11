DROP INDEX `clients_user_id_device_id_idx`;--> statement-breakpoint
DROP INDEX `clients_push_platform_idx`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `device_id`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `device_type`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `push_token`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `push_platform`;--> statement-breakpoint
ALTER TABLE `clients` DROP COLUMN `push_token_updated_at`;