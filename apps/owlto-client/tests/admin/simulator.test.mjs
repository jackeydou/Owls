import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  describeScreen,
  keystrokesFor,
  parseDevices,
  parseLaunchPid,
  runtimeName,
  SimulatorService,
  simulatorTools,
  unwrapAvcc
} = require('../../out/main/app/runtime.js')

const PHONE = '11111111-1111-1111-1111-111111111111'
const PAD = '22222222-2222-2222-2222-222222222222'
const OLD = '33333333-3333-3333-3333-333333333333'

const listJson = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-18-6': [
      { udid: OLD, name: 'iPhone 15', state: 'Shutdown', isAvailable: true }
    ],
    'com.apple.CoreSimulator.SimRuntime.iOS-26-1': [
      { udid: PAD, name: 'iPad Air', state: 'Shutdown', isAvailable: true },
      { udid: PHONE, name: 'iPhone 17 Pro', state: 'Booted', isAvailable: true },
      { udid: 'gone', name: 'Broken', state: 'Shutdown', isAvailable: false }
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [
      { udid: 'watch', name: 'Apple Watch', state: 'Shutdown', isAvailable: true }
    ]
  }
})

test('parseDevices keeps available iOS devices, booted first, newest runtime next', () => {
  const devices = parseDevices(listJson)
  assert.deepEqual(
    devices.map((d) => [d.name, d.runtime, d.state]),
    [
      ['iPhone 17 Pro', 'iOS 26.1', 'booted'],
      ['iPad Air', 'iOS 26.1', 'shutdown'],
      ['iPhone 15', 'iOS 18.6', 'shutdown']
    ]
  )
  assert.equal(runtimeName('com.apple.CoreSimulator.SimRuntime.iOS-27'), 'iOS 27')
  assert.equal(runtimeName('com.apple.CoreSimulator.SimRuntime.tvOS-26-0'), null)
  assert.equal(parseLaunchPid('com.example.app: 4242\n'), 4242)
  assert.equal(parseLaunchPid('nothing'), null)
})

test('describeScreen lists elements with refs at their centers', () => {
  const tree = [
    {
      type: 'Application',
      AXLabel: 'Demo',
      frame: { x: 0, y: 0, width: 400, height: 800 },
      children: [
        {
          type: 'Button',
          AXLabel: 'Sign in',
          enabled: true,
          frame: { x: 100, y: 700, width: 200, height: 40 },
          children: []
        },
        {
          type: 'Other',
          AXLabel: null,
          frame: { x: 0, y: 0, width: 10, height: 10 },
          children: [
            {
              type: 'TextField',
              AXLabel: 'Email',
              AXValue: 'a@b.c',
              enabled: false,
              frame: { x: 20, y: 100, width: 360, height: 40 },
              children: []
            }
          ]
        },
        {
          type: 'StaticText',
          AXLabel: 'Off screen',
          frame: { x: 0, y: 900, width: 100, height: 20 },
          children: []
        }
      ]
    }
  ]
  const screen = describeScreen(JSON.stringify(tree))
  assert.equal(screen.width, 400)
  assert.deepEqual(screen.lines, [
    '@e1 Button "Sign in" at (200, 720)',
    '@e2 TextField "Email" value "a@b.c" disabled at (200, 120)'
  ])
  assert.deepEqual(screen.refs.get('@e1'), { x: 0.5, y: 0.9 })
})

test('unwrapAvcc strips serve-sim stream envelopes', () => {
  const wrap = (tag, payload) => {
    const out = new Uint8Array(5 + payload.length)
    new DataView(out.buffer).setUint32(0, payload.length + 1)
    out[4] = tag
    out.set(payload, 5)
    return out
  }
  const avcc = [1, 0x64, 0, 0x1f, 0xff]
  const description = unwrapAvcc(wrap(1, avcc))
  assert.equal(description.kind, 'description')
  assert.deepEqual([...description.data], avcc)
  assert.equal(unwrapAvcc(wrap(2, [0, 0, 0, 1, 0x65])).kind, 'keyframe')
  assert.equal(unwrapAvcc(wrap(3, [0, 0, 0, 1, 0x41])).kind, 'delta')
  assert.equal(unwrapAvcc(wrap(4, [0xff, 0xd8])), null)
  assert.equal(unwrapAvcc(new Uint8Array([0, 0, 0, 9, 1, 2])), null)
  assert.equal(unwrapAvcc(new Uint8Array([0, 0, 0])), null)
})

