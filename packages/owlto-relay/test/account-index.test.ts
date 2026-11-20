import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  ensureAccountIndex,
  type IndexDatabase,
  type IndexStatement,
  writeAccountIndex
} from '../src/account-index.ts'
import { type AccountRecord, SESSION_IDLE_MS, summarizeAccount } from '../src/accounts.ts'

/** D1's statement API over Node's SQLite, which D1 runs on. */
function sqliteIndex(db: DatabaseSync): IndexDatabase {
  const statement = (sql: string, values: unknown[] = []): IndexStatement => ({
    bind: (...next) => statement(sql, next),
    run: async () => db.prepare(sql).run(...(values as (string | number)[]))
  })
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      for (const each of statements) await each.run()
    }
  }
}

const record = (overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  account: 'a'.repeat(64),
  login: 'yanlin',
  sessions: [
    { hash: 'h1', name: 'Mac mini', createdAt: 1_000, lastUsedAt: 5_000 },
    { hash: 'h2', name: 'MacBook', createdAt: 2_000, lastUsedAt: 9_000 }
  ],
  mailboxes: [{ mailbox: 'm'.repeat(32), session: 'h1', claimedAt: 3_000 }],
  ...overrides
})

test('an account summary counts live sessions and Macs, and keeps no secret', () => {
  const now = 9_000 + SESSION_IDLE_MS - 1
  assert.deepEqual(summarizeAccount(record(), now), {
    account: 'a'.repeat(64),
    login: 'yanlin',
    macs: 1,
    sessions: 1,
    lastSeenAt: 9_000
  })
})

test('the account index keeps one row per account and forgets a deleted one', async () => {
  const sqlite = new DatabaseSync(':memory:')
  const db = sqliteIndex(sqlite)
  await ensureAccountIndex(db)
  await ensureAccountIndex(db)
  await writeAccountIndex(db, summarizeAccount(record(), 10_000), 10_000)
  await writeAccountIndex(
    db,
    summarizeAccount(record({ login: 'yanlin-renamed', mailboxes: [] }), 20_000),
    20_000
  )
  assert.deepEqual(
    sqlite
      .prepare('SELECT login, macs, sessions, created_at, updated_at FROM accounts')
      .all()
      .map((row) => ({ ...row })),
    [{ login: 'yanlin-renamed', macs: 0, sessions: 2, created_at: 10_000, updated_at: 20_000 }]
  )
  await writeAccountIndex(db, { gone: 'a'.repeat(64) }, 30_000)
  assert.deepEqual({ ...sqlite.prepare('SELECT count(*) AS n FROM accounts').get() }, { n: 0 })
})
