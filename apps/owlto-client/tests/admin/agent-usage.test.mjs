import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { openSqlite } from '../fixtures/sqlite.mjs'

const require = createRequire(import.meta.url)
const {
  ClaudeService,
  CodexService,
  CursorService,
  OwltoHost,
  OwltoStore,
  parseClaudeUsage,
  parseCodexRateLimits
} = require('../../out/main/app/runtime.js')

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = resolve(here, '../../migrations')
const fixture = (name) => {
  const path = resolve(here, '../fixtures', name)
  chmodSync(path, 0o755)
  return path
}
const CODEX = fixture('codex/mock-codex.cjs')
const CLAUDE = fixture('claude/mock-claude.cjs')

const claudeLimits = {
  five_hour: { utilization: 63, resets_at: '2026-11-14T05:00:00Z' },
  seven_day: { utilization: 120, resets_at: '2026-11-18T09:00:00Z' },
  seven_day_opus: { utilization: 99, resets_at: null },
  model_scoped: [{ display_name: 'Fable', utilization: 12.5, resets_at: null }],
  extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1000, utilization: 20 }
}
const session = {
  total_cost_usd: 0,
  total_api_duration_ms: 0,
  total_duration_ms: 0,
  total_lines_added: 0,
  total_lines_removed: 0,
  model_usage: {}
}

test('Claude usage keeps the plan windows in the CLI order and clamps percentages', () => {
  const usage = parseClaudeUsage(
    {
      session,
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: claudeLimits,
      behaviors: null
    },
    { kind: 'claude', email: null, plan: 'max' }
  )
  assert.equal(usage.state, 'ready')
  assert.equal(usage.plan, 'max')
  assert.deepEqual(
    usage.windows.map((w) => [w.kind, w.label, w.usedPercent, w.resetsAt]),
    [
      ['session', null, 63, '2026-11-14T05:00:00Z'],
      ['weekly', null, 100, '2026-11-18T09:00:00Z'],
      // The server's per-model list wins over the fixed Opus field.
      ['model', 'Fable', 12.5, null]
    ]
  )
  assert.deepEqual(usage.spend, { enabled: true, usedPercent: 20 })
})

test('Claude accounts without plan limits say why instead of showing meters', () => {
  const answer = {
    session,
    subscription_type: null,
    rate_limits_available: false,
    rate_limits: null,
    behaviors: null
  }
  assert.deepEqual(parseClaudeUsage(answer, { kind: 'api-key' }), {
    provider: 'claude-code',
    state: 'unavailable',
    reason: 'api-key',
    plan: null
  })
  assert.equal(parseClaudeUsage(answer, { kind: 'unknown' }).reason, 'no-plan-limits')
})

test('Codex rate limits map the primary and secondary windows and credits', () => {
  const usage = parseCodexRateLimits(
    {
      rateLimits: {
        primary: { usedPercent: 10, windowDurationMins: 10_080, resetsAt: 1_900_000_000 },
        secondary: { usedPercent: 55, windowDurationMins: 300, resetsAt: null },
        credits: null,
        planType: null
      }
    },
    'pro'
  )
  assert.equal(usage.plan, 'pro')
  // Shorter windows come first, whichever slot the server used.
  assert.deepEqual(
    usage.windows.map((w) => [w.kind, w.usedPercent, w.resetsAt]),
    [
      ['session', 55, null],
      ['weekly', 10, new Date(1_900_000_000_000).toISOString()]
    ]
  )
  assert.equal(usage.credits, null)
  assert.throws(() => parseCodexRateLimits({ rateLimits: 'nope' }, null))
})

/** Answers the CLI's structured /usage request like Claude Code would. */
function claudeSdk() {
  const calls = []
  return {
    calls,
    query({ prompt }) {
      const iterator = prompt[Symbol.asyncIterator]()
      const generator = (async function* () {
        // Nothing is sent to the model: the probe closes before a prompt.
        const first = await iterator.next()
        if (!first.done) yield* []
      })()
      return Object.assign(generator, {
        initializationResult: async () => ({
          models: [],
          account: { email: 'fixture@example.com', subscriptionType: 'max' }
        }),
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async (options) => {
          calls.push(options)
          return {
            session,
            subscription_type: 'max',
            rate_limits_available: true,
            rate_limits: claudeLimits,
            behaviors: null
          }
        },
        close: () => {}
      })
    }
  }
}

test('The host reads every agent through its own runtime and keeps the answer a minute', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'owlto-usage-')))
  const client = openSqlite(join(root, 'owlto.db'))
  const store = new OwltoStore(client, MIGRATIONS)
  store.saveSettings({
    ...store.settings(),
    executablePath: CODEX,
    claudeExecutablePath: CLAUDE,
    cursorExecutablePath: join(root, 'missing-cursor')
  })
  const sdk = claudeSdk()
  const codex = new CodexService(store, () => {})
  const claude = new ClaudeService(store, () => {}, sdk)
  const cursor = new CursorService(store, () => {})
  const host = new OwltoHost(codex, claude, cursor, join(root, 't'), join(root, 'p'), root)
  t.after(() => {
    codex.close()
    claude.close()
    cursor.close()
    client.close()
    rmSync(root, { recursive: true, force: true })
  })

  const before = await host.usage(false)
  assert.deepEqual(
    before.agents.map((a) => [a.provider, a.state, a.reason]),
    [
      ['claude-code', 'unavailable', 'not-connected'],
      ['codex', 'unavailable', 'not-connected'],
      ['cursor', 'unavailable', 'not-connected']
    ]
  )

  assert.equal((await codex.connect()).status, 'ready')
  assert.equal((await claude.connect()).status, 'ready')
  // A cached answer comes back until a refresh asks again.
  assert.equal((await host.usage(false)).agents[0].state, 'unavailable')
  const after = await host.usage(true)
  const [claudeUsage, codexUsage, cursorUsage] = after.agents
  assert.equal(claudeUsage.state, 'ready')
  assert.deepEqual(sdk.calls, [{ skipBehaviors: true }])
  assert.equal(claudeUsage.windows[0].usedPercent, 63)
  assert.equal(codexUsage.state, 'ready')
  assert.equal(codexUsage.plan, 'plus')
  assert.deepEqual(
    codexUsage.windows.map((w) => [w.kind, w.usedPercent]),
    [
      ['session', 42],
      ['weekly', 7.5]
    ]
  )
  assert.deepEqual(codexUsage.credits, { hasCredits: true, unlimited: false, balance: '12.50' })
  assert.equal(cursorUsage.reason, 'not-connected')
})
