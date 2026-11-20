ALTER TABLE `remote_peers` ADD `queue_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `remote_peers` ADD `push_token` text;--> statement-breakpoint
ALTER TABLE `remote_peers` ADD `push_key` text;--> statement-breakpoint
ALTER TABLE `remote_peers` ADD `push_sandbox` integer DEFAULT false NOT NULL;