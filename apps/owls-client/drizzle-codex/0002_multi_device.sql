CREATE TABLE `codex_local_device` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `codex_sync_log` (
	`kind` text NOT NULL,
	`record_id` text NOT NULL,
	`device_seq` integer NOT NULL,
	`acked` integer NOT NULL,
	PRIMARY KEY(`kind`, `record_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codex_sync_log_seq` ON `codex_sync_log` (`device_seq`);--> statement-breakpoint
ALTER TABLE `codex_projects` ADD `owner_device_id` text;--> statement-breakpoint
ALTER TABLE `codex_sessions` ADD `owner_device_id` text;--> statement-breakpoint
ALTER TABLE `codex_threads` ADD `owner_device_id` text;--> statement-breakpoint
ALTER TABLE `codex_workers` ADD `owner_device_id` text;