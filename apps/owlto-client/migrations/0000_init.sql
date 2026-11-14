CREATE TABLE `commands` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`input_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`secret` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inbox_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`router_id` text NOT NULL,
	`status` text NOT NULL,
	`batch_id` text,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_events_id_unique` ON `inbox_events` (`id`);--> statement-breakpoint
CREATE INDEX `inbox_events_router_status` ON `inbox_events` (`router_id`,`status`);--> statement-breakpoint
CREATE TABLE `local_device` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`rev` integer NOT NULL,
	`store` text NOT NULL,
	`project_id` text,
	`category_id` text,
	`kind` text,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memories_rev` ON `memories` (`rev`);--> statement-breakpoint
CREATE INDEX `memories_scope` ON `memories` (`store`,`status`);--> statement-breakpoint
CREATE TABLE `memory_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`rev` integer NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_categories_rev` ON `memory_categories` (`rev`);--> statement-breakpoint
CREATE TABLE `memory_cursors` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`item_rev` integer NOT NULL,
	`event_seq` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_runs_created` ON `memory_runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_device_id` text,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `router_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`router_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `router_batches_router_status` ON `router_batches` (`router_id`,`status`);--> statement-breakpoint
CREATE TABLE `router_messages` (
	`router_id` text NOT NULL,
	`seq` integer NOT NULL,
	`batch_id` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`router_id`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_device_id` text,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`kind` text NOT NULL,
	`record_id` text NOT NULL,
	`device_seq` integer NOT NULL,
	`acked` integer NOT NULL,
	PRIMARY KEY(`kind`, `record_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_log_seq` ON `sync_log` (`device_seq`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`rev` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_items` (
	`thread_id` text NOT NULL,
	`item_id` text NOT NULL,
	`position` integer NOT NULL,
	`rev` integer NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`thread_id`, `item_id`)
);
--> statement-breakpoint
CREATE INDEX `thread_items_position` ON `thread_items` (`thread_id`,`position`);--> statement-breakpoint
CREATE INDEX `thread_items_rev` ON `thread_items` (`thread_id`,`rev`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`rev` integer NOT NULL,
	`owner_device_id` text,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `threads_rev` ON `threads` (`rev`);--> statement-breakpoint
CREATE TABLE `workers` (
	`id` text PRIMARY KEY NOT NULL,
	`router_id` text NOT NULL,
	`session_id` text NOT NULL,
	`owner_device_id` text,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workers_session_id_unique` ON `workers` (`session_id`);