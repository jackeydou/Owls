import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { openSqlite } from '../fixtures/sqlite.mjs'

const require = createRequire(import.meta.url)
const { CardService, CardStore, OwlsStore } = require('../../out/main/app/runtime.js')

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations')
const PROJECTS = [{ id: 'p1', name: 'Owls', path: '/tmp/owls' }]
const NOW = new Date('2026-11-12T12:00:00.000Z')

function setup(t, content = () => assert.fail('no capture expected')) {
  const dir = mkdtempSync(join(tmpdir(), 'owls-cards-'))
  const client = openSqlite(join(dir, 'owls.db'))
  t.after(() => {
    client.close()
    rmSync(dir, { recursive: true, force: true })
  })
  let changes = 0
  const service = new CardService({
    store: new CardStore(new OwlsStore(client, MIGRATIONS)),
    projects: () => PROJECTS,
    content,
    changed: () => changes++,
    now: () => NOW
  })
  return { service, changes: () => changes }
}
const add = (service, title, body = '', extra = {}) =>
  service.save({ action: 'add', title, body, tags: [], projectId: null, ...extra })

test('cards save, update, and delete as versioned records', (t) => {
  const { service, changes } = setup(t)
  const card = add(service, 'OAuth refresh', 'Rotate tokens.', {
    tags: ['b', 'a'],
    projectId: 'p1'
  })
  assert.match(card.id, /^c_[0-9a-f]{12}$/)
  assert.equal(card.source, null)
  const updated = service.save({
    action: 'update',
    id: card.id,
    title: 'OAuth refresh tokens',
    body: 'Rotate on every use.',
    tags: ['auth'],
    projectId: null
  })
  assert.ok(updated.rev > card.rev, 'every change takes the next version')
  assert.equal(updated.createdAt, card.createdAt)
  assert.deepEqual(service.library().cards, [updated])
  service.remove(card.id)
  assert.deepEqual(service.library().cards, [])
  assert.throws(() => service.remove(card.id), { code: 'request_unavailable' })
  assert.throws(() => add(service, 'Lost', '', { projectId: 'gone' }), { code: 'project_required' })
  assert.equal(changes(), 3)
})

test('a captured card freezes the source text and records where it came from', (t) => {
  const sources = []
  const { service } = setup(t, (source) => {
    sources.push(source)
    return {
      text: 'Use refresh token rotation.',
      source: {
        kind: 'message',
        threadId: 't1',
        threadTitle: 'Login',
        itemId: 'i1',
        workerId: null
      }
    }
  })
  const source = { kind: 'item', routerId: crypto.randomUUID(), itemId: 'i1' }
  const card = service.capture({ source, title: 'Refresh plan', tags: ['auth'], projectId: 'p1' })
  assert.deepEqual(sources, [source])
  assert.equal(card.body, 'Use refresh token rotation.')
  assert.deepEqual(card.source, {
    kind: 'message',
    threadId: 't1',
    threadTitle: 'Login',
    itemId: 'i1',
    workerId: null
  })
})

test('boards keep one place per live card, and a deleted card leaves every board', (t) => {
  const { service } = setup(t)
  const a = add(service, 'A')
  const b = add(service, 'B')
  const board = service.saveBoard({ action: 'add', name: 'Login', projectId: 'p1' })
  const placed = service.saveBoard({
    action: 'place',
    id: board.id,
    placements: [
      { cardId: a.id, x: 0, y: 0 },
      { cardId: b.id, x: 300, y: 0 },
      { cardId: a.id, x: 40, y: 40 },
      { cardId: 'c_missing', x: 0, y: 0 }
    ]
  })
  assert.deepEqual(placed.placements, [
    { cardId: a.id, x: 40, y: 40 },
    { cardId: b.id, x: 300, y: 0 }
  ])
  service.remove(a.id)
  assert.deepEqual(service.library().boards[0].placements, [{ cardId: b.id, x: 300, y: 0 }])
  service.removeBoard(board.id)
  assert.deepEqual(service.library().boards, [])
  assert.throws(
    () => service.saveBoard({ action: 'rename', id: board.id, name: 'X', projectId: null }),
    {
      code: 'request_unavailable'
    }
  )
})

test('attaching freezes cards in order and refuses missing or oversized ones', (t) => {
  const { service } = setup(t)
  const a = add(service, 'A', 'alpha')
  const b = add(service, 'B', 'beta')
  assert.deepEqual(
    service.attach([b.id, a.id, b.id]).map((card) => [card.id, card.body]),
    [
      [b.id, 'beta'],
      [a.id, 'alpha']
    ]
  )
  assert.throws(() => service.attach(['c_gone']), { code: 'request_unavailable' })
  const big = add(service, 'Big', 'x'.repeat(16_000))
  const bigger = add(service, 'Bigger', 'y'.repeat(16_000))
  assert.throws(() => service.attach([big.id, bigger.id]), { code: 'invalid_request' })
})
