import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('../..', import.meta.url))
const usageMigration = join(appRoot, 'drizzle', '0001_thankful_ezekiel.sql')

const fixtureSchema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE sessions (
    session_id text PRIMARY KEY NOT NULL,
    agent_id text NOT NULL,
    cwd text NOT NULL,
    title text DEFAULT '' NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
  );
  CREATE TABLE messages (
    id text PRIMARY KEY NOT NULL,
    session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    role text NOT NULL,
    content text NOT NULL,
    sort_order integer NOT NULL,
    created_at text NOT NULL,
    model_id text,
    model_usage_json text
  );
`

function sqliteAvailable() {
  try {
    execFileSync('sqlite3', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function runSql(databasePath, sql) {
  return execFileSync('sqlite3', ['-json', databasePath], {
    input: sql,
    encoding: 'utf8'
  }).trim()
}

test('usage migration backfills and maintains aggregates', { skip: !sqliteAvailable() }, (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pichu-usage-stats-'))
  const databasePath = join(directory, 'usage.db')

  t.after(() => rmSync(directory, { recursive: true, force: true }))
  runSql(databasePath, fixtureSchema)
  runSql(
    databasePath,
    `
      PRAGMA foreign_keys = ON;
      INSERT INTO sessions(session_id, agent_id, cwd, title, created_at, updated_at)
      VALUES('session', 'agent', '/tmp', 'Test', '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z');
      INSERT INTO messages(id, session_id, role, content, sort_order, created_at)
      VALUES('user', 'session', 'user', 'Hello', 0, '2026-08-11T23:30:00.000Z');
      INSERT INTO messages(
        id, session_id, role, content, sort_order, created_at, model_id, model_usage_json
      ) VALUES(
        'assistant', 'session', 'assistant', 'Hi', 1, '2026-08-12T00:30:00.000Z',
        'gpt-test', '{"input":100,"output":20,"cacheRead":5,"cacheWrite":0,"totalTokens":0}'
      );
    `
  )

  runSql(databasePath, readFileSync(usageMigration, 'utf8'))
  assert.deepEqual(
    JSON.parse(
      runSql(
        databasePath,
        'SELECT date, token_count, message_count FROM usage_daily_stats ORDER BY date;'
      )
    ),
    [
      { date: '2026-08-11', token_count: 0, message_count: 1 },
      { date: '2026-08-12', token_count: 125, message_count: 0 }
    ]
  )
  assert.deepEqual(
    JSON.parse(runSql(databasePath, 'SELECT model_id, token_count FROM usage_model_stats;')),
    [{ model_id: 'gpt-test', token_count: 125 }]
  )

  runSql(
    databasePath,
    `UPDATE messages
     SET model_id = 'gpt-new', model_usage_json = '{"totalTokens":200}'
     WHERE id = 'assistant';`
  )
  assert.deepEqual(
    JSON.parse(
      runSql(
        databasePath,
        'SELECT date, token_count, message_count FROM usage_daily_stats ORDER BY date;'
      )
    ),
    [
      { date: '2026-08-11', token_count: 0, message_count: 1 },
      { date: '2026-08-12', token_count: 200, message_count: 0 }
    ]
  )
  assert.deepEqual(
    JSON.parse(runSql(databasePath, 'SELECT model_id, token_count FROM usage_model_stats;')),
    [{ model_id: 'gpt-new', token_count: 200 }]
  )

  runSql(
    databasePath,
    "PRAGMA foreign_keys = ON; DELETE FROM sessions WHERE session_id = 'session';"
  )
  assert.deepEqual(
    JSON.parse(
      runSql(
        databasePath,
        'SELECT (SELECT count(*) FROM usage_daily_stats) AS daily, (SELECT count(*) FROM usage_model_stats) AS models;'
      )
    ),
    [{ daily: 0, models: 0 }]
  )
})
