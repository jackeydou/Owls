import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { AppSettings, Project, Router, Session, SessionItem } from '../../shared/app.js'
import type { Board, Card } from '../../shared/cards.js'
import type { Memory, MemoryCategory, MemoryRun } from '../../shared/memory.js'
import type { RouterWorker } from '../../shared/router.js'

export const settingsTable = sqliteTable('settings', {
  id: text('id').primaryKey(),
  value: text('value', { mode: 'json' }).$type<AppSettings>().notNull()
})
/**
 * The device that writes a record (RFC_OWLS_MULTI_DEVICE 4). Rows from before
 * device ids existed get this device's id on the first start that has one.
 */
const ownerDeviceId = () => text('owner_device_id')
export const projectsTable = sqliteTable('projects', {
  id: text('id').primaryKey(),
  ownerDeviceId: ownerDeviceId(),
  value: text('value', { mode: 'json' }).$type<Project>().notNull()
})
export const sessionsTable = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  ownerDeviceId: ownerDeviceId(),
  updatedAt: text('updated_at').notNull(),
  value: text('value', { mode: 'json' }).$type<Session>().notNull()
})
export const commandsTable = sqliteTable('commands', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  inputHash: text('input_hash').notNull()
})
/**
 * One row holding the change version. Every saved thread and item takes the next
 * value, so a reader can ask for everything after the version it last saw.
 */
export const syncStateTable = sqliteTable('sync_state', {
  id: text('id').primaryKey(),
  rev: integer('rev').notNull()
})
/** This device's identity: one row, created on the first start (RFC_OWLS_MULTI_DEVICE 7). */
export const localDeviceTable = sqliteTable('local_device', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull(),
  createdAt: text('created_at').notNull()
})
/**
 * Local records changed since the sync service last acknowledged them. One row
 * per record: a new change moves the record to the next `device_seq`, so the log
 * stays as large as the set of records however often they change.
 */
export const syncLogTable = sqliteTable(
  'sync_log',
  {
    kind: text('kind').notNull(),
    recordId: text('record_id').notNull(),
    deviceSeq: integer('device_seq').notNull(),
    acked: integer('acked', { mode: 'boolean' }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.recordId] }),
    uniqueIndex('sync_log_seq').on(table.deviceSeq)
  ]
)
/** Threads: global Router conversations, without their items. */
export const threadsTable = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    rev: integer('rev').notNull(),
    /** Mirrors `value.deviceId`. */
    ownerDeviceId: ownerDeviceId(),
    updatedAt: text('updated_at').notNull(),
    value: text('value', { mode: 'json' }).$type<Router>().notNull()
  },
  (table) => [index('threads_rev').on(table.rev)]
)
/** Thread items, written one at a time so a change never rewrites the conversation. */
export const threadItemsTable = sqliteTable(
  'thread_items',
  {
    threadId: text('thread_id').notNull(),
    itemId: text('item_id').notNull(),
    position: integer('position').notNull(),
    rev: integer('rev').notNull(),
    value: text('value', { mode: 'json' }).$type<SessionItem>().notNull()
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.itemId] }),
    index('thread_items_position').on(table.threadId, table.position),
    index('thread_items_rev').on(table.threadId, table.rev)
  ]
)
export const workersTable = sqliteTable('workers', {
  id: text('id').primaryKey(),
  routerId: text('router_id').notNull(),
  sessionId: text('session_id').notNull().unique(),
  ownerDeviceId: ownerDeviceId(),
  updatedAt: text('updated_at').notNull(),
  value: text('value', { mode: 'json' }).$type<RouterWorker>().notNull()
})
/** The Owls engine's model transcript, one pi AgentMessage per row in order. */
export const routerMessagesTable = sqliteTable(
  'router_messages',
  {
    routerId: text('router_id').notNull(),
    seq: integer('seq').notNull(),
    batchId: text('batch_id').notNull(),
    value: text('value', { mode: 'json' }).$type<unknown>().notNull()
  },
  (table) => [primaryKey({ columns: [table.routerId, table.seq] })]
)
/** Router model API keys, encrypted with Electron safeStorage before they reach this table. */
export const credentialsTable = sqliteTable('credentials', {
  providerId: text('provider_id').primaryKey(),
  type: text('type').notNull(),
  secret: text('secret').notNull()
})
/** Router Inbox events. `seq` is the global delivery order; `value` holds the event body. */
export const inboxEventsTable = sqliteTable(
  'inbox_events',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    routerId: text('router_id').notNull(),
    status: text('status').notNull(),
    batchId: text('batch_id'),
    value: text('value', { mode: 'json' }).$type<unknown>().notNull()
  },
  (table) => [index('inbox_events_router_status').on(table.routerId, table.status)]
)
/** Router batches: what was sent to the engine, and whether its delivery is known. */
export const routerBatchesTable = sqliteTable(
  'router_batches',
  {
    id: text('id').primaryKey(),
    routerId: text('router_id').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    value: text('value', { mode: 'json' }).$type<unknown>().notNull()
  },
  (table) => [index('router_batches_router_status').on(table.routerId, table.status)]
)
/**
 * Personal memory categories. Deleted ones stay as tombstones so the deletion
 * keeps its `rev` and a late write can follow `mergedInto`.
 */
export const memoryCategoriesTable = sqliteTable(
  'memory_categories',
  {
    id: text('id').primaryKey(),
    rev: integer('rev').notNull(),
    updatedAt: text('updated_at').notNull(),
    value: text('value', { mode: 'json' }).$type<MemoryCategory>().notNull()
  },
  (table) => [index('memory_categories_rev').on(table.rev)]
)
/** Memories of both stores. A deleted memory is a tombstone with its text cleared. */
export const memoriesTable = sqliteTable(
  'memories',
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
    index('memories_rev').on(table.rev),
    index('memories_scope').on(table.store, table.status)
  ]
)
/** How far Dreaming has read each thread: its item `rev` and its Inbox event `seq`. */
export const memoryCursorsTable = sqliteTable('memory_cursors', {
  threadId: text('thread_id').primaryKey(),
  itemRev: integer('item_rev').notNull(),
  eventSeq: integer('event_seq').notNull(),
  updatedAt: text('updated_at').notNull()
})
/** Dreaming runs, newest last by `created_at`. */
export const memoryRunsTable = sqliteTable(
  'memory_runs',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    value: text('value', { mode: 'json' }).$type<MemoryRun>().notNull()
  },
  (table) => [index('memory_runs_created').on(table.createdAt)]
)
/** Knowledge cards. A deleted card is a tombstone with its text cleared. */
export const cardsTable = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    rev: integer('rev').notNull(),
    projectId: text('project_id'),
    status: text('status').notNull(),
    updatedAt: text('updated_at').notNull(),
    value: text('value', { mode: 'json' }).$type<Card>().notNull()
  },
  (table) => [index('cards_rev').on(table.rev), index('cards_status').on(table.status)]
)
/** Card whiteboards, each holding where its cards sit. */
export const boardsTable = sqliteTable(
  'boards',
  {
    id: text('id').primaryKey(),
    rev: integer('rev').notNull(),
    status: text('status').notNull(),
    updatedAt: text('updated_at').notNull(),
    value: text('value', { mode: 'json' }).$type<Board>().notNull()
  },
  (table) => [index('boards_rev').on(table.rev)]
)
