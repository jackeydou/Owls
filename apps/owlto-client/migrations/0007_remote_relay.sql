ALTER TABLE `remote_identity` ADD `relay_mailbox` text;--> statement-breakpoint
ALTER TABLE `remote_identity` ADD `relay_secret` text;--> statement-breakpoint
ALTER TABLE `remote_peers` ADD `relay_url` text;--> statement-breakpoint
ALTER TABLE `remote_peers` ADD `relay_mailbox` text;--> statement-breakpoint
ALTER TABLE `remote_peers` ADD `relay_ticket` text;--> statement-breakpoint
ALTER TABLE `remote_peers` ADD `relay_ticket_hash` text;