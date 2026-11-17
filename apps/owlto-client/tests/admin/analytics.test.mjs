import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { Analytics, PostHogClient, parseFlags } = require('../../out/main/app/runtime.js')

const CONFIG = { key: 'phc_test', host: 'https://posthog.example/' }
const NOW = new Date('2026-11-17T08:00:00.000Z')

/** A transport that records requests and answers from `reply`. */
function fakeTransport(reply = () => ({ ok: true, body: {} })) {
  const requests = []
  const transport = async (url, body) => {
    const request = { url, body, ok: false }
    requests.push(request)
    const answer = await reply(url, body)
    request.ok = answer.ok
    return { ok: answer.ok, json: async () => answer.body }
  }
  return { requests, transport }
}

function harness({
  usageData = true,
  identity = null,
  reply,
  connectedAgents = ['codex', 'claude-code']
} = {}) {
  const { requests, transport } = fakeTransport(reply)
  const settings = { usageData, language: 'en', connectedAgents }
  const saved = []
  const timers = { started: 0, stopped: 0 }
  const client = new PostHogClient(CONFIG, transport)
  const analytics = new Analytics({
    client,
    settings: () => settings,
    loadIdentity: () => identity,
    saveIdentity: (value) => saved.push(value),
    context: { appVersion: '2026.11.1700-beta.1', os: 'macOS', osVersion: '15.1', arch: 'arm64' },
    now: () => NOW,
    every: () => {
      timers.started += 1
      return () => {
        timers.stopped += 1
      }
    }
  })
  const events = () =>
    requests.filter((request) => request.ok).flatMap((request) => request.body.batch ?? [])
  return { analytics, client, settings, saved, requests, events, timers }
}

const appSettings = (overrides) => ({
  usageData: true,
  onboarding: 'pending',
  language: 'en',
  connectedAgents: [],
  ...overrides
})

test('the first launch records an install, then every launch records an open', async () => {
  const { analytics, saved, requests, events } = harness()
  analytics.start()
  await analytics.flush()
  assert.equal(saved.length, 1)
  assert.match(saved[0].distinctId, /^[0-9a-f-]{36}$/)
  assert.equal(requests[0].url, 'https://posthog.example/batch/')
  assert.equal(requests[0].body.api_key, 'phc_test')
  assert.deepEqual(
    events().map((event) => event.event),
    ['app_installed', 'app_opened']
  )
  const opened = events()[1]
  assert.equal(opened.distinct_id, saved[0].distinctId)
  assert.equal(opened.timestamp, NOW.toISOString())
  assert.equal(opened.properties.connected_agents, 'claude-code,codex')
  assert.equal(opened.properties.$app_version, '2026.11.1700-beta.1')
  assert.equal(opened.properties.release_channel, 'beta')
  assert.equal(opened.properties.$os, 'macOS')
})

test('a saved identity is reused and no install is recorded', async () => {
  const identity = {
    distinctId: '6a1c1f1e-1111-4222-8333-444455556666',
    firstSeenAt: NOW.toISOString()
  }
  const { analytics, saved, events } = harness({ identity })
  analytics.start()
  await analytics.flush()
  assert.equal(saved.length, 0)
  assert.deepEqual(
    events().map((event) => [event.event, event.distinct_id]),
    [['app_opened', identity.distinctId]]
  )
})

test('usage data off sends nothing and reads no flags', async () => {
  const { analytics, requests, saved, timers } = harness({ usageData: false })
  analytics.start()
  analytics.ipcSucceeded('router-send', undefined)
  assert.equal(await analytics.flag('new-onboarding'), null)
  await analytics.flush()
  assert.equal(requests.length, 0)
  assert.equal(saved.length, 0)
  assert.equal(timers.started, 0)
})

test('turning usage data off drops queued events and stops the timer', async () => {
  const { analytics, client, settings, requests, timers } = harness()
  analytics.start()
  assert.equal(client.pending, 2)
  settings.usageData = false
  analytics.settingsChanged(appSettings({ usageData: false }), appSettings({ usageData: true }))
  assert.equal(client.pending, 0)
  assert.equal(timers.stopped, 1)
  analytics.ipcSucceeded('router-create', {})
  await analytics.flush()
  assert.equal(requests.length, 0)
})

