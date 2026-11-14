CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`duration_ms` integer,
	`error` text,
	`requested_model_id` text,
	`requested_thinking_level` text,
	`effective_model_id` text,
	`effective_thinking_level` text,
	`effective_reason` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_runs_status_check" CHECK("agent_runs"."status" IN ('running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runs_session_started` ON `agent_runs` (`session_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`payload_json` text NOT NULL,
	`source_session_id` text,
	`source_message_id` text,
	`source_tool_call_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "artifacts_kind_check" CHECK("artifacts"."kind" IN ('streaming-ui', 'text', 'file', 'image'))
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_updated` ON `artifacts` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_source_message` ON `artifacts` (`source_session_id`,`source_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifacts_source_tool` ON `artifacts` (`source_session_id`,`source_tool_call_id`);--> statement-breakpoint
CREATE TABLE `cron_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`schedule` text NOT NULL,
	`prompt` text NOT NULL,
	`cwd` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_run_at` text,
	`last_run_status` text
);
--> statement-breakpoint
CREATE TABLE `human_input_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`run_id` text,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`interrupt_key` text NOT NULL,
	`status` text NOT NULL,
	`resolved_outcome` text,
	`request_json` text NOT NULL,
	`response_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "human_input_requests_status_check" CHECK("human_input_requests"."status" IN ('pending', 'submitted', 'cancelled', 'resolved', 'expired')),
	CONSTRAINT "human_input_requests_resolved_outcome_check" CHECK("human_input_requests"."resolved_outcome" IS NULL OR "human_input_requests"."resolved_outcome" IN ('submitted', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `idx_human_input_session_status` ON `human_input_requests` (`session_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_human_input_interrupt` ON `human_input_requests` (`session_id`,`tool_call_id`,`interrupt_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_human_input_single_unresolved_session` ON `human_input_requests` (`session_id`) WHERE "human_input_requests"."status" IN ('pending', 'submitted', 'cancelled');--> statement-breakpoint
CREATE TABLE `message_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`session_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_message_parts_message` ON `message_parts` (`message_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_message_parts_session` ON `message_parts` (`session_id`,`position`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`run_id` text,
	`role` text NOT NULL,
	`kind` text DEFAULT 'default' NOT NULL,
	`content` text NOT NULL,
	`agent_content` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'shared' NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`tool_call_id` text,
	`tool_name` text,
	`tool_call_result` text,
	`attachments_json` text,
	`model_id` text,
	`model_provider` text,
	`model_api` text,
	`model_usage_json` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "messages_role_check" CHECK("messages"."role" IN ('user', 'assistant', 'system', 'tool')),
	CONSTRAINT "messages_kind_check" CHECK("messages"."kind" IN ('default', 'steer')),
	CONSTRAINT "messages_visibility_check" CHECK("messages"."visibility" IN ('shared', 'model-only', 'ui-only'))
);
--> statement-breakpoint
CREATE INDEX `idx_messages_session` ON `messages` (`session_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_messages_session_run` ON `messages` (`session_id`,`run_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`cwd` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`session_kind` text DEFAULT 'main' NOT NULL,
	`parent_session_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`pinned` integer DEFAULT 0 NOT NULL,
	`pinned_order` integer DEFAULT 0 NOT NULL,
	`session_model_id` text,
	`session_thinking_level` text,
	`session_model_updated_at` text,
	`session_model_updated_by` text,
	`shared_session_url` text,
	`shared_session_source_updated_at` text,
	FOREIGN KEY (`parent_session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_pinned_order` ON `sessions` (`pinned`,`pinned_order`);--> statement-breakpoint
CREATE INDEX `idx_sessions_pinned_updated` ON `sessions` (`pinned`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_pinned_created` ON `sessions` (`pinned`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_archived_updated` ON `sessions` (`archived_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_parent_kind_updated` ON `sessions` (`parent_session_id`,`session_kind`,`updated_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tool_approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`run_id` text,
	`status` text NOT NULL,
	`cwd` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_use_id` text NOT NULL,
	`tool_input_json` text NOT NULL,
	`approval_mode` text NOT NULL,
	`approval_reason` text,
	`description` text NOT NULL,
	`approval_ui_json` text,
	`approval_subject_json` text,
	`parsed_command_json` text,
	`auto_review_action_json` text,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`resolved_at` text,
	`resolve_reason` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tool_approval_requests_status_check" CHECK("tool_approval_requests"."status" IN ('pending', 'allowed', 'denied', 'timeout', 'cancelled', 'unavailable')),
	CONSTRAINT "tool_approval_requests_approval_mode_check" CHECK("tool_approval_requests"."approval_mode" IN ('prompt', 'auto-review', 'deny')),
	CONSTRAINT "tool_approval_requests_source_check" CHECK("tool_approval_requests"."source" IN ('chat', 'automation'))
);
--> statement-breakpoint
CREATE INDEX `idx_tool_approval_session_status` ON `tool_approval_requests` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tool_approval_run_status` ON `tool_approval_requests` (`run_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tool_approval_created` ON `tool_approval_requests` (`created_at`);--> statement-breakpoint
CREATE TABLE `tool_approval_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`scope` text NOT NULL,
	`rule_json` text NOT NULL,
	`display` text NOT NULL,
	`source_approval_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_matched_at` text,
	FOREIGN KEY (`source_approval_id`) REFERENCES `tool_approval_requests`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tool_approval_rules_kind_check" CHECK("tool_approval_rules"."kind" IN ('command_prefix')),
	CONSTRAINT "tool_approval_rules_status_check" CHECK("tool_approval_rules"."status" IN ('active', 'disabled')),
	CONSTRAINT "tool_approval_rules_scope_check" CHECK("tool_approval_rules"."scope" IN ('global'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tool_approval_rules_rule_json` ON `tool_approval_rules` (`rule_json`);--> statement-breakpoint
CREATE INDEX `idx_tool_approval_rules_kind_status` ON `tool_approval_rules` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tool_approval_rules_source_approval` ON `tool_approval_rules` (`source_approval_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE messages_fts USING fts5(
  message_id UNINDEXED,
  session_id UNINDEXED,
  role UNINDEXED,
  searchable_text,
  tokenize = 'unicode61'
);
--> statement-breakpoint
CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, message_id, session_id, role, searchable_text)
  VALUES (
    new.rowid,
    new.id,
    new.session_id,
    new.role,
    trim(
      coalesce(new.content, '') || ' ' ||
      coalesce(new.tool_name, '') || ' ' ||
      coalesce(new.tool_call_result, '')
    )
  );
END;
--> statement-breakpoint
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
  INSERT INTO messages_fts(rowid, message_id, session_id, role, searchable_text)
  VALUES (
    new.rowid,
    new.id,
    new.session_id,
    new.role,
    trim(
      coalesce(new.content, '') || ' ' ||
      coalesce(new.tool_name, '') || ' ' ||
      coalesce(new.tool_call_result, '')
    )
  );
END;
