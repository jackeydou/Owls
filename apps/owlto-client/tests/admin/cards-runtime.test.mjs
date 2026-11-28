import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { openSqlite } from '../fixtures/sqlite.mjs'

const require = createRequire(import.meta.url)
const { CardService, CardStore, OwltoStore } = require('../../out/main/app/runtime.js')

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations')
const PROJECTS = [{ id: 'p1', name: 'Owlto', path: '/tmp/owlto' }]
const NOW = new Date('2026-11-12T12:00:00.000Z')

function setup(t, content = () => assert.fail('no capture expected')) {
  const dir = mkdtempSync(join(tmpdir(), 'owlto-cards-'))
  const client = openSqlite(join(dir, 'owlto.db'))
  t.after(() => {
    client.close()
    rmSync(dir, { recursive: true, force: true })
  })
  let changes = 0
  const notes = join(dir, 'notes')
  const store = new CardStore(new OwltoStore(client, MIGRATIONS), notes, () => NOW)
  const service = new CardService({
    store,
    projects: () => PROJECTS,
    content,
    changed: () => changes++,
    now: () => NOW
  })
  return { service, store, notes, changes: () => changes }
}
const files = (notes) =>
  readdirSync(notes)
    .filter((name) => !name.startsWith('.'))
    .sort()
