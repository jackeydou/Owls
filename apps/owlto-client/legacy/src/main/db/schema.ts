import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const sessions = sqliteTable(
  'sessions',
  {
    sessionId: text('session_id').primaryKey(),
    agentId: text('agent_id').notNull(),
    cwd: text('cwd').notNull(),
    title: text('title').notNull().default(''),
    sessionKind: text('session_kind', { enum: ['main', 'side'] })
      .notNull()
      .default('main'),
    parentSessionId: text('parent_session_id').references(
      (): AnySQLiteColumn => sessions.sessionId,
      {
        onDelete: 'cascade'
      }
    ),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),
    pinned: integer('pinned').notNull().default(0),
    pinnedOrder: integer('pinned_order').notNull().default(0),
    sessionModelId: text('session_model_id'),
    sessionThinkingLevel: text('session_thinking_level', {
      enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
    }),
    sessionModelUpdatedAt: text('session_model_updated_at'),
    sessionModelUpdatedBy: text('session_model_updated_by', {
      enum: ['default', 'user', 'migration']
    }),
    sharedSessionUrl: text('shared_session_url'),
    sharedSessionSourceUpdatedAt: text('shared_session_source_updated_at')
  },
  (table) => [
    index('idx_sessions_pinned_order').on(table.pinned, table.pinnedOrder),
    index('idx_sessions_pinned_updated').on(table.pinned, table.updatedAt),
    index('idx_sessions_pinned_created').on(table.pinned, table.createdAt),
    index('idx_sessions_archived_updated').on(table.archivedAt, table.updatedAt),
    index('idx_sessions_parent_kind_updated').on(
      table.parentSessionId,
      table.sessionKind,
      table.updatedAt
    )
  ]
)

export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    status: text('status', { enum: ['running', 'completed', 'failed', 'cancelled'] }).notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    requestedModelId: text('requested_model_id'),
    requestedThinkingLevel: text('requested_thinking_level', {
      enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
    }),
    effectiveModelId: text('effective_model_id'),
    effectiveThinkingLevel: text('effective_thinking_level', {
      enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
    }),
    effectiveReason: text('effective_reason', {
      enum: ['normal', 'image-fallback', 'retry', 'compaction']
    })
  },
  (table) => [
    check(
      'agent_runs_status_check',
      sql`${table.status} IN ('running', 'completed', 'failed', 'cancelled')`
    ),
    index('idx_agent_runs_session_started').on(table.sessionId, table.startedAt)
  ]
)

export const toolApprovalRequests = sqliteTable(
  'tool_approval_requests',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    runId: text('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    status: text('status', {
      enum: ['pending', 'allowed', 'denied', 'timeout', 'cancelled', 'unavailable']
    }).notNull(),
    cwd: text('cwd').notNull(),
    toolName: text('tool_name').notNull(),
    toolUseId: text('tool_use_id').notNull(),
    toolInputJson: text('tool_input_json').notNull(),
    approvalMode: text('approval_mode', { enum: ['prompt', 'auto-review', 'deny'] }).notNull(),
    approvalReason: text('approval_reason'),
    description: text('description').notNull(),
    approvalUiJson: text('approval_ui_json'),
    approvalSubjectJson: text('approval_subject_json'),
    parsedCommandJson: text('parsed_command_json'),
    autoReviewActionJson: text('auto_review_action_json'),
    source: text('source', { enum: ['chat', 'automation'] }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    resolvedAt: text('resolved_at'),
    resolveReason: text('resolve_reason')
  },
  (table) => [
    check(
      'tool_approval_requests_status_check',
      sql`${table.status} IN ('pending', 'allowed', 'denied', 'timeout', 'cancelled', 'unavailable')`
    ),
    check(
      'tool_approval_requests_approval_mode_check',
      sql`${table.approvalMode} IN ('prompt', 'auto-review', 'deny')`
    ),
    check('tool_approval_requests_source_check', sql`${table.source} IN ('chat', 'automation')`),
    index('idx_tool_approval_session_status').on(table.sessionId, table.status),
    index('idx_tool_approval_run_status').on(table.runId, table.status),
    index('idx_tool_approval_created').on(table.createdAt)
  ]
)

