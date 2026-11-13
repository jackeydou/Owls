import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { AppSettings, Project, Session } from '../../shared/app.js'
import {
  defaultAppLogo,
  defaultLayoutSettings,
  projectSchema,
  sessionSchema,
  settingsSchema
} from '../../shared/app.js'
import { defaultMemorySettings } from '../../shared/memory.js'
import { defaultRouterSettings } from '../../shared/router.js'
import { loadDeviceIdentity } from '../sync/device-identity.js'
import { logChange } from '../sync/sync-log.js'
import { OwlsError } from './errors.js'
import { commandsTable, projectsTable, sessionsTable, settingsTable } from './schema.js'

export class OwlsStore {
  private readonly sqlite: Database.Database
  /** Shared with the Router store so both write through one connection. */
  readonly db
  /** This device, the owner of every record written through this store. */
  readonly deviceId: string
  /** `database` is a file path, or an open client, which tests pass. */
  constructor(database: string | Database.Database, migrationsFolder: string) {
    this.sqlite = typeof database === 'string' ? new Database(database) : database
    this.sqlite.pragma('journal_mode = WAL')
    this.db = drizzle(this.sqlite)
    migrate(this.db, { migrationsFolder })
    this.deviceId = loadDeviceIdentity(this.db).deviceId
  }
  settings(): AppSettings {
    const row = this.db.select().from(settingsTable).get()
    return row
      ? settingsSchema.parse(row.value)
      : {
          executablePath: null,
          model: null,
          effort: null,
          permission: 'workspace-write',
          theme: 'system',
          language: 'en',
          appLogo: defaultAppLogo,
          sidebarCollapsed: false,
          provider: 'codex',
          claudeExecutablePath: null,
          claudeModel: null,
          claudeEffort: null,
          cursorExecutablePath: null,
          cursorModel: null,
          router: defaultRouterSettings,
          memory: defaultMemorySettings,
          layout: defaultLayoutSettings,
          updateChannel: null,
          pullRequestsVisible: true,
          workspacePath: null
        }
  }
  saveSettings(value: AppSettings): AppSettings {
    const settings = settingsSchema.parse(value)
    this.db
      .insert(settingsTable)
      .values({ id: 'settings', value: settings })
      .onConflictDoUpdate({ target: settingsTable.id, set: { value: settings } })
      .run()
    return settings
  }
  sessions(): Session[] {
    return this.db
      .select()
      .from(sessionsTable)
      .orderBy(desc(sessionsTable.updatedAt))
      .all()
      .map((row) => sessionSchema.parse(row.value))
  }
  saveSession(value: Session): void {
    const session = sessionSchema.parse(value)
    this.db.transaction((tx) => {
      tx.insert(sessionsTable)
        .values({
          id: session.id,
          ownerDeviceId: this.deviceId,
          updatedAt: session.updatedAt,
          value: session
        })
        .onConflictDoUpdate({
          target: sessionsTable.id,
          set: { updatedAt: session.updatedAt, value: session }
        })
        .run()
      logChange(tx, 'session', session.id)
    })
  }
  removeSession(id: string): void {
    this.db.transaction((tx) => {
      tx.delete(commandsTable).where(eq(commandsTable.sessionId, id)).run()
      tx.delete(sessionsTable).where(eq(sessionsTable.id, id)).run()
      logChange(tx, 'session', id)
    })
  }
  projects(): Project[] {
    return this.db
      .select()
      .from(projectsTable)
      .all()
      .map((row) => projectSchema.parse(row.value))
      .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
  }
  saveProject(project: Project): void {
    this.db.transaction((tx) => {
      tx.insert(projectsTable)
        .values({ id: project.id, ownerDeviceId: this.deviceId, value: project })
        .onConflictDoUpdate({ target: projectsTable.id, set: { value: project } })
        .run()
      logChange(tx, 'project', project.id)
    })
  }
  acceptCommand(id: string, sessionId: string, text: string): boolean {
    const inputHash = createHash('sha256').update(sessionId).update('\0').update(text).digest('hex')
    const existing = this.db.select().from(commandsTable).where(eq(commandsTable.id, id)).get()
    if (existing) {
      if (existing.inputHash !== inputHash)
        throw new OwlsError(
          'invalid_request',
          'Command ID was already used for a different message.'
        )
      return false
    }
    this.db.insert(commandsTable).values({ id, sessionId, inputHash }).run()
    return true
  }
  close(): void {
    this.sqlite.close()
  }
}
