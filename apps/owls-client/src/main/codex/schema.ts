import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type {
  CodexItem,
  CodexProject,
  CodexRouter,
  CodexSession,
  CodexSettings
} from '../../shared/codex.js'
import type { RouterWorker } from '../../shared/router.js'

export const codexSettings = sqliteTable('codex_settings', {
  id: text('id').primaryKey(),
  value: text('value', { mode: 'json' }).$type<CodexSettings>().notNull()
})
export const codexProjects = sqliteTable('codex_projects', {
  id: text('id').primaryKey(),
  value: text('value', { mode: 'json' }).$type<CodexProject>().notNull()
})
export const codexSessions = sqliteTable('codex_sessions', {
  id: text('id').primaryKey(),
  updatedAt: text('updated_at').notNull(),
  value: text('value', { mode: 'json' }).$type<CodexSession>().notNull()
})
export const codexCommands = sqliteTable('codex_commands', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  inputHash: text('input_hash').notNull()
})
/**
 * One row holding the change version. Every saved thread and item takes the next
 * value, so a reader can ask for everything after the version it last saw.
 */
export const codexSyncState = sqliteTable('codex_sync_state', {
  id: text('id').primaryKey(),
  rev: integer('rev').notNull()
})
/** Threads: global Router conversations, without their items. */
export const codexThreads = sqliteTable(
  'codex_threads',
  {
    id: text('id').primaryKey(),
    rev: integer('rev').notNull(),
    updatedAt: text('updated_at').notNull(),
    value: text('value', { mode: 'json' }).$type<CodexRouter>().notNull()
  },
  (table) => [index('codex_threads_rev').on(table.rev)]
)
/** Thread items, written one at a time so a change never rewrites the conversation. */
export const codexThreadItems = sqliteTable(
  'codex_thread_items',
  {
    threadId: text('thread_id').notNull(),
    itemId: text('item_id').notNull(),
    position: integer('position').notNull(),
    rev: integer('rev').notNull(),
    value: text('value', { mode: 'json' }).$type<CodexItem>().notNull()
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.itemId] }),
    index('codex_thread_items_position').on(table.threadId, table.position),
    index('codex_thread_items_rev').on(table.threadId, table.rev)
  ]
)
export const codexWorkers = sqliteTable('codex_workers', {
  id: text('id').primaryKey(),
  routerId: text('router_id').notNull(),
  sessionId: text('session_id').notNull().unique(),
  updatedAt: text('updated_at').notNull(),
  value: text('value', { mode: 'json' }).$type<RouterWorker>().notNull()
})
/** The Owls engine's model transcript, one pi AgentMessage per row in order. */
export const codexRouterMessages = sqliteTable(
  'codex_router_messages',
  {
    routerId: text('router_id').notNull(),
    seq: integer('seq').notNull(),
    batchId: text('batch_id').notNull(),
    value: text('value', { mode: 'json' }).$type<unknown>().notNull()
  },
  (table) => [primaryKey({ columns: [table.routerId, table.seq] })]
)
/** Router model API keys, encrypted with Electron safeStorage before they reach this table. */
export const codexCredentials = sqliteTable('codex_credentials', {
  providerId: text('provider_id').primaryKey(),
  type: text('type').notNull(),
  secret: text('secret').notNull()
})
/** Router Inbox events. `seq` is the global delivery order; `value` holds the event body. */
export const codexInboxEvents = sqliteTable(
  'codex_inbox_events',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    routerId: text('router_id').notNull(),
    status: text('status').notNull(),
    batchId: text('batch_id'),
    value: text('value', { mode: 'json' }).$type<unknown>().notNull()
  },
  (table) => [index('codex_inbox_events_router_status').on(table.routerId, table.status)]
)
/** Router batches: what was sent to the engine, and whether its delivery is known. */
export const codexRouterBatches = sqliteTable(
  'codex_router_batches',
  {
    id: text('id').primaryKey(),
    routerId: text('router_id').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    value: text('value', { mode: 'json' }).$type<unknown>().notNull()
  },
  (table) => [index('codex_router_batches_router_status').on(table.routerId, table.status)]
)
