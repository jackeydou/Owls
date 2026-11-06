CREATE TABLE `codex_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`input_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `codex_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
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
