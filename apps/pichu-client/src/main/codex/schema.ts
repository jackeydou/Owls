import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { CodexProject, CodexRouter, CodexSession, CodexSettings } from '../../shared/codex.js'
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
export const codexRouters = sqliteTable('codex_routers', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().unique(),
  value: text('value', { mode: 'json' }).$type<CodexRouter>().notNull()
})
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
