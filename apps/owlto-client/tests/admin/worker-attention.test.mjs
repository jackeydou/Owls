import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { WorkerAttention } = require('../../out/main/app/runtime.js')

function request(id, options = {}) {
  return {
    id,
    kind: 'command',
    title: 'pnpm test',
    detail: '',
    questions: [],
    status: 'pending',
    turnId: 't1',
    ...options
  }
}
function session(id, requests = [], options = {}) {
  return {
    id,
    provider: 'claude-code',
    title: 'Session title',
    requests,
    ...options
  }
}
/** Attention over fakes: records shown and closed notices and the badge. */
function harness({ sessions = [], focused = false, enabled = true, language = 'en' } = {}) {
  const state = { focused, settings: { requestNotifications: enabled, language } }
  const shown = []
  const closed = []
  const badges = []
  const attention = new WorkerAttention(
    {
      settings: () => state.settings,
      focused: () => state.focused,
      worker: (sessionId) =>
        sessionId === 's1' ? { id: 'w1', routerId: 'r1', title: 'Fix login' } : null,
      show: (notice) => {
        shown.push(notice)
        return { close: () => closed.push(notice) }
      },
      badge: (count) => badges.push(count)
    },
    sessions
  )
  return { attention, state, shown, closed, badges }
}

test('announces a new approval once, with the worker as the target', () => {
  const { attention, shown, badges } = harness()
  attention.observe({ type: 'session', session: session('s1', [request('a')]) })
  attention.observe({ type: 'session', session: session('s1', [request('a')]) })
  assert.equal(shown.length, 1)
  assert.equal(shown[0].title, 'Claude Code needs your OK')
  assert.equal(shown[0].subtitle, 'Fix login')
  assert.equal(shown[0].body, 'pnpm test')
  assert.deepEqual(shown[0].target, { sessionId: 's1', workerId: 'w1', routerId: 'r1' })
  assert.deepEqual(badges, [0, 1])
})

test('questions use the question text and Chinese copy follows the language', () => {
  const { attention, shown } = harness({ language: 'zh-CN' })
  const question = request('q', {
    kind: 'question',
    title: '',
    questions: [{ id: 'x', header: 'Pick', question: 'Which branch?', options: null }]
  })
  attention.observe({ type: 'session', session: session('s2', [question], { provider: 'codex' }) })
  assert.equal(shown[0].title, 'Codex 有个问题要问你')
  assert.equal(shown[0].subtitle, 'Session title')
  assert.equal(shown[0].body, 'Which branch?')
  assert.deepEqual(shown[0].target, { sessionId: 's2', workerId: null, routerId: null })
})

test('stays quiet while focused or switched off, but still keeps the count', () => {
  const { attention, state, shown, badges } = harness({ focused: true })
  attention.observe({ type: 'session', session: session('s1', [request('a')]) })
  assert.equal(shown.length, 0)
  assert.deepEqual(badges, [0, 1])
  state.focused = false
  state.settings = { ...state.settings, requestNotifications: false }
  attention.settingsChanged()
  attention.observe({ type: 'session', session: session('s1', [request('a'), request('b')]) })
  assert.equal(shown.length, 0)
  assert.deepEqual(badges, [0, 1, 0])
})

test('a newer request replaces the notice, which closes once nothing waits', () => {
  const { attention, shown, closed, badges } = harness()
  attention.observe({ type: 'session', session: session('s1', [request('a')]) })
  attention.observe({ type: 'session', session: session('s1', [request('a'), request('b')]) })
  assert.equal(shown.length, 2)
  assert.equal(shown[1].body, 'pnpm test (+1 more)')
  assert.deepEqual(closed, [shown[0]])
  const done = [request('a', { status: 'resolved' }), request('b', { status: 'resolved' })]
  attention.observe({ type: 'session', session: session('s1', done) })
  assert.deepEqual(closed, [shown[0], shown[1]])
  assert.deepEqual(badges, [0, 1, 2, 0])
})

test('requests waiting before startup are counted but not announced', () => {
  const { attention, shown, badges } = harness({ sessions: [session('s1', [request('old')])] })
  attention.observe({ type: 'session', session: session('s1', [request('old')]) })
  assert.equal(shown.length, 0)
  assert.deepEqual(badges, [1])
  attention.observe({ type: 'removed', sessionId: 's1' })
  assert.deepEqual(badges, [1, 0])
})

test('a browser hand-off is announced once, counts toward the badge, and closes when done', () => {
  const { attention, shown, closed, badges } = harness()
  attention.browserNeed('s1', 'codex', { kind: 'handoff', text: 'Sign in to GitHub' })
  attention.browserNeed('s1', 'codex', { kind: 'handoff', text: 'Sign in to GitHub' })
  assert.equal(shown.length, 1)
  assert.equal(shown[0].title, 'Codex needs you in the browser')
  assert.equal(shown[0].body, 'Sign in to GitHub')
  assert.deepEqual(shown[0].target, { sessionId: 's1', workerId: 'w1', routerId: 'r1' })
  assert.equal(badges.at(-1), 1)
  attention.browserNeed('s1', 'codex', { kind: 'open', text: 'github.com' })
  assert.equal(shown.at(-1).body, 'Allow github.com?')
  assert.equal(closed.length, 1, 'the newer need replaces the notice')
  attention.browserNeed('s1', 'codex', null)
  assert.equal(closed.length, 2)
  assert.equal(badges.at(-1), 0)
})
