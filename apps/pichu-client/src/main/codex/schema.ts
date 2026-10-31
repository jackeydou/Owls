import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { CodexProject, CodexSession, CodexSettings } from '../../shared/codex.js'

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