test('tracked IPC calls become events without their payloads', async () => {
  const { analytics, events } = harness()
  analytics.start()
  analytics.ipcSucceeded('router-send', { text: 'secret message' })
  analytics.ipcSucceeded('pick-project', null)
  analytics.ipcSucceeded('pick-project', { path: '/Users/me/secret' })
  analytics.ipcSucceeded('connect-claude', { status: 'error' })
  analytics.ipcSucceeded('connect-claude', { status: 'ready' })
  analytics.ipcSucceeded('memory-list', {})
  await analytics.flush()
  const tracked = events().slice(2)
  assert.deepEqual(
    tracked.map((event) => event.event),
    ['message_sent', 'project_added', 'agent_connected']
  )
  assert.equal(tracked[1].properties.method, 'pick')
  assert.equal(tracked[2].properties.agent, 'claude-code')
  const sent = JSON.stringify(events())
  assert.doesNotMatch(sent, /secret/)
})

test('workers count once, and only when dispatched after launch', async () => {
  const { analytics, events } = harness()
  analytics.start()
  const worker = (id, createdAt) => ({
    type: 'worker',
    worker: { id, provider: 'cursor', projectId: null, createdAt, goal: 'private goal' }
  })
  analytics.observe(worker('old', '2026-11-16T08:00:00.000Z'))
  analytics.observe(worker('new', NOW.toISOString()))
  analytics.observe(worker('new', NOW.toISOString()))
  await analytics.flush()
  const started = events().filter((event) => event.event === 'worker_started')
  assert.equal(started.length, 1)
  assert.equal(started[0].properties.agent, 'cursor')
  assert.equal(started[0].properties.in_project, false)
  assert.doesNotMatch(JSON.stringify(started), /private goal/)
})

test('finishing onboarding is recorded with how it ended', async () => {
  const { analytics, events } = harness()
  analytics.start()
  analytics.settingsChanged(appSettings({ onboarding: 'skipped' }), appSettings())
  analytics.settingsChanged(
    appSettings({ onboarding: 'done' }),
    appSettings({ onboarding: 'skipped' })
  )
  await analytics.flush()
  const finished = events().filter((event) => event.event === 'onboarding_finished')
  assert.deepEqual(
    finished.map((event) => event.properties.result),
    ['skipped']
  )
})

test('flags are read once, and each flag reports its exposure once', async () => {
  const { analytics, requests, events } = harness({
    reply: (url) =>
      url.includes('/flags')
        ? {
            ok: true,
            body: {
              flags: {
                'new-onboarding': { key: 'new-onboarding', enabled: true, variant: 'test' },
                'dark-launch': { key: 'dark-launch', enabled: false, variant: null }
              }
            }
          }
        : { ok: true, body: {} }
  })
  analytics.start()
  assert.equal(await analytics.flag('new-onboarding'), 'test')
  assert.equal(await analytics.flag('new-onboarding'), 'test')
  assert.equal(await analytics.flag('dark-launch'), false)
  assert.equal(await analytics.flag('missing'), null)
  const flagRequests = requests.filter((request) => request.url.includes('/flags'))
  assert.equal(flagRequests.length, 1)
  assert.equal(flagRequests[0].url, 'https://posthog.example/flags?v=2')
  await analytics.flush()
  const exposures = events().filter((event) => event.event === '$feature_flag_called')
  assert.deepEqual(
    exposures.map((event) => [
      event.properties.$feature_flag,
      event.properties.$feature_flag_response
    ]),
    [
      ['new-onboarding', 'test'],
      ['dark-launch', false],
      ['missing', null]
    ]
  )
})

test('an unreachable PostHog keeps events queued for the next flush', async () => {
  let online = false
  const { analytics, client, events } = harness({
    reply: () => {
      if (!online) throw new Error('offline')
      return { ok: true, body: {} }
    }
  })
  analytics.start()
  await analytics.flush()
  assert.equal(client.pending, 2)
  assert.equal(await analytics.flag('new-onboarding'), null)
  online = true
  await analytics.flush()
  assert.equal(client.pending, 0)
  assert.deepEqual(
    events().map((event) => event.event),
    ['app_installed', 'app_opened', '$feature_flag_called']
  )
})

test('flag replies parse both the v2 and the older shape', () => {
  assert.deepEqual(
    parseFlags({ flags: { a: { enabled: true, variant: 'b' }, c: { enabled: true }, d: {} } }),
    { a: 'b', c: true }
  )
  assert.deepEqual(parseFlags({ featureFlags: { a: 'b', c: false, d: 3 } }), { a: 'b', c: false })
  assert.equal(parseFlags('nope'), null)
})
