CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`rev` integer NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `boards_rev` ON `boards` (`rev`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`rev` integer NOT NULL,
	`project_id` text,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cards_rev` ON `cards` (`rev`);--> statement-breakpoint
CREATE INDEX `cards_status` ON `cards` (`status`);