import type { AccountSummary } from './accounts.ts'

/**
 * The account index in D1: one row per relay account, copied from its `RelayAccount` on
 * every change, so accounts can be counted and found with SQL (`wrangler d1 execute`).
 * Nothing in the relay reads it back; the Durable Objects stay the source of truth. It holds
 * the GitHub login and counts only: no session, hash, or mailbox id.
 */
export type AccountIndexChange = AccountSummary | { gone: string }

/** The parts of D1 the index uses, so Node can test it on SQLite. */
export interface IndexDatabase {
  prepare(sql: string): IndexStatement
  batch(statements: IndexStatement[]): Promise<unknown>
}
export interface IndexStatement {
  bind(...values: unknown[]): IndexStatement
  run(): Promise<unknown>
}

export const ACCOUNT_INDEX_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    account TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    macs INTEGER NOT NULL,
    sessions INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS accounts_login ON accounts (login)'
]

export function ensureAccountIndex(db: IndexDatabase): Promise<unknown> {
  return db.batch(ACCOUNT_INDEX_SCHEMA.map((sql) => db.prepare(sql)))
}

export function writeAccountIndex(
  db: IndexDatabase,
  change: AccountIndexChange,
  now: number
): Promise<unknown> {
  if ('gone' in change)
    return db.prepare('DELETE FROM accounts WHERE account = ?1').bind(change.gone).run()
  return db
    .prepare(
      `INSERT INTO accounts (account, login, macs, sessions, created_at, last_seen_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)
       ON CONFLICT (account) DO UPDATE SET login = ?2, macs = ?3, sessions = ?4,
         last_seen_at = ?6, updated_at = ?5`
    )
    .bind(change.account, change.login, change.macs, change.sessions, now, change.lastSeenAt)
    .run()
}
