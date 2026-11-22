import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { CdpGate } = require('../../out/main/app/runtime.js')
const { WebSocket } = require('ws')

/** A browser with fake tabs: each answers getTargetInfo and echoes other commands. */
function fakeBackend() {
  const tabs = []
  const sent = []
  const held = new Set()
  let next = 1
  const makeTab = (key) => {
    const id = `tab-${next++}`
    const tab = {
      id,
      key,
      send: async (method, params, sessionId) => {
        sent.push({ tab: id, method, params, sessionId })
        if (method === 'Target.getTargetInfo')
          return {
            targetInfo: {
              targetId: `target-${id}`,
              type: 'page',
              title: '',
              url: 'about:blank',
              browserContextId: 'ctx'
            }
          }
        return { echoed: method }
      }
    }
    tabs.push(tab)
    return tab
  }
  return {
    tabs,
    sent,
    held,
    makeTab,
    backend: {
      version: () => ({ product: 'Chrome/140.0.0.0', userAgent: 'Mozilla/5.0 Chrome/140.0.0.0' }),
      tabs: (key) => tabs.filter((tab) => tab.key === key),
      createTab: async (key) => makeTab(key),
      closeTab: (key, tabId) => {
        const index = tabs.findIndex((tab) => tab.id === tabId && tab.key === key)
        if (index < 0) return false
        tabs.splice(index, 1)
        return true
      },
      activateTab: () => {},
      agentMayDrive: (tabId) => !held.has(tabId),
      noteCommand: () => {}
    }
  }
}

/** A raw CDP client: `call` resolves with the reply, `events` collects everything else. */
async function connect(endpoint) {
  const socket = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  const events = []
  const waiting = new Map()
  let id = 0
  socket.on('message', (data) => {
    const message = JSON.parse(String(data))
    if (message.id) waiting.get(message.id)?.(message)
    else events.push(message)
  })
  const call = (method, params, sessionId) =>
    new Promise((resolve) => {
      id += 1
      waiting.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  return { socket, events, call }
}

test('a worker endpoint sees only that worker’s tabs and can open and close its own', async () => {
  const fake = fakeBackend()
  fake.makeTab('worker-a')
  fake.makeTab('worker-b')
  const gate = new CdpGate(fake.backend)
  const client = await connect(await gate.endpoint('worker-a'))
  try {
    const version = await client.call('Browser.getVersion')
    assert.equal(version.result.product, 'Chrome/140.0.0.0')
    await client.call('Target.setAutoAttach', { autoAttach: true, flatten: true })
    const attached = client.events.filter((e) => e.method === 'Target.attachedToTarget')
    assert.deepEqual(
      attached.map((e) => e.params.targetInfo.targetId),
      ['target-tab-1']
    )
    const created = await client.call('Target.createTarget', { url: 'about:blank' })
    assert.equal(created.result.targetId, 'target-tab-3')
    assert.equal(fake.tabs.find((tab) => tab.id === 'tab-3').key, 'worker-a')
    const other = await client.call('Target.closeTarget', { targetId: 'target-tab-2' })
    assert.equal(other.result.success, false)
    const own = await client.call('Target.closeTarget', { targetId: 'target-tab-3' })
    assert.equal(own.result.success, true)
  } finally {
    client.socket.close()
    gate.close()
  }
})

test('page sessions reach their tab, but not browser-wide commands or held tabs', async () => {
  const fake = fakeBackend()
  const tab = fake.makeTab('worker-a')
  const gate = new CdpGate(fake.backend)
  const client = await connect(await gate.endpoint('worker-a'))
  try {
    await client.call('Target.setAutoAttach', { autoAttach: true, flatten: true })
    const { sessionId } = client.events.find((e) => e.method === 'Target.attachedToTarget').params
    const reply = await client.call('Runtime.evaluate', { expression: '1' }, sessionId)
    assert.equal(reply.result.echoed, 'Runtime.evaluate')
    assert.equal(fake.sent.at(-1).sessionId, undefined)
    const blocked = await client.call('Browser.close', {}, sessionId)
    assert.match(blocked.error.message, /not available/)
    fake.held.add(tab.id)
    const input = await client.call('Input.dispatchMouseEvent', { type: 'mousePressed' }, sessionId)
    assert.match(input.error.message, /hand it back/)
    // A child session (a frame or worker) announced by the tab is routed to it by id.
    gate.tabEvent(tab.id, 'Target.attachedToTarget', { sessionId: 'child-1' })
    await client.call('Runtime.enable', {}, 'child-1')
    assert.equal(fake.sent.at(-1).sessionId, 'child-1')
    gate.tabRemoved(tab.id)
    await client.call('Browser.getVersion')
    assert.ok(client.events.some((e) => e.method === 'Target.detachedFromTarget'))
  } finally {
    client.socket.close()
    gate.close()
  }
})

test('the gate refuses unknown tokens, web origins, and revoked workers', async () => {
  const fake = fakeBackend()
  const gate = new CdpGate(fake.backend)
  const endpoint = await gate.endpoint('worker-a')
  const refused = (url, options) =>
    new Promise((resolve) => {
      const socket = new WebSocket(url, options)
      socket.once('open', () => {
        socket.close()
        resolve(false)
      })
      socket.once('error', () => resolve(true))
    })
  try {
    assert.equal(await refused(endpoint.replace(/[0-9a-f]{6}$/, '000000')), true)
    assert.equal(await refused(endpoint, { origin: 'https://example.com' }), true)
    gate.revoke('worker-a')
    assert.equal(await refused(endpoint), true)
  } finally {
    gate.close()
  }
})
