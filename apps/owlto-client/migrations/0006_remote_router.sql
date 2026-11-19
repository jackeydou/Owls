CREATE TABLE `remote_identity` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`secret` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `remote_peers` (
	`device_id` text NOT NULL,
	`role` text NOT NULL,
	`name` text NOT NULL,
	`public_key` text NOT NULL,
	`host` text,
	`port` integer,
	`paired_at` text NOT NULL,
	`last_seen_at` text,
	PRIMARY KEY(`device_id`, `role`)
);
