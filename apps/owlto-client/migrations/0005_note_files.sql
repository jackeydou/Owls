CREATE TABLE `note_files` (
	`id` text PRIMARY KEY NOT NULL,
	`rev` integer NOT NULL,
	`file` text,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`hash` text
);
--> statement-breakpoint
CREATE INDEX `note_files_rev` ON `note_files` (`rev`);--> statement-breakpoint
CREATE INDEX `note_files_status` ON `note_files` (`status`);--> statement-breakpoint
DROP TABLE `cards`;