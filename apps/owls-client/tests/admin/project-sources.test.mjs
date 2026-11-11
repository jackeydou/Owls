import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  parseGitHubRepo,
  cloneGitHubProject,
  createQuickProject
} = require('../../out/main/app/runtime.js')

function tempRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'owls-project-sources-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('reads the ways people paste a GitHub repository', () => {
  const https = (owner, repo) => ({
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`
  })
  assert.deepEqual(parseGitHubRepo('https://github.com/jackeydou/Owls'), https('jackeydou', 'Owls'))
  assert.deepEqual(parseGitHubRepo(' github.com/a-b/c.d.git/ '), https('a-b', 'c.d'))
  assert.deepEqual(
    parseGitHubRepo('https://www.github.com/o/r/tree/main/src?x=1#y'),
    https('o', 'r')
  )
  assert.deepEqual(parseGitHubRepo('o/r'), https('o', 'r'))
  assert.deepEqual(parseGitHubRepo('git@github.com:o/r.git'), {
    owner: 'o',
    repo: 'r',
    cloneUrl: 'git@github.com:o/r.git'
  })
})

test('rejects what is not a github.com repository', () => {
  for (const input of [
    '',
    'https://gitlab.com/o/r',
    'https://github.com/o',
    'github.com/o',
    'https://github.com.evil.com/o/r',
    'file:///tmp/o/r',
    'o/..',
    'o/r/extra',
    '-o/r'
  ])
    assert.equal(parseGitHubRepo(input), null, input)
})

test('Quick start makes a git project and refuses an existing folder', async (t) => {
  const root = tempRoot(t)
  const defaultParent = join(root, 'projects')
  const path = await createQuickProject({ name: 'demo', parent: null }, defaultParent)
  assert.equal(path, join(defaultParent, 'demo'))
  assert.ok(existsSync(join(path, '.git')))
  await assert.rejects(
    createQuickProject({ name: 'demo', parent: null }, defaultParent),
    (error) => error.code === 'project_exists'
  )
  const chosen = join(root, 'chosen')
  mkdirSync(chosen)
  assert.equal(
    await createQuickProject({ name: 'other', parent: chosen }, defaultParent),
    join(chosen, 'other')
  )
  await assert.rejects(
    createQuickProject({ name: 'x', parent: join(root, 'missing') }, defaultParent),
    (error) => error.code === 'invalid_request'
  )
})

test('importing a repository that is already cloned there reuses the folder', async (t) => {
  const root = tempRoot(t)
  const existing = join(root, 'Owls')
  mkdirSync(existing)
  execFileSync('git', ['init', '--quiet'], { cwd: existing })
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:jackeydou/Owls.git'], {
    cwd: existing
  })
  assert.equal(
    await cloneGitHubProject({ url: 'https://github.com/JackeyDou/Owls', parent: root }, root),
    existing
  )
  await assert.rejects(
    cloneGitHubProject({ url: 'https://github.com/someone/Owls', parent: root }, root),
    (error) => error.code === 'project_exists'
  )
  await assert.rejects(
    cloneGitHubProject({ url: 'not a repo', parent: root }, root),
    (error) => error.code === 'project_url_invalid'
  )
})
