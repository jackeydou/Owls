CREATE TABLE `codex_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`input_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `codex_credentials` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`secret` text NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE `codex_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `codex_router_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`router_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `codex_router_batches_router_status` ON `codex_router_batches` (`router_id`,`status`);--> statement-breakpoint
CREATE TABLE `codex_router_messages` (
	`router_id` text NOT NULL,
	`seq` integer NOT NULL,
	`batch_id` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`router_id`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `codex_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `codex_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `codex_sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`rev` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `codex_thread_items` (
	`thread_id` text NOT NULL,
	`item_id` text NOT NULL,
	`position` integer NOT NULL,
	`rev` integer NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`thread_id`, `item_id`)
);
--> statement-breakpoint
CREATE INDEX `codex_thread_items_position` ON `codex_thread_items` (`thread_id`,`position`);--> statement-breakpoint
CREATE INDEX `codex_thread_items_rev` ON `codex_thread_items` (`thread_id`,`rev`);--> statement-breakpoint
CREATE TABLE `codex_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`rev` integer NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `codex_threads_rev` ON `codex_threads` (`rev`);--> statement-breakpoint
CREATE TABLE `codex_workers` (
	`id` text PRIMARY KEY NOT NULL,
	`router_id` text NOT NULL,
	`session_id` text NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codex_workers_session_id_unique` ON `codex_workers` (`session_id`);