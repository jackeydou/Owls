import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { CodexProject, CodexSession, CodexSettings } from '../../shared/codex.js'
import { projectSchema, sessionSchema, settingsSchema } from '../../shared/codex.js'
import { CodexRuntimeError } from './errors.js'
import { codexCommands, codexProjects, codexSessions, codexSettings } from './schema.js'

export class CodexStore {
  private readonly sqlite: Database.Database
  private readonly db
  constructor(databasePath: string, migrationsFolder: string) {
    this.sqlite = new Database(databasePath)
    this.sqlite.pragma('journal_mode = WAL')
    this.db = drizzle(this.sqlite)
    migrate(this.db, { migrationsFolder })
  }
  settings(): CodexSettings {
    const row = this.db.select().from(codexSettings).get()
    return row
      ? settingsSchema.parse(row.value)
      : {
          executablePath: null,
          model: null,
          effort: null,
          permission: 'workspace-write',
          theme: 'system',
          language: 'en',
          provider: 'codex',
          claudeExecutablePath: null,
          claudeModel: null,
          claudeEffort: null
        }
  }
  saveSettings(value: CodexSettings): CodexSettings {
    const settings = settingsSchema.parse(value)
    this.db
      .insert(codexSettings)
      .values({ id: 'settings', value: settings })
      .onConflictDoUpdate({ target: codexSettings.id, set: { value: settings } })
      .run()
    return settings
  }
  sessions(): CodexSession[] {
    return this.db
      .select()
      .from(codexSessions)
      .orderBy(desc(codexSessions.updatedAt))
      .all()
      .map((row) => sessionSchema.parse(row.value))
  }
  saveSession(value: CodexSession): void {
    const session = sessionSchema.parse(value)
    this.db
      .insert(codexSessions)
      .values({ id: session.id, updatedAt: session.updatedAt, value: session })
      .onConflictDoUpdate({
        target: codexSessions.id,
        set: { updatedAt: session.updatedAt, value: session }
      })
      .run()
  }
  removeSession(id: string): void {
    this.db.transaction((tx) => {
      tx.delete(codexCommands).where(eq(codexCommands.sessionId, id)).run()
      tx.delete(codexSessions).where(eq(codexSessions.id, id)).run()
    })
  }
  projects(): CodexProject[] {
    return this.db
      .select()
      .from(codexProjects)
      .all()
      .map((row) => projectSchema.parse(row.value))
      .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
  }
  saveProject(project: CodexProject): void {
    this.db
      .insert(codexProjects)
      .values({ id: project.id, value: project })
      .onConflictDoUpdate({ target: codexProjects.id, set: { value: project } })
      .run()
  }
  acceptCommand(id: string, sessionId: string, text: string): boolean {
    const inputHash = createHash('sha256').update(sessionId).update('\0').update(text).digest('hex')
    const existing = this.db.select().from(codexCommands).where(eq(codexCommands.id, id)).get()
    if (existing) {
      if (existing.inputHash !== inputHash)
        throw new CodexRuntimeError(
          'invalid_request',
          'Command ID was already used for a different message.'
        )
      return false
    }
    this.db.insert(codexCommands).values({ id, sessionId, inputHash }).run()
    return true
  }
  close(): void {
    this.sqlite.close()
  }
}
