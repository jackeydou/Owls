import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { openSqlite } from '../fixtures/sqlite.mjs'

const require = createRequire(import.meta.url)
const {
  CardService,
  CardStore,
  createICloudAccess,
  NOTES_ICLOUD_CONTAINER,
  NotesStorageService,
  OwltoStore
} = require('../../out/main/app/runtime.js')

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations')
const NOW = new Date('2026-11-24T12:00:00.000Z')

/** A Mac with notes in `local`, and an iCloud container at `container` when `icloud` is on. */
function setup(t, { icloud = 'available' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'owlto-notes-storage-'))
  const client = openSqlite(join(dir, 'owlto.db'))
  t.after(() => {
    client.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const local = join(dir, 'Owlto', 'Notes')
  const container = join(dir, 'Mobile Documents', 'iCloud~dev~owlto~app')
  const icloudNotes = join(container, 'Documents', 'Notes')
  let location = 'local'
  const folders = []
  const downloads = []
  const access = {
    status: async () =>
      icloud === 'available'
        ? { icloud: { status: 'available' }, container }
        : { icloud: { status: 'unavailable', reason: icloud }, container: null },
    startDownloading: (path) => downloads.push(path)
  }
  const storage = new NotesStorageService({
    localFolder: local,
    icloud: access,
    location: () => location,
    saveLocation: (next) => {
      location = next
    },
    folderChanged: (folder) => folders.push(folder),
    expectedContainer: container
  })
  const store = new CardStore(new OwltoStore(client, MIGRATIONS), storage.startFolder(), () => NOW)
  let changes = 0
  const cards = new CardService({
    store,
    projects: () => [],
    content: () => assert.fail('no capture expected'),
    changed: () => changes++,
    now: () => NOW
  })
  return {
    storage,
    cards,
    local,
    icloudNotes,
    folders,
    downloads,
    location: () => location,
    changes: () => changes
  }
}
const add = (cards, title, body = '') =>
  cards.save({ action: 'add', title, body, tags: [], projectId: null })
const notes = (folder) =>
  readdirSync(folder)
    .filter((name) => !name.startsWith('.'))
    .sort()

test('turning iCloud on moves the notes and keeps their ids and board places', async (t) => {
  const { storage, cards, local, icloudNotes, folders, location } = setup(t)
  await storage.start(cards)
  cards.watch()
  t.after(() => cards.close())
  const plan = add(cards, 'Plan', 'v1')
  const board = cards.saveBoard({ action: 'add', name: 'B', projectId: null })
  cards.saveBoard({
    action: 'place',
    id: board.id,
    placements: [{ cardId: plan.id, x: 10, y: 20 }]
  })
  // The other device already put a note with the same name in iCloud.
  mkdirSync(icloudNotes, { recursive: true })
  writeFileSync(
    join(icloudNotes, 'Plan.md'),
    '---\nid: c_otherdevice1\ntitle: Plan\n---\nfrom the iPhone\n'
  )

  const result = await storage.setLocation('icloud')
  assert.equal(result.result, 'moved')
  assert.equal(result.moved, 1)
  assert.equal(location(), 'icloud')
  assert.deepEqual(folders, [icloudNotes], 'agents read the new folder')
  assert.equal(result.storage.folder, icloudNotes)
  assert.deepEqual(notes(local), [], 'nothing stays behind on this Mac')
  assert.deepEqual(
    notes(icloudNotes),
    ['Plan 2.md', 'Plan.md'],
    'a clash arrives under a free name'
  )

  const library = cards.library()
  assert.deepEqual(library.cards.map((c) => c.body).sort(), ['from the iPhone\n', 'v1'])
  assert.equal(
    library.cards.find((c) => c.body === 'v1').id,
    plan.id,
    'the moved note keeps its id'
  )
  assert.deepEqual(library.boards[0].placements, [{ cardId: plan.id, x: 10, y: 20 }])
  assert.equal(cards.folder(), icloudNotes)
  assert.equal(storage.startFolder(), icloudNotes, 'the next launch opens the iCloud folder')
})

test('turning iCloud off copies the notes back and leaves the iCloud files', async (t) => {
  const { storage, cards, local, icloudNotes, downloads, location } = setup(t)
  await storage.start(cards)
  add(cards, 'Kept', 'body')
  await storage.setLocation('icloud')
  // iCloud evicted a note this Mac has not opened.
  writeFileSync(join(icloudNotes, '.Trip.md.icloud'), 'placeholder')

  const waiting = await storage.setLocation('local')
  assert.equal(waiting.result, 'downloading')
  assert.equal(waiting.pending, 1)
  assert.equal(location(), 'icloud', 'nothing switched while a note is missing')
  assert.deepEqual(downloads, [join(icloudNotes, 'Trip.md')])

  rmSync(join(icloudNotes, '.Trip.md.icloud'))
  writeFileSync(join(icloudNotes, 'Trip.md'), 'pack\n')
  const done = await storage.setLocation('local')
  assert.equal(done.result, 'moved')
  assert.equal(location(), 'local')
  assert.deepEqual(notes(local), ['Kept.md', 'Trip.md'])
  assert.deepEqual(notes(icloudNotes), ['Kept.md', 'Trip.md'], 'other devices keep their notes')
  assert.equal(
    readFileSync(join(local, 'Kept.md'), 'utf8'),
    readFileSync(join(icloudNotes, 'Kept.md'), 'utf8')
  )
  assert.deepEqual(
    cards
      .library()
      .cards.map((c) => c.title)
      .sort(),
    ['Kept', 'Trip']
  )
})

test('iCloud that is not available refuses the switch and moves nothing', async (t) => {
  const { storage, cards, local } = setup(t, { icloud: 'not_entitled' })
  await storage.start(cards)
  add(cards, 'Stay')
  const status = await storage.storage()
  assert.deepEqual(status.icloud, { status: 'unavailable', reason: 'not_entitled' })
  assert.equal(status.location, 'local')
  await assert.rejects(storage.setLocation('icloud'), { code: 'request_unavailable' })
  assert.deepEqual(notes(local), ['Stay.md'])
})

test('the iCloud helper reports why it cannot be used', async () => {
  const unsupported = await createICloudAccess(() => ({ reason: 'unsupported' })).status()
  assert.deepEqual(unsupported.icloud, { status: 'unavailable', reason: 'unsupported' })
  const missing = await createICloudAccess(() => ({ reason: 'helper_missing' })).status()
  assert.deepEqual(missing.icloud, { status: 'unavailable', reason: 'helper_missing' })
  const binding = (signedIn, container) => ({
    binding: {
      identityAvailable: () => signedIn,
      containerPath: async (id) => {
        assert.equal(id, NOTES_ICLOUD_CONTAINER)
        return container
      },
      startDownloading: () => {}
    }
  })
  const signedOut = await createICloudAccess(() => binding(false, '/c')).status()
  assert.deepEqual(signedOut.icloud, { status: 'unavailable', reason: 'signed_out' })
  const noEntitlement = await createICloudAccess(() => binding(true, null)).status()
  assert.deepEqual(noEntitlement.icloud, { status: 'unavailable', reason: 'not_entitled' })
  const ready = await createICloudAccess(() => binding(true, '/c')).status()
  assert.deepEqual(ready, { icloud: { status: 'available' }, container: '/c' })
  assert.ok(!existsSync('/c'))
})
