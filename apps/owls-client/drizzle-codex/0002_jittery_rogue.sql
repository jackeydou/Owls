CREATE TABLE `codex_inbox_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`router_id` text NOT NULL,
	`status` text NOT NULL,
	`batch_id` text,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codex_inbox_events_id_unique` ON `codex_inbox_events` (`id`);--> statement-breakpoint
CREATE INDEX `codex_inbox_events_router_status` ON `codex_inbox_events` (`router_id`,`status`);--> statement-breakpoint
CREATE TABLE `codex_router_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`router_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `codex_router_batches_router_status` ON `codex_router_batches` (`router_id`,`status`);