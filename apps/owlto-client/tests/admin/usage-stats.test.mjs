import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { openSqlite } from '../fixtures/sqlite.mjs'

const require = createRequire(import.meta.url)
const {
  OwltoStore,
  UsageLedger,
  claudeResultUsage,
  codexCallUsage
} = require('../../out/main/app/runtime.js')

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = resolve(here, '../../migrations')
const PROVIDERS = resolve(here, '../fixtures/providers')

/** The recorded provider messages of one fixture, in order. */
function recorded(name) {
  return readFileSync(join(PROVIDERS, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const value = JSON.parse(line)
      return value.message ?? value.frame
    })
}

function openLedger(t, now) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'owlto-usage-stats-')))
  const client = openSqlite(join(root, 'owlto.db'))
  const store = new OwltoStore(client, MIGRATIONS)
  t.after(() => {
    client.close()
    rmSync(root, { recursive: true, force: true })
  })
  return new UsageLedger(store, () => now.value)
}

const entry = (fields) => ({
  agent: 'claude-code',
  role: 'worker',
  model: null,
  projectId: null,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  costUsd: null,
  ...fields
})

test('a Claude Code result is split per model with the cost of that result only', () => {
  const result = recorded('claude-code/worker-steer.jsonl').find((m) => m?.type === 'result')
  assert.deepEqual(claudeResultUsage(result), [
    {
      model: 'claude-haiku-5-5',
      input: 1195,
      output: 15,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      costUsd: 0.00012700000000000002
    },
    {
      model: 'claude-opus-5-5',
      input: 4,
      output: 250,
      cacheRead: 31724,
      cacheWrite: 8972,
      reasoning: 157,
      costUsd: 0.0831368
    }
  ])
})

test('a Claude Code result without the per-result breakdown falls back to the main loop', () => {
  const usage = claudeResultUsage({
    type: 'result',
    usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 5 },
    // A running total that a resumed session starts from its transcript: never summed.
    modelUsage: { 'claude-opus-5-5': { inputTokens: 9000, outputTokens: 9000 } }
  })
  assert.deepEqual(usage, [
    { model: null, input: 3, output: 2, cacheRead: 5, cacheWrite: 0, reasoning: 0, costUsd: null }
  ])
})

test('Codex per-call usage separates cached input from new input', () => {
  const update = recorded('codex/worker-steer.jsonl').find(
    (m) => m?.method === 'thread/tokenUsage/updated'
  )
  const usage = codexCallUsage(update.params.tokenUsage.last, 'gpt-5.6-sol')
  assert.deepEqual(usage, {
    model: 'gpt-5.6-sol',
    input: 16550 - 7040,
    output: 134,
    cacheRead: 7040,
    cacheWrite: 0,
    reasoning: 46,
    costUsd: null
  })
})

test('the ledger sums a range by day, agent, role, model, and project', (t) => {
  const now = { value: new Date(2026, 10, 14, 15, 0) }
  const ledger = openLedger(t, now)
  now.value = new Date(2026, 10, 1, 9, 0)
  ledger.record(entry({ input: 1000, output: 100 }))
  now.value = new Date(2026, 10, 12, 23, 30)
  ledger.record(
    entry({
      model: 'claude-opus-5-5',
      projectId: 'p1',
      input: 10,
      output: 90,
      cacheRead: 900,
      reasoning: 40,
      costUsd: 0.5
    })
  )
  now.value = new Date(2026, 10, 14, 8, 0)
  ledger.record(
    entry({ agent: 'codex', role: 'router', model: 'gpt-5.6-sol', input: 50, cacheRead: 50 })
  )
  // Nothing to count is not a row.
  ledger.record(entry({ agent: 'cursor' }))
  now.value = new Date(2026, 10, 14, 15, 0)

  const week = ledger.stats('7d')
  assert.equal(week.since, '2026-11-08')
  assert.equal(week.days.length, 7)
  assert.equal(week.days.at(-1).day, '2026-11-14')
  assert.deepEqual(
    week.days.filter((d) => d.input + d.output + d.cacheRead > 0).map((d) => d.day),
    ['2026-11-12', '2026-11-14']
  )
  assert.deepEqual(week.totals, {
    input: 60,
    output: 90,
    cacheRead: 950,
    cacheWrite: 0,
    reasoning: 40,
    costUsd: 0.5,
    unpricedTokens: 100
  })
  assert.deepEqual(
    week.byAgent.map((g) => [g.key, g.input + g.output + g.cacheRead]),
    [
      ['claude-code', 1000],
      ['codex', 100]
    ]
  )
  assert.deepEqual(
    week.byRole.map((g) => g.key),
    ['worker', 'router']
  )
  assert.deepEqual(
    week.byProject.map((g) => g.key),
    ['p1', null]
  )

  assert.deepEqual(week.agents, ['claude-code', 'codex'])
  const codex = ledger.stats('7d', 'codex')
  assert.equal(codex.agent, 'codex')
  assert.deepEqual(codex.agents, ['claude-code', 'codex'])
  assert.equal(codex.totals.input + codex.totals.cacheRead, 100)
  assert.deepEqual(
    codex.byModel.map((g) => g.key),
    ['gpt-5.6-sol']
  )
  assert.equal(ledger.stats('all', 'codex').since, '2026-11-14')

  const all = ledger.stats('all')
  assert.equal(all.since, '2026-11-01')
  assert.equal(all.days.length, 14)
  assert.equal(all.totals.input, 1060)
  assert.deepEqual(
    all.byModel.map((g) => g.key),
    [null, 'claude-opus-5-5', 'gpt-5.6-sol']
  )
})

test('an empty ledger answers with an empty range', (t) => {
  const ledger = openLedger(t, { value: new Date(2026, 10, 14) })
  const all = ledger.stats('all')
  assert.equal(all.since, null)
  assert.deepEqual(all.days, [])
  assert.deepEqual(all.byAgent, [])
  assert.equal(ledger.stats('30d').days.length, 30)
})
