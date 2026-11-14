import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  WORKSPACE_ID,
  isWithin,
  isWorkspaceProject,
  listWorkspaceFolders,
  normalizePath,
  promotableFolders,
  workerHome,
  workspaceChild
} = require('../../out/main/app/runtime.js')

const project = (id, path) => ({ id, name: id, path, settings: {} })
const worker = (fields = {}) => ({
  id: 'w1',
  projectId: null,
  status: 'reported',
  report: null,
  ...fields
})
const files = (...refs) => ({
  status: 'done',
  summary: 'Done.',
  artifacts: refs.map((ref) => ({ kind: 'file', ref }))
})

test('paths compare by whole segments after normalizing', () => {
  assert.equal(normalizePath('/a/b/../c/./d/'), '/a/c/d')
  assert.equal(normalizePath('C:\\Users\\me\\ws\\'), 'C:/Users/me/ws')
  assert.equal(isWithin('/ws/app/src', '/ws/app'), true)
  assert.equal(isWithin('/ws/app', '/ws/app'), true)
  assert.equal(isWithin('/ws/apple', '/ws/app'), false)
})

test('a worker counts under its project, the nearest workspace project, or the Workspace', () => {
  const ws = '/home/me/Owlto/Workspace'
  const projects = [
    project('outside', '/home/me/code/site'),
    project('app', `${ws}/app`),
    project('nested', `${ws}/app/packages/ui`),
    // A project at the workspace itself never swallows the Workspace's work.
    project('root', ws)
  ]
  assert.equal(workerHome(worker({ projectId: 'outside' }), projects, ws), 'outside')
  // A project that is gone was merged back into the Workspace.
  assert.equal(workerHome(worker({ projectId: 'gone' }), projects, ws), WORKSPACE_ID)
  assert.equal(workerHome(worker(), projects, ws), WORKSPACE_ID)
  assert.equal(
    workerHome(worker({ report: files(`${ws}/notes/a.md`) }), projects, ws),
    WORKSPACE_ID
  )
  assert.equal(
    workerHome(worker({ report: files(`${ws}/app/README.md`, 'app/src/index.ts') }), projects, ws),
    'app'
  )
  assert.equal(
    workerHome(worker({ report: files(`file://${ws}/app/packages/ui/button.tsx`) }), projects, ws),
    'nested'
  )
  // Files spread over two places stay in the Workspace.
  assert.equal(
    workerHome(worker({ report: files('app/a.ts', 'notes/b.md') }), projects, ws),
    WORKSPACE_ID
  )
  // Files outside the workspace say nothing about it.
  assert.equal(
    workerHome(worker({ report: files('/tmp/x.txt', `${ws}/app/a.ts`) }), projects, ws),
    'app'
  )
  assert.equal(workerHome(worker({ report: files('app/a.ts') }), projects, null), WORKSPACE_ID)
})

test('workspace folders list git repositories and projects, and only direct children promote', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'owlto-workspace-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ['repo/.git', 'notes', 'tracked/.git', '.hidden', 'repo/inner'])
    mkdirSync(join(root, dir), { recursive: true })
  const projects = [project('p1', join(root, 'tracked'))]
  const folders = await listWorkspaceFolders(root, projects, [])
  assert.deepEqual(
    folders.map((f) => [f.name, f.git, f.projectId]),
    [
      ['notes', false, null],
      ['repo', true, null],
      ['tracked', true, 'p1']
    ]
  )
  assert.deepEqual(
    promotableFolders(folders).map((f) => f.name),
    ['repo']
  )
  const dismissed = await listWorkspaceFolders(root, projects, [join(root, 'repo')])
  assert.deepEqual(promotableFolders(dismissed), [])
  assert.deepEqual(await listWorkspaceFolders(join(root, 'missing'), projects, []), [])

  assert.equal(await workspaceChild(root, join(root, 'repo')), join(root, 'repo'))
  await assert.rejects(workspaceChild(root, join(root, 'repo', 'inner')), /directly inside/)
  await assert.rejects(workspaceChild(root, root), /directly inside/)
  await assert.rejects(workspaceChild(root, join(root, 'nope')), /no longer exists/)

  assert.equal(isWorkspaceProject(root, projects[0]), true)
  assert.equal(isWorkspaceProject(root, project('r', root)), false)
  assert.equal(isWorkspaceProject(root, project('o', tmpdir())), false)
})