/** Writes a file as another app would, with a later modified time so a scan sees it. */
function writeElsewhere(path, content) {
  writeFileSync(path, content)
  const later = new Date(Date.now() + 5_000)
  utimesSync(path, later, later)
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
  service.remove([card.id])
  assert.deepEqual(service.library().cards, [])
  assert.throws(() => service.remove([card.id]), { code: 'request_unavailable' })
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
  service.remove([a.id])
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

test('deleting several notes removes their files and board places, all or none', (t) => {
  const { service, notes, changes } = setup(t)
  const a = add(service, 'A')
  const b = add(service, 'B')
  const c = add(service, 'C')
  const board = service.saveBoard({ action: 'add', name: 'Plan', projectId: null })
  service.saveBoard({
    action: 'place',
    id: board.id,
    placements: [
      { cardId: a.id, x: 0, y: 0 },
      { cardId: b.id, x: 300, y: 0 },
      { cardId: c.id, x: 600, y: 0 }
    ]
  })
  const before = changes()
  assert.throws(() => service.remove([a.id, 'c_missing']), { code: 'request_unavailable' })
  assert.deepEqual(files(notes), ['A.md', 'B.md', 'C.md'], 'a missing id deletes nothing')
  assert.equal(changes(), before)
  service.remove([a.id, c.id])
  assert.deepEqual(files(notes), ['B.md'])
  assert.deepEqual(
    service.library().cards.map((card) => card.id),
    [b.id]
  )
  assert.deepEqual(service.library().boards[0].placements, [{ cardId: b.id, x: 300, y: 0 }])
  assert.equal(changes(), before + 1, 'one delete is one change')
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

test('each note is a Markdown file with YAML frontmatter, named after its title', (t) => {
  const { service, notes } = setup(t)
  const card = add(service, 'OAuth: refresh?', '# Plan\n\nRotate tokens.\n', {
    tags: ['a', 'b'],
    projectId: 'p1'
  })
  assert.deepEqual(files(notes), ['OAuth refresh.md'])
  assert.equal(
    readFileSync(join(notes, 'OAuth refresh.md'), 'utf8'),
    [
      '---',
      `id: ${card.id}`,
      'title: "OAuth: refresh?"',
      'tags: [ a, b ]',
      'project: p1',
      `created: ${NOW.toISOString()}`,
      `updated: ${NOW.toISOString()}`,
      '---',
      '# Plan',
      '',
      'Rotate tokens.',
      ''
    ].join('\n')
  )
  const same = add(service, 'OAuth refresh', '')
  assert.deepEqual(files(notes), ['OAuth refresh 2.md', 'OAuth refresh.md'])
  service.save({
    action: 'update',
    id: same.id,
    title: 'Tokens',
    body: 'x',
    tags: [],
    projectId: null
  })
  assert.deepEqual(files(notes), ['OAuth refresh.md', 'Tokens.md'])
  service.remove([same.id])
  assert.deepEqual(files(notes), ['OAuth refresh.md'])
})

test('edits, renames, copies, and deletions made outside the app are picked up', (t) => {
  const { service, store, notes } = setup(t)
  const card = add(service, 'Plan', 'v1')
  const board = service.saveBoard({ action: 'add', name: 'B', projectId: null })
  service.saveBoard({
    action: 'place',
    id: board.id,
    placements: [{ cardId: card.id, x: 0, y: 0 }]
  })
  assert.equal(store.scan(), false, 'the app’s own writes are not outside changes')

  const path = join(notes, 'Plan.md')
  writeElsewhere(path, readFileSync(path, 'utf8').replace('v1', 'v2'))
  assert.equal(store.scan(), true)
  const edited = service.library().cards[0]
  assert.equal(edited.body, 'v2')
  assert.ok(edited.rev > card.rev)

  renameSync(path, join(notes, 'My plan.md'))
  store.scan()
  assert.deepEqual(
    service.library().cards.map((c) => [c.id, c.title]),
    [[card.id, 'Plan']],
    'a renamed file keeps its id'
  )
  service.save({
    action: 'update',
    id: card.id,
    title: 'Plan',
    body: 'v3',
    tags: [],
    projectId: null
  })
  assert.deepEqual(
    files(notes),
    ['My plan.md'],
    'a name the user picked stays until the title changes'
  )

  writeElsewhere(join(notes, 'Copy.md'), readFileSync(join(notes, 'My plan.md'), 'utf8'))
  writeElsewhere(join(notes, 'Idea.md'), 'Just a thought.\n')
  store.scan()
  const cards = service.library().cards
  assert.equal(cards.length, 3)
  assert.equal(new Set(cards.map((c) => c.id)).size, 3, 'a copied file gets its own id')
  const idea = cards.find((c) => c.title === 'Idea')
  assert.equal(idea.body, 'Just a thought.\n')
  assert.match(readFileSync(join(notes, 'Idea.md'), 'utf8'), new RegExp(`^---\nid: ${idea.id}\n`))
  assert.equal(cards.find((c) => c.id === card.id).body, 'v3', 'the original keeps its id')

  unlinkSync(join(notes, 'My plan.md'))
  assert.equal(store.scan(), true)
  assert.ok(!service.library().cards.some((c) => c.id === card.id))
  assert.deepEqual(service.library().boards[0].placements, [], 'a deleted file leaves every board')
  assert.throws(() => service.attach([card.id]), { code: 'request_unavailable' })
})

test('the index is rebuilt from the files alone', (t) => {
  const { service, notes } = setup(t)
  const card = add(service, 'Kept', 'body', { tags: ['x'] })
  const dir = mkdtempSync(join(tmpdir(), 'owlto-cards-index-'))
  const client = openSqlite(join(dir, 'owlto.db'))
  t.after(() => {
    client.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const fresh = new CardStore(new OwltoStore(client, MIGRATIONS), notes)
  const [read] = fresh.cards()
  assert.deepEqual(
    { ...read, rev: card.rev },
    card,
    'every field comes back from the Markdown file'
  )
  assert.ok(existsSync(join(notes, 'Kept.md')))
})

test('an agent note is written as a Markdown file and falls back to no project', (t) => {
  const { service, notes, changes } = setup(t)
  const source = {
    kind: 'worker',
    threadId: 't1',
    threadTitle: 'Login',
    itemId: null,
    workerId: 'w_1'
  }
  const card = service.addFromAgent({
    title: 'Findings',
    body: '- Token expires after 1h',
    tags: ['b', 'a', 'b'],
    projectId: 'p1',
    source
  })
  assert.deepEqual(card.tags, ['a', 'b'])
  assert.equal(card.projectId, 'p1')
  assert.deepEqual(card.source, source)
  assert.deepEqual(files(notes), ['Findings.md'])
  const orphan = service.addFromAgent({
    title: 'Elsewhere',
    body: 'x',
    tags: [],
    projectId: 'gone',
    source
  })
  assert.equal(orphan.projectId, null, 'a removed project does not fail the save')
  assert.equal(changes(), 2)
})

test('an agent edits a note by find-and-replace or a whole new body, all or none', (t) => {
  const { service, store, notes } = setup(t)
  const source = {
    kind: 'message',
    threadId: 't1',
    threadTitle: 'Plan',
    itemId: null,
    workerId: null
  }
  const card = service.addFromAgent({
    title: 'Plan',
    body: '- step one\n- step two\n- step two',
    tags: ['a'],
    projectId: 'p1',
    source
  })
  const edited = service.editFromAgent({
    id: card.id,
    edits: [
      { oldText: 'step one', newText: 'first step' },
      { oldText: 'step two', newText: 'next', replaceAll: true }
    ],
    tags: ['z', 'b', 'z']
  })
  assert.equal(edited.body, '- first step\n- next\n- next')
  assert.deepEqual(edited.tags, ['b', 'z'])
  assert.equal(edited.title, 'Plan', 'fields left out stay')
  assert.deepEqual(edited.source, source, 'the note keeps where it came from')
  assert.equal(edited.projectId, 'p1')
  assert.match(readFileSync(join(notes, 'Plan.md'), 'utf8'), /- first step/)

  const before = store.card(card.id).body
  assert.throws(
    () =>
      service.editFromAgent({
        id: card.id,
        edits: [
          { oldText: 'first step', newText: 'one' },
          { oldText: 'missing', newText: 'x' }
        ]
      }),
    { code: 'invalid_request', message: 'Edit 2: oldText was not found in the note.' }
  )
  assert.throws(
    () => service.editFromAgent({ id: card.id, edits: [{ oldText: 'next', newText: 'x' }] }),
    { code: 'invalid_request', message: /occurs 2 times/ }
  )
  assert.equal(store.card(card.id).body, before, 'a failed edit changes nothing')
  assert.throws(() => service.editFromAgent({ id: card.id }), { code: 'invalid_request' })
  assert.throws(
    () =>
      service.editFromAgent({ id: card.id, body: 'x', edits: [{ oldText: 'a', newText: 'b' }] }),
    { code: 'invalid_request' }
  )
  assert.throws(() => service.editFromAgent({ id: 'c_gone', body: 'x' }), {
    code: 'request_unavailable'
  })

  const renamed = service.editFromAgent({
    id: card.id,
    title: 'Roadmap',
    body: 'New text with $& kept'
  })
  assert.equal(renamed.body, 'New text with $& kept')
  assert.deepEqual(files(notes), ['Roadmap.md'], 'a new title renames the file')
  const literal = service.editFromAgent({
    id: card.id,
    edits: [{ oldText: 'New', newText: '$&$&' }]
  })
  assert.equal(literal.body, '$&$& text with $& kept', 'replacement text is literal')
})

test('a note iCloud has not downloaded stays, with its name and its board place', (t) => {
  const { service, store, notes } = setup(t)
  const card = add(service, 'Trip', 'pack')
  const other = add(service, 'Other')
  const board = service.saveBoard({ action: 'add', name: 'B', projectId: null })
  service.saveBoard({
    action: 'place',
    id: board.id,
    placements: [
      { cardId: card.id, x: 0, y: 0 },
      { cardId: other.id, x: 300, y: 0 }
    ]
  })
  const content = readFileSync(join(notes, 'Trip.md'), 'utf8')
  // iCloud evicts the file, leaving a hidden placeholder.
  unlinkSync(join(notes, 'Trip.md'))
  writeFileSync(join(notes, '.Trip.md.icloud'), 'placeholder')
  store.scan()
  assert.equal(service.library().cards.find((c) => c.id === card.id)?.body, 'pack')
  assert.equal(add(service, 'Trip').title, 'Trip')
  assert.ok(existsSync(join(notes, 'Trip 2.md')), 'a new note does not take the evicted name')

  // Gone for real: hidden on the board, but a restored file lands where it was.
  unlinkSync(join(notes, '.Trip.md.icloud'))
  store.scan()
  assert.ok(!service.library().cards.some((c) => c.id === card.id))
  assert.deepEqual(
    service.library().boards[0].placements.map((p) => p.cardId),
    [other.id]
  )
  service.saveBoard({
    action: 'place',
    id: board.id,
    placements: [{ cardId: other.id, x: 600, y: 0 }]
  })
  writeElsewhere(join(notes, 'Trip.md'), content)
  store.scan()
  assert.deepEqual(service.library().boards[0].placements, [
    { cardId: card.id, x: 0, y: 0 },
    { cardId: other.id, x: 600, y: 0 }
  ])
})

test('two devices give a conflict copy or a hand-written note the same id', (t) => {
  const { service, notes } = setup(t)
  add(service, 'Plan', 'v1')
  const original = readFileSync(join(notes, 'Plan.md'), 'utf8')
  const copy = original.replace('v1', 'v2')
  const handWritten = '---\ntitle: Idea\ntags: [a]\n---\nJust a thought.\n'
  writeElsewhere(join(notes, 'Plan 2.md'), copy)
  writeElsewhere(join(notes, 'Idea.md'), handWritten)
  service.library()
  const first = {
    copy: readFileSync(join(notes, 'Plan 2.md'), 'utf8'),
    idea: readFileSync(join(notes, 'Idea.md'), 'utf8')
  }

  // A second device with its own index reads the same files as they arrived.
  const dir = mkdtempSync(join(tmpdir(), 'owlto-cards-device-'))
  const client = openSqlite(join(dir, 'owlto.db'))
  t.after(() => {
    client.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const otherNotes = join(dir, 'notes')
  const other = new CardStore(new OwltoStore(client, MIGRATIONS), otherNotes)
  other.cards()
  writeFileSync(join(otherNotes, 'Plan.md'), original)
  other.scan()
  writeFileSync(join(otherNotes, 'Plan 2.md'), copy)
  writeFileSync(join(otherNotes, 'Idea.md'), handWritten)
  other.scan()
  assert.equal(readFileSync(join(otherNotes, 'Idea.md'), 'utf8'), first.idea)
  assert.equal(readFileSync(join(otherNotes, 'Plan 2.md'), 'utf8'), first.copy)
  assert.match(
    first.idea,
    /^---\nid: c_[0-9a-f]{12}\ntitle: Idea\ntags: \[a\]\n---\nJust a thought\.\n$/,
    'only the id is added'
  )
  const withoutId = (text) => text.replace(/^---\nid: \S+\n/, '')
  assert.notEqual(first.copy, copy, 'the copy got its own id')
  assert.equal(withoutId(first.copy), withoutId(copy), 'only the id changed')
})
