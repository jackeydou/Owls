import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { Analytics, posthogSink } = require('../../out/main/app/runtime.js')

const NOW = new Date('2026-11-17T08:00:00.000Z')
const INSTALL_ID = '6a1c1f1e-1111-4222-8333-444455556666'

/** A sink standing in for the PostHog SDK: records captures, flag reads, and state. */
function fakeSink({ flags = null } = {}) {
  const sink = {
    captured: [],
    flagReads: 0,
    paused: 0,
    resumed: 0,
    shutdowns: [],
    capture: (message) => sink.captured.push(message),
    flags: async () => {
      sink.flagReads += 1
      const values = typeof flags === 'function' ? flags() : flags
      return values ? { get: (key) => values[key] } : null
    },
    pause: async () => {
      sink.paused += 1
    },
    resume: async () => {
      sink.resumed += 1
    },
    shutdown: async (timeoutMs) => {
      sink.shutdowns.push(timeoutMs)
    }
  }
  return sink
}

function harness({ usageData = true, identity = null, flags } = {}) {
  const sink = fakeSink({ flags })
  const settings = { usageData, language: 'en', connectedAgents: ['codex', 'claude-code'] }
  const saved = []
  const analytics = new Analytics({
    sink,
    settings: () => settings,
    loadIdentity: () => identity,
    saveIdentity: (value) => saved.push(value),
    context: { appVersion: '2026.11.1700-beta.1', os: 'macOS', osVersion: '15.1', arch: 'arm64' },
    now: () => NOW
  })
  const events = () => sink.captured.map((message) => message.event)
  return { analytics, sink, settings, saved, events }
}

const appSettings = (overrides) => ({
  usageData: true,
  onboarding: 'pending',
  language: 'en',
  connectedAgents: [],
  ...overrides
})

test('the first launch records an install, then every launch records an open', () => {
  const { analytics, sink, saved, events } = harness()
  analytics.start()
  assert.equal(saved.length, 1)
  assert.match(saved[0].distinctId, /^[0-9a-f-]{36}$/)
  assert.deepEqual(events(), ['app_installed', 'app_opened'])
  const opened = sink.captured[1]
  assert.equal(opened.distinctId, saved[0].distinctId)
  assert.equal(opened.timestamp.toISOString(), NOW.toISOString())
  assert.equal(opened.properties.connected_agents, 'claude-code,codex')
  assert.equal(opened.properties.$app_version, '2026.11.1700-beta.1')
  assert.equal(opened.properties.release_channel, 'beta')
  assert.equal(opened.properties.$os, 'macOS')
})

test('a saved identity is reused and no install is recorded', () => {
  const identity = { distinctId: INSTALL_ID, firstSeenAt: NOW.toISOString() }
  const { analytics, sink, saved } = harness({ identity })
  analytics.start()
  assert.equal(saved.length, 0)
  assert.deepEqual(
    sink.captured.map((message) => [message.event, message.distinctId]),
    [['app_opened', INSTALL_ID]]
  )
})

test('usage data off sends nothing and reads no flags', async () => {
  const { analytics, sink, saved } = harness({ usageData: false, flags: { a: true } })
  analytics.start()
  analytics.ipcSucceeded('router-send', undefined)
  assert.equal(await analytics.flag('a'), null)
  assert.equal(sink.captured.length, 0)
  assert.equal(sink.flagReads, 0)
  assert.equal(sink.paused, 1)
  assert.equal(saved.length, 0)
})

test('turning usage data off pauses the SDK, and back on resumes it', () => {
  const { analytics, sink, settings } = harness()
  analytics.start()
  settings.usageData = false
  analytics.settingsChanged(appSettings({ usageData: false }), appSettings({ usageData: true }))
  analytics.ipcSucceeded('router-create', {})
  assert.equal(sink.paused, 1)
  assert.equal(sink.captured.length, 2)
  settings.usageData = true
  analytics.settingsChanged(appSettings({ usageData: true }), appSettings({ usageData: false }))
  analytics.ipcSucceeded('router-create', {})
  assert.equal(sink.resumed, 1)
  assert.equal(sink.captured.at(-1).event, 'thread_created')
})

test('tracked IPC calls become events without their payloads', () => {
  const { analytics, sink, events } = harness()
  analytics.start()
  analytics.ipcSucceeded('router-send', { text: 'secret message' })
  analytics.ipcSucceeded('pick-project', null)
  analytics.ipcSucceeded('pick-project', { path: '/Users/me/secret' })
  analytics.ipcSucceeded('connect-claude', { status: 'error' })
  analytics.ipcSucceeded('connect-claude', { status: 'ready' })
  analytics.ipcSucceeded('memory-list', {})
  assert.deepEqual(events().slice(2), ['message_sent', 'project_added', 'agent_connected'])
  assert.equal(sink.captured[3].properties.method, 'pick')
  assert.equal(sink.captured[4].properties.agent, 'claude-code')
  assert.doesNotMatch(JSON.stringify(sink.captured), /secret/)
})