test('keystrokesFor types US-keyboard text and refuses the rest', () => {
  assert.deepEqual(keystrokesFor('aZ1!'), [
    { usage: 4, shift: false },
    { usage: 29, shift: true },
    { usage: 30, shift: false },
    { usage: 30, shift: true }
  ])
  assert.equal(keystrokesFor('你好'), null)
})

/** The service over fake simctl and host calls, recording what reached each. */
function harness({ permission = 'workspace-write', allowed = [], shadowed = false } = {}) {
  const hub = { shadowed }
  const shots = mkdtempSync(join(tmpdir(), 'owlto-sim-'))
  const calls = []
  const needs = []
  const snapshots = []
  let devices = parseDevices(listJson)
  const settings = { enabled: true, allowedDevices: allowed }
  const service = new SimulatorService({
    platform: 'darwin',
    simctl: {
      list: async () => devices.map((d) => ({ ...d })),
      boot: async (udid) => {
        calls.push(['boot', udid])
        devices = devices.map((d) => (d.udid === udid ? { ...d, state: 'booted' } : d))
      },
      shutdown: async (udid) => calls.push(['shutdown', udid]),
      install: async (udid, path) => {
        calls.push(['install', udid, path])
        return { bundleId: 'com.example.demo', executable: 'Demo' }
      },
      launch: async (udid, bundleId) => {
        calls.push(['launch', udid, bundleId])
        return 99
      },
      openUrl: async (udid, url) => calls.push(['openUrl', udid, url]),
      copy: async (udid, text) => calls.push(['copy', udid, text]),
      logs: async (udid, seconds, process) => {
        calls.push(['logs', udid, seconds, process])
        return ['one', 'two', 'three']
      },
      inputShadowed: async () => hub.shadowed,
      repairInput: async (udid) => {
        calls.push(['repairInput', udid])
        hub.shadowed = false
      }
    },
    host: {
      attach: async (udid) => calls.push(['attach', udid]),
      detach: async (udid) => calls.push(['detach', udid]),
      touch: async (_udid, phase, x, y) => calls.push(['touch', phase, x, y]),
      key: async (_udid, phase, usage) => calls.push(['key', phase, usage]),
      button: async (_udid, name) => calls.push(['button', name]),
      snapshot: async (_udid, path) => path,
      ax: async () =>
        JSON.stringify([
          {
            type: 'Application',
            frame: { x: 0, y: 0, width: 400, height: 800 },
            children: [
              {
                type: 'Button',
                AXLabel: 'Go',
                frame: { x: 0, y: 0, width: 400, height: 80 },
                children: []
              }
            ]
          }
        ])
    },
    settings: () => settings,
    worker: (key) =>
      key === 'w1' || key === 'w2'
        ? { provider: 'codex', title: key === 'w1' ? 'Fix login' : 'Other', permission }
        : null,
    changed: (snapshot) => snapshots.push(snapshot),
    needs: (key, need) => needs.push([key, need?.kind ?? null]),
    shotsDir: () => shots,
    wait: async () => {}
  })
  return {
    service,
    calls,
    needs,
    snapshots,
    settings,
    cleanup: () => {
      service.close()
      rmSync(shots, { recursive: true, force: true })
    }
  }
}

test('a worker asks before its first device, then drives it through refs', async (t) => {
  const h = harness()
  t.after(h.cleanup)
  const attaching = h.service.attachForWorker('w1', 'iPad Air')
  await new Promise((resolve) => setImmediate(resolve))
  const ask = h.service.snapshot().ask
  assert.equal(ask.kind, 'device')
  assert.equal(ask.udid, PAD)
  assert.deepEqual(h.needs.at(-1), ['w1', 'device'])
  h.service.answer(ask.id, true)
  assert.match(await attaching, /Attached iPad Air/)
  assert.deepEqual(h.needs.at(-1), ['w1', null])
  assert.deepEqual(h.calls.slice(0, 2), [
    ['boot', PAD],
    ['attach', PAD]
  ])
  const snapshot = h.service.snapshot()
  assert.equal(snapshot.activeUdid, PAD)
  assert.equal(snapshot.leases[PAD].title, 'Fix login')

  const screen = await h.service.screen('w1', true, false)
  assert.match(screen, /400×800 points/)
  assert.match(screen, /@e1 Button "Go" at \(200, 40\)/)
  await h.service.tap('w1', { ref: '@e1' }, 60)
  assert.deepEqual(
    h.calls.filter((c) => c[0] === 'touch'),
    [
      ['touch', 'begin', 0.5, 0.05],
      ['touch', 'end', 0.5, 0.05]
    ]
  )
  await assert.rejects(h.service.tap('w1', { x: 500, y: 10 }, 60), /off the 400×800 point screen/)

  // Another worker cannot take the device the first one holds.
  await assert.rejects(h.service.attachForWorker('w2', PAD), /in use by another worker/)
  await assert.rejects(h.service.screen('w2', true, false), /Call simulator_attach first/)
})

