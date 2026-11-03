import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { app } from 'electron'
import { getDataRoot } from '../pichu-paths.js'
import * as schema from './schema.js'

const require = createRequire(import.meta.url)

let _db: BetterSQLite3Database<typeof schema> | null = null
let _sqlite: BetterSqlite3.Database | null = null

export function initDatabase(): void {
  if (_db) return

  const dbPath = join(getDataRoot(), 'pichu.db')
  const Database = require('better-sqlite3') as typeof BetterSqlite3
  _sqlite = new Database(dbPath)

  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('foreign_keys = ON')

  const dbInstance = drizzle(_sqlite, { schema })
  migrate(dbInstance, { migrationsFolder: migrationsFolder() })
  _db = dbInstance
}

function migrationsFolder(): string {
  const resourcesPath =
    typeof process.resourcesPath === 'string' ? process.resourcesPath : undefined
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, 'drizzle')] : []),
    join(app.getAppPath(), 'drizzle'),
    join(process.cwd(), 'drizzle')
  ]
  const folder = candidates.find((candidate) =>
    existsSync(join(candidate, 'meta', '_journal.json'))
  )
  if (!folder) {
    throw new Error(`Could not find Drizzle migrations folder. Checked: ${candidates.join(', ')}`)
  }
  return folder
}

export function db(): BetterSQLite3Database<typeof schema> {
  if (!_db) {
    throw new Error('Database not initialized — call initDatabase() first')
  }
  return _db
}

export function sqlite(): BetterSqlite3.Database {
  if (!_sqlite) {
    throw new Error('Database not initialized — call initDatabase() first')
  }
  return _sqlite
}
