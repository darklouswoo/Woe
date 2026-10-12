ALTER TABLE `users` ADD `nickname` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `users` ADD `email` text NOT NULL DEFAULT 'needupdate@example.com';--> statement-breakpoint
ALTER TABLE `users` ADD `avatar` text;--> statement-breakpoint
ALTER TABLE `users` ADD `description` text;--> statement-breakpoint

--> statement-breakpoint
UPDATE `users` SET `nickname` = `name` WHERE `nickname` = '';