export const toolApprovalRules = sqliteTable(
  'tool_approval_rules',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['command_prefix'] }).notNull(),
    status: text('status', { enum: ['active', 'disabled'] }).notNull(),
    scope: text('scope', { enum: ['global'] }).notNull(),
    ruleJson: text('rule_json').notNull(),
    display: text('display').notNull(),
    sourceApprovalId: text('source_approval_id').references(() => toolApprovalRequests.id, {
      onDelete: 'set null'
    }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastMatchedAt: text('last_matched_at')
  },
  (table) => [
    check('tool_approval_rules_kind_check', sql`${table.kind} IN ('command_prefix')`),
    check('tool_approval_rules_status_check', sql`${table.status} IN ('active', 'disabled')`),
    check('tool_approval_rules_scope_check', sql`${table.scope} IN ('global')`),
    uniqueIndex('idx_tool_approval_rules_rule_json').on(table.ruleJson),
    index('idx_tool_approval_rules_kind_status').on(table.kind, table.status),
    index('idx_tool_approval_rules_source_approval').on(table.sourceApprovalId)
  ]
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    runId: text('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
    kind: text('kind', { enum: ['default', 'steer'] })
      .notNull()
      .default('default'),
    content: text('content').notNull(),
    agentContent: text('agent_content').notNull().default(''),
    visibility: text('visibility', {
      enum: ['shared', 'model-only', 'ui-only']
    })
      .notNull()
      .default('shared'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: text('created_at').notNull(),
    toolCallId: text('tool_call_id'),
    toolName: text('tool_name'),
    toolCallResult: text('tool_call_result'),
    attachmentsJson: text('attachments_json'),
    modelId: text('model_id'),
    modelProvider: text('model_provider'),
    modelApi: text('model_api'),
    modelUsageJson: text('model_usage_json')
  },
  (table) => [
    check('messages_role_check', sql`${table.role} IN ('user', 'assistant', 'system', 'tool')`),
    check('messages_kind_check', sql`${table.kind} IN ('default', 'steer')`),
    check(
      'messages_visibility_check',
      sql`${table.visibility} IN ('shared', 'model-only', 'ui-only')`
    ),
    index('idx_messages_session').on(table.sessionId, table.sortOrder),
    index('idx_messages_session_run').on(table.sessionId, table.runId)
  ]
)

export const usageDailyStats = sqliteTable('usage_daily_stats', {
  date: text('date').primaryKey(),
  tokenCount: integer('token_count').notNull().default(0),
  messageCount: integer('message_count').notNull().default(0)
})

export const usageModelStats = sqliteTable('usage_model_stats', {
  modelId: text('model_id').primaryKey(),
  tokenCount: integer('token_count').notNull().default(0)
})

export const messageParts = sqliteTable(
  'message_parts',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: text('type').notNull(),
    dataJson: text('data_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    index('idx_message_parts_message').on(table.messageId, table.position),
    index('idx_message_parts_session').on(table.sessionId, table.position)
  ]
)

export const humanInputRequests = sqliteTable(
  'human_input_requests',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    runId: text('run_id'),
    toolCallId: text('tool_call_id').notNull(),
    toolName: text('tool_name').notNull(),
    interruptKey: text('interrupt_key').notNull(),
    status: text('status', {
      enum: ['pending', 'submitted', 'cancelled', 'resolved', 'expired']
    }).notNull(),
    resolvedOutcome: text('resolved_outcome', {
      enum: ['submitted', 'cancelled']
    }),
    requestJson: text('request_json').notNull(),
    responseJson: text('response_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    check(
      'human_input_requests_status_check',
      sql`${table.status} IN ('pending', 'submitted', 'cancelled', 'resolved', 'expired')`
    ),
    check(
      'human_input_requests_resolved_outcome_check',
      sql`${table.resolvedOutcome} IS NULL OR ${table.resolvedOutcome} IN ('submitted', 'cancelled')`
    ),
    index('idx_human_input_session_status').on(table.sessionId, table.status),
    uniqueIndex('idx_human_input_interrupt').on(
      table.sessionId,
      table.toolCallId,
      table.interruptKey
    ),
    uniqueIndex('idx_human_input_single_unresolved_session')
      .on(table.sessionId)
      .where(sql`${table.status} IN ('pending', 'submitted', 'cancelled')`)
  ]
)

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['streaming-ui', 'text', 'file', 'image'] }).notNull(),
    title: text('title').notNull(),
    payloadJson: text('payload_json').notNull(),
    sourceSessionId: text('source_session_id').references(() => sessions.sessionId, {
      onDelete: 'set null'
    }),
    sourceMessageId: text('source_message_id').references(() => messages.id, {
      onDelete: 'set null'
    }),
    sourceToolCallId: text('source_tool_call_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    check('artifacts_kind_check', sql`${table.kind} IN ('streaming-ui', 'text', 'file', 'image')`),
    index('idx_artifacts_updated').on(table.updatedAt),
    index('idx_artifacts_source_message').on(table.sourceSessionId, table.sourceMessageId),
    uniqueIndex('idx_artifacts_source_tool').on(table.sourceSessionId, table.sourceToolCallId)
  ]
)

export const cronJobs = sqliteTable('cron_jobs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  schedule: text('schedule').notNull(),
  prompt: text('prompt').notNull(),
  cwd: text('cwd').notNull(),
  active: integer('active').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastRunAt: text('last_run_at'),
  lastRunStatus: text('last_run_status')
})
