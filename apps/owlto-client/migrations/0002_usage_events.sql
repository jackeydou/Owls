CREATE TABLE `usage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`agent` text NOT NULL,
	`role` text NOT NULL,
	`model` text,
	`project_id` text,
	`input` integer NOT NULL,
	`output` integer NOT NULL,
	`cache_read` integer NOT NULL,
	`cache_write` integer NOT NULL,
	`reasoning` integer NOT NULL,
	`cost_usd` real
);
--> statement-breakpoint
CREATE INDEX `usage_events_at` ON `usage_events` (`at`);