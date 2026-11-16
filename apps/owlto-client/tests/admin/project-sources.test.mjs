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
  saveProjectSchema,
  cloneFailureCode,
  cloneGitHubProject,
  createQuickProject,
  TOKEN_VARIABLE,
  tokenCredentialConfig
} = require('../../out/main/app/runtime.js')

function tempRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'owlto-project-sources-')))
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

test('a failed clone says why, without showing git output', () => {
  const https = (method) => ({ ssh: false, method })
  const noPrompt =
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
  assert.equal(cloneFailureCode(noPrompt, https(null)), 'project_clone_sign_in')
  assert.equal(
    cloneFailureCode('remote: Repository not found.\nfatal: repository not found', https('app')),
    'project_clone_app_access'
  )
  assert.equal(
    cloneFailureCode(
      "fatal: Authentication failed for 'https://github.com/o/r.git/'",
      https('token')
    ),
    'project_clone_no_access'
  )
  assert.equal(
    cloneFailureCode('git@github.com: Permission denied (publickey).', { ssh: true, method: null }),
    'project_clone_ssh_denied'
  )
  assert.equal(
    cloneFailureCode('fatal: unable to access: Could not resolve host: github.com', https(null)),
    'project_clone_network'
  )
  assert.equal(cloneFailureCode('git not found', https(null)), 'project_git_missing')
  assert.equal(cloneFailureCode('fatal: something else', https(null)), 'project_clone_failed')
})

test('the clone token helper answers only https://github.com', () => {
  const fill = (protocol, host) =>
    execFileSync('git', [...tokenCredentialConfig(), 'credential', 'fill'], {
      input: `protocol=${protocol}\nhost=${host}\npath=o/r.git\n\n`,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', [TOKEN_VARIABLE]: 'secret-token' },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
  assert.match(fill('https', 'github.com'), /password=secret-token/)
  for (const [protocol, host] of [
    ['https', 'lfs.example.com'],
    ['https', 'github.com.evil.com'],
    ['http', 'github.com']
  ])
    assert.throws(() => fill(protocol, host), `${protocol}://${host} must get no token`)
})

test('project settings default their icon and accept only small raster image icons', () => {
  const base = {
    id: 'p1',
    name: 'demo',
    settings: {
      description: '',
      git: { baseBranch: null, remote: null, deletePushedBranches: false },
      instructions: { general: '', codeReview: '', pullRequest: '' }
    }
  }
  const parsed = saveProjectSchema.parse(base)
  assert.deepEqual(parsed.settings.icon, { kind: 'letter' }, 'settings saved before icons')
  assert.equal(parsed.settings.color, null)
  const withIcon = (icon, color = null) =>
    saveProjectSchema.safeParse({ ...base, settings: { ...base.settings, icon, color } }).success
  assert.ok(withIcon({ kind: 'emoji', value: '🦉' }, 2))
  assert.ok(withIcon({ kind: 'image', src: 'data:image/png;base64,iVBORw0KGgo=' }))
  assert.equal(withIcon({ kind: 'emoji', value: '  ' }), false)
  assert.equal(withIcon({ kind: 'letter' }, 5), false, 'only palette colors')
  assert.equal(withIcon({ kind: 'image', src: 'file:///Users/me/icon.png' }), false)
  assert.equal(
    withIcon({ kind: 'image', src: 'data:image/svg+xml;base64,PHN2Zz4=' }),
    false,
    'no SVG'
  )
  assert.equal(
    withIcon({ kind: 'image', src: `data:image/png;base64,${'A'.repeat(300 * 1024)}` }),
    false,
    'size limit'
  )
})
