import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type {
  CodexItem,
  CodexProject,
  CodexRouter,
  CodexSession,
  CodexSettings
} from '../../shared/codex.js'
import type { Memory, MemoryCategory, MemoryRun } from '../../shared/memory.js'
import type { RouterWorker } from '../../shared/router.js'

export const codexSettings = sqliteTable('codex_settings', {
  id: text('id').primaryKey(),
  value: text('value', { mode: 'json' }).$type<CodexSettings>().notNull()
})
/**
 * The device that writes a record (RFC_OWLS_MULTI_DEVICE 4). Rows from before
 * device ids existed get this device's id on the first start that has one.
 */
const ownerDeviceId = () => text('owner_device_id')
export const codexProjects = sqliteTable('codex_projects', {
  id: text('id').primaryKey(),
  ownerDeviceId: ownerDeviceId(),
  value: text('value', { mode: 'json' }).$type<CodexProject>().notNull()
})
export const codexSessions = sqliteTable('codex_sessions', {
  id: text('id').primaryKey(),
  ownerDeviceId: ownerDeviceId(),
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
/** This device's identity: one row, created on the first start (RFC_OWLS_MULTI_DEVICE 7). */
export const codexLocalDevice = sqliteTable('codex_local_device', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull(),
  createdAt: text('created_at').notNull()
})
/**
 * Local records changed since the sync service last acknowledged them. One row
 * per record: a new change moves the record to the next `device_seq`, so the log
 * stays as large as the set of records however often they change.
 */
export const codexSyncLog = sqliteTable(
  'codex_sync_log',
  {
    kind: text('kind').notNull(),
    recordId: text('record_id').notNull(),
    deviceSeq: integer('device_seq').notNull(),
    acked: integer('acked', { mode: 'boolean' }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.recordId] }),
    uniqueIndex('codex_sync_log_seq').on(table.deviceSeq)
  ]
)
/** Threads: global Router conversations, without their items. */
export const codexThreads = sqliteTable(
  'codex_threads',
  {
    id: text('id').primaryKey(),
    rev: integer('rev').notNull(),
    /** Mirrors `value.deviceId`. */
    ownerDeviceId: ownerDeviceId(),
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
  ownerDeviceId: ownerDeviceId(),
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
/**
 * Personal memory categories. Deleted ones stay as tombstones so the deletion
 * keeps its `rev` and a late write can follow `mergedInto`.
 */
export const codexMemoryCategories = sqliteTable(
  'codex_memory_categories',
  {
    id: text('id').primaryKey(),
    rev: integer('rev').notNull(),
    updatedAt: text('updated_at').notNull(),
    value: text('value', { mode: 'json' }).$type<MemoryCategory>().notNull()
  },
  (table) => [index('codex_memory_categories_rev').on(table.rev)]
)
/** Memories of both stores. A deleted memory is a tombstone with its text cleared. */
export const codexMemories = sqliteTable(
  'codex_memories',
  {
    id: text('id').primaryKey(),
    rev: integer('rev').notNull(),
    store: text('store').notNull(),
    projectId: text('project_id'),
    categoryId: text('category_id'),
    kind: text('kind'),
    status: text('status').notNull(),
    updatedAt: text('updated_at').notNull(),
    value: text('value', { mode: 'json' }).$type<Memory>().notNull()
  },
  (table) => [
    index('codex_memories_rev').on(table.rev),
    index('codex_memories_scope').on(table.store, table.status)
  ]
)
/** How far Dreaming has read each thread: its item `rev` and its Inbox event `seq`. */
export const codexMemoryCursors = sqliteTable('codex_memory_cursors', {
  threadId: text('thread_id').primaryKey(),
  itemRev: integer('item_rev').notNull(),
  eventSeq: integer('event_seq').notNull(),
  updatedAt: text('updated_at').notNull()
})
/** Dreaming runs, newest last by `created_at`. */
export const codexMemoryRuns = sqliteTable(
  'codex_memory_runs',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    value: text('value', { mode: 'json' }).$type<MemoryRun>().notNull()
  },
  (table) => [index('codex_memory_runs_created').on(table.createdAt)]
)