test('Device Hub taking over input is reported, and repair reconnects the host', async (t) => {
  const h = harness({ allowed: [PHONE], shadowed: true })
  t.after(h.cleanup)
  const text = await h.service.attachForWorker('w1', 'iPhone 17 Pro')
  assert.match(text, /Device Hub/)
  assert.deepEqual(h.service.snapshot().inputBlocked, [PHONE])
  h.calls.length = 0
  await h.service.repairInput(PHONE)
  assert.deepEqual(h.calls, [
    ['repairInput', PHONE],
    ['detach', PHONE],
    ['attach', PHONE]
  ])
  assert.deepEqual(h.service.snapshot().inputBlocked, [])
})

test('install waits for approval below full access; full access goes straight through', async (t) => {
  const h = harness({ allowed: [PHONE] })
  t.after(h.cleanup)
  await h.service.attachForWorker('w1', undefined)
  assert.equal(h.service.snapshot().activeUdid, PHONE, 'picks the booted device')
  assert.equal(
    h.calls.some((c) => c[0] === 'boot'),
    false
  )

  const installing = h.service.install('w1', '/tmp/Demo.app', true, [])
  await new Promise((resolve) => setImmediate(resolve))
  const ask = h.service.snapshot().ask
  assert.equal(ask.kind, 'install')
  assert.equal(ask.detail, '/tmp/Demo.app')
  h.service.answer(ask.id, true)
  assert.match(await installing, /Installed and launched com.example.demo \(pid 99\)/)
  // The app it installed launches again without asking.
  assert.match(await h.service.launch('w1', 'com.example.demo', [], true), /Launched/)

  const opening = h.service.openUrl('w1', 'demo://x')
  await new Promise((resolve) => setImmediate(resolve))
  h.service.answer(h.service.snapshot().ask.id, false)
  await assert.rejects(opening, /declined/)

  assert.match(
    await h.service.logs('w1', 'com.example.demo', 30, 2),
    /\(1 earlier line left out\)\ntwo\nthree/
  )
  assert.deepEqual(h.calls.at(-1), ['logs', PHONE, 30, 'Demo'])

  const full = harness({ permission: 'full-access', allowed: [PHONE] })
  t.after(full.cleanup)
  await full.service.attachForWorker('w1', undefined)
  assert.match(await full.service.openUrl('w1', 'demo://y'), /Opened demo:\/\/y/)
  assert.equal(full.service.snapshot().ask, null)
})

test('typing pastes text a US keyboard cannot type', async (t) => {
  const h = harness({ allowed: [PHONE] })
  t.after(h.cleanup)
  await h.service.attachForWorker('w1', undefined)
  await h.service.type('w1', 'Hi', true)
  assert.deepEqual(
    h.calls.filter((c) => c[0] === 'key').map((c) => `${c[1]}${c[2]}`),
    ['down225', 'down11', 'up11', 'up225', 'down12', 'up12', 'down40', 'up40']
  )
  h.calls.length = 0
  assert.match(await h.service.type('w1', '你好', false), /Pasted/)
  assert.deepEqual(h.calls[0], ['copy', PHONE, '你好'])
})

test('the simulator tools are sorted and validate their input', async () => {
  const seen = []
  const tools = simulatorTools(
    {
      tap: async (key, target, duration) => {
        seen.push([key, target, duration])
        return 'Tapped.'
      }
    },
    'w9'
  )
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names, [...names].sort())
  const tap = tools.find((tool) => tool.name === 'simulator_tap')
  assert.deepEqual(await tap.call({ ref: '@e2' }), { ok: true, text: 'Tapped.' })
  assert.deepEqual(seen, [['w9', { ref: '@e2' }, 60]])
  assert.equal((await tap.call({ x: 3 })).ok, false)
  assert.equal((await tap.call({ ref: 'e2' })).ok, false)
})