test('workers count once, and only when dispatched after launch', () => {
  const { analytics, sink } = harness()
  analytics.start()
  const worker = (id, createdAt) => ({
    type: 'worker',
    worker: { id, provider: 'cursor', projectId: null, createdAt, goal: 'private goal' }
  })
  analytics.observe(worker('old', '2026-11-16T08:00:00.000Z'))
  analytics.observe(worker('new', NOW.toISOString()))
  analytics.observe(worker('new', NOW.toISOString()))
  const started = sink.captured.filter((message) => message.event === 'worker_started')
  assert.equal(started.length, 1)
  assert.equal(started[0].properties.agent, 'cursor')
  assert.equal(started[0].properties.in_project, false)
  assert.doesNotMatch(JSON.stringify(started), /private goal/)
})

test('finishing onboarding is recorded with how it ended', () => {
  const { analytics, sink } = harness()
  analytics.start()
  analytics.settingsChanged(appSettings({ onboarding: 'skipped' }), appSettings())
  analytics.settingsChanged(
    appSettings({ onboarding: 'done' }),
    appSettings({ onboarding: 'skipped' })
  )
  const finished = sink.captured.filter((message) => message.event === 'onboarding_finished')
  assert.deepEqual(
    finished.map((message) => message.properties.result),
    ['skipped']
  )
})

test('flags are read once per launch and unknown flags are null', async () => {
  const { analytics, sink } = harness({ flags: { 'new-onboarding': 'test', dark: false } })
  analytics.start()
  assert.equal(await analytics.flag('new-onboarding'), 'test')
  assert.equal(await analytics.flag('dark'), false)
  assert.equal(await analytics.flag('missing'), null)
  assert.equal(sink.flagReads, 1)
})

test('an unreachable PostHog leaves flags null and tries again on the next read', async () => {
  let online = false
  const { analytics, sink } = harness({ flags: () => (online ? { a: 'b' } : null) })
  analytics.start()
  assert.equal(await analytics.flag('a'), null)
  online = true
  assert.equal(await analytics.flag('a'), 'b')
  assert.equal(sink.flagReads, 2)
})

test('closing shuts the SDK down once and stops capturing', async () => {
  const { analytics, sink } = harness()
  analytics.start()
  await analytics.close(1500)
  await analytics.close(1500)
  analytics.ipcSucceeded('router-send', {})
  assert.deepEqual(sink.shutdowns, [1500])
  assert.equal(sink.captured.length, 2)
})

test('the PostHog SDK sends events and flag exposure to the configured host', async () => {
  const requests = []
  const flagsBody = {
    flags: {
      'new-onboarding': {
        key: 'new-onboarding',
        enabled: true,
        variant: 'test',
        reason: { code: 'condition_match' },
        metadata: { id: 1, version: 1 }
      }
    }
  }
  const fetch = async (url, options) => {
    requests.push({ url, body: typeof options.body === 'string' ? JSON.parse(options.body) : null })
    const json = url.includes('/flags') ? flagsBody : { status: 1 }
    return {
      status: 200,
      text: async () => JSON.stringify(json),
      json: async () => json,
      headers: { get: () => null }
    }
  }
  const analytics = new Analytics({
    sink: posthogSink(
      { key: 'phc_test', host: 'https://posthog.example' },
      { fetch, disableCompression: true, fetchRetryCount: 0 }
    ),
    settings: () => ({ usageData: true, language: 'zh-CN', connectedAgents: [] }),
    loadIdentity: () => ({ distinctId: INSTALL_ID, firstSeenAt: NOW.toISOString() }),
    saveIdentity: () => {},
    context: { appVersion: '2026.11.1700', os: 'macOS', osVersion: '15.1', arch: 'arm64' }
  })
  analytics.start()
  analytics.ipcSucceeded('router-send', { text: 'secret message' })
  assert.equal(await analytics.flag('new-onboarding'), 'test')
  await analytics.close(5000)

  assert.ok(requests.length > 0)
  assert.ok(requests.every((request) => request.url.startsWith('https://posthog.example/')))
  const batches = requests.filter((request) => request.url.includes('/batch'))
  assert.ok(batches.every((request) => request.body.api_key === 'phc_test'))
  const events = batches.flatMap((request) => request.body.batch)
  assert.deepEqual(events.map((event) => event.event).sort(), [
    '$feature_flag_called',
    'app_opened',
    'message_sent'
  ])
  assert.ok(events.every((event) => event.distinct_id === INSTALL_ID))
  const exposure = events.find((event) => event.event === '$feature_flag_called')
  assert.equal(exposure.properties.$feature_flag, 'new-onboarding')
  assert.equal(exposure.properties.$feature_flag_response, 'test')
  const opened = events.find((event) => event.event === 'app_opened')
  assert.equal(opened.properties.language, 'zh-CN')
  assert.equal(opened.properties.release_channel, 'stable')
  assert.doesNotMatch(JSON.stringify(events), /secret/)
})
