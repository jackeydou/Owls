CREATE TABLE `codex_memories` (
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
CREATE INDEX `codex_memories_rev` ON `codex_memories` (`rev`);--> statement-breakpoint
CREATE INDEX `codex_memories_scope` ON `codex_memories` (`store`,`status`);--> statement-breakpoint
CREATE TABLE `codex_memory_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`rev` integer NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `codex_memory_categories_rev` ON `codex_memory_categories` (`rev`);--> statement-breakpoint
CREATE TABLE `codex_memory_cursors` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`item_rev` integer NOT NULL,
	`event_seq` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `codex_memory_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `codex_memory_runs_created` ON `codex_memory_runs` (`created_at`);