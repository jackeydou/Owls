CREATE TABLE `codex_credentials` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`secret` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `codex_router_messages` (
	`router_id` text NOT NULL,
	`seq` integer NOT NULL,
	`batch_id` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`router_id`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `codex_routers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codex_routers_project_id_unique` ON `codex_routers` (`project_id`);--> statement-breakpoint
CREATE TABLE `codex_workers` (
	`id` text PRIMARY KEY NOT NULL,
	`router_id` text NOT NULL,
	`session_id` text NOT NULL,
	`updated_at` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codex_workers_session_id_unique` ON `codex_workers` (`session_id`);