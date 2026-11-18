import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  isLocalHref,
  layoutSettingsSchema,
  looksLikeFilePath,
  OPEN_IN_CATALOG,
  OpenInApps,
  parseFileRef,
  previewFileRef
} = require('../../out/main/app/runtime.js')

function tempFolder(t) {
  const root = mkdtempSync(join(tmpdir(), 'owlto-file-preview-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('a reference splits into its path and the line it points at', () => {
  assert.deepEqual(parseFileRef('src/main/app/ipc.ts:134'), {
    path: 'src/main/app/ipc.ts',
    line: 134
  })
  assert.deepEqual(parseFileRef('src/a.ts:12:4'), { path: 'src/a.ts', line: 12 })
  assert.deepEqual(parseFileRef('README.md#L7-L9'), { path: 'README.md', line: 7 })
  assert.deepEqual(parseFileRef('file:///tmp/My%20Notes.md'), {
    path: '/tmp/My Notes.md',
    line: null
  })
  assert.deepEqual(parseFileRef('notes.md'), { path: 'notes.md', line: null })
})

test('file paths are told apart from code, branches, and web links', () => {
  for (const text of [
    'src/main/app/ipc.ts:134',
    'package.json',
    './scripts/run',
    '~/notes/a.md',
    '/Users/me/project',
    'file:///tmp/x.txt',
    'apps/owlto-client/src'
  ])
    assert.equal(looksLikeFilePath(text), true, text)
  for (const text of [
    'window.open',
    'origin/main',
    'and/or',
    'https://example.com/a.ts',
    'pnpm dev',
    'owlto:router-items',
    '#worker-w_1',
    'Record<string, number>'
  ])
    assert.equal(looksLikeFilePath(text), false, text)
  assert.equal(isLocalHref('docs/guide'), true)
  assert.equal(isLocalHref('https://owlto.dev'), false)
  assert.equal(isLocalHref('mailto:a@b.c'), false)
  assert.equal(isLocalHref('#section'), false)
})

test('a relative path is found under the first base that has it, and read as text', async (t) => {
  const root = tempFolder(t)
  const worktree = join(root, 'worktree')
  const project = join(root, 'project')
  mkdirSync(join(worktree, 'src'), { recursive: true })
  mkdirSync(join(project, 'src'), { recursive: true })
  writeFileSync(join(worktree, 'src', 'a.ts'), 'export const where = "worktree"\n')
  writeFileSync(join(project, 'src', 'a.ts'), 'export const where = "project"\n')
  const roots = [
    { path: project, name: 'project' },
    { path: worktree, name: 'worktree' }
  ]
  const result = await previewFileRef('src/a.ts:1', [worktree, project], roots)
  assert.equal(result.status, 'ok')
  assert.equal(result.preview.label, 'worktree/src/a.ts')
  assert.equal(result.preview.line, 1)
  assert.deepEqual(result.preview.body, {
    kind: 'text',
    text: 'export const where = "worktree"\n',
    truncated: false
  })
  assert.deepEqual(await previewFileRef('src/missing.ts', [worktree, project], roots), {
    status: 'missing',
    ref: 'src/missing.ts'
  })
})

test('files outside every root are not read, even through a symlink', async (t) => {
  const root = tempFolder(t)
  const project = join(root, 'project')
  const secret = join(root, 'secret.txt')
  mkdirSync(project)
  writeFileSync(secret, 'token')
  symlinkSync(secret, join(project, 'link.txt'))
  const roots = [{ path: project, name: 'project' }]
  const direct = await previewFileRef(secret, [], roots)
  assert.equal(direct.status, 'outside')
  const linked = await previewFileRef('link.txt', [project], roots)
  assert.equal(linked.status, 'outside')
})

test('images, binaries, and folders get their own preview kinds', async (t) => {
  const root = tempFolder(t)
  mkdirSync(join(root, 'b-folder'))
  writeFileSync(join(root, 'pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(root, 'data.bin'), Buffer.from([1, 0, 2, 0]))
  const roots = [{ path: root, name: 'root' }]
  const image = await previewFileRef(join(root, 'pixel.png'), [], roots)
  assert.equal(image.preview.body.kind, 'image')
  assert.match(image.preview.body.dataUrl, /^data:image\/png;base64,/)
  const binary = await previewFileRef(join(root, 'data.bin'), [], roots)
  assert.deepEqual(binary.preview.body, { kind: 'binary' })
  const folder = await previewFileRef(root, [], roots)
  assert.deepEqual(
    folder.preview.body.entries.map((entry) => entry.name),
    ['b-folder', 'data.bin', 'pixel.png']
  )
})

test('opening a file goes to the editor; a terminal opens its folder', async () => {
  const opened = []
  const os = {
    platform: 'darwin',
    home: '/Users/me',
    exists: async (path) =>
      [
        '/Applications/Cursor.app',
        '/System/Applications/Utilities/Terminal.app',
        '/repo/a.ts'
      ].includes(path),
    spotlight: async () => [],
    icon: async () => null,
    isFolder: async (path) => path === '/repo',
    open: async (appPath, target) => {
      opened.push([appPath, target])
    }
  }
  assert.ok(OPEN_IN_CATALOG.some((entry) => entry.id === 'terminal'))
  const apps = new OpenInApps(os)
  await apps.openFile('cursor', '/repo/a.ts')
  await apps.openFile('terminal', '/repo/a.ts')
  assert.deepEqual(opened, [
    ['/Applications/Cursor.app', '/repo/a.ts'],
    ['/System/Applications/Utilities/Terminal.app', '/repo']
  ])
  await assert.rejects(apps.openFile('cursor', '/repo/gone.ts'))
})

test('the file viewer tab and its width are kept in the layout', () => {
  const layout = layoutSettingsSchema.parse({
    sidebarWidth: null,
    projectsWidth: null,
    panelWidth: null,
    projectsOpen: true,
    rightPanel: 'files',
    filesWidth: 640
  })
  assert.equal(layout.rightPanel, 'files')
  assert.equal(layout.filesWidth, 640)
})
