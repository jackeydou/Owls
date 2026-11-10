import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { cipher, memoryRouterStore, staleSecret } from '../fixtures/router-store.mjs'

const require = createRequire(import.meta.url)
const { GitHubAuth, GitWorkspaces, lookupPullRequest, parseGitHubRemote, WorkerGitHub } =
  require('../../out/main/app/runtime.js')

const json = (body, init) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init })
/** Answers each request from a route table of URL suffixes, in order, and records the calls. */
function fakeHttp(routes) {
  const calls = []
  const http = async (url, init = {}) => {
    calls.push({ url, body: init.body?.toString() ?? '' })
    const route = Object.keys(routes).find((suffix) => url.endsWith(suffix))
    assert.ok(route, `unexpected request to ${url}`)
    const reply = routes[route].length > 1 ? routes[route].shift() : routes[route][0]
    return reply instanceof Error ? Promise.reject(reply) : json(...reply)
  }
  return { http, calls }
}
const deviceCode = {
  device_code: 'device',
  user_code: 'ABCD-1234',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 0
}
const granted = { access_token: 'first', refresh_token: 'r1', expires_in: 28800 }
const signedIn = (events) =>
  new Promise((resolve) => {
    const check = setInterval(() => {
      if (events.at(-1)?.status === 'pending') return
      clearInterval(check)
      resolve(events.at(-1))
    }, 1)
  })
async function signInAuth(reply = granted, extra = {}) {
  const store = memoryRouterStore()
  const routes = {
    'device/code': [[deviceCode]],
    'oauth/access_token': [[reply], ...(extra.tokens ?? [])],
    '/user': [[{ login: 'owl' }]]
  }
  const { http, calls } = fakeHttp(routes)
  const events = []
  const auth = new GitHubAuth(store, cipher, (account) => events.push(account), http)
  await auth.signIn()
  await signedIn(events)
  return { auth, calls, events, store }
}

test('device flow waits for the user, honors slow_down, and stores the session encrypted', async () => {
  const store = memoryRouterStore()
  const { http, calls } = fakeHttp({
    'device/code': [[deviceCode]],
    'oauth/access_token': [
      [{ error: 'authorization_pending' }],
      [{ error: 'slow_down', interval: 0 }],
      [granted]
    ],
    '/user': [[{ login: 'owl' }]]
  })
  const events = []
  const auth = new GitHubAuth(store, cipher, (account) => events.push(account), http)
  const pending = await auth.signIn()
  assert.equal(pending.status, 'pending')
  assert.equal(pending.userCode, 'ABCD-1234')
  assert.deepEqual(await signedIn(events), {
    status: 'signed-in',
    login: 'owl',
    method: 'app',
    failure: null
  })
  assert.equal(calls.filter((c) => c.url.endsWith('oauth/access_token')).length, 3)
  assert.doesNotMatch(store.credential('github').secret, /first/)
  assert.equal(await auth.token(), 'first')
})

test('a declined device flow reports why, and cancel stops polling', async () => {
  const declined = fakeHttp({
    'device/code': [[deviceCode]],
    'oauth/access_token': [[{ error: 'access_denied' }]]
  })
  const events = []
  const auth = new GitHubAuth(memoryRouterStore(), cipher, (a) => events.push(a), declined.http)
  await auth.signIn()
  assert.deepEqual(await signedIn(events), { status: 'signed-out', failure: 'denied' })

  const waiting = fakeHttp({
    'device/code': [[{ ...deviceCode, interval: 60 }]],
    'oauth/access_token': [[{ error: 'authorization_pending' }]]
  })
  const cancelled = []
  const other = new GitHubAuth(memoryRouterStore(), cipher, (a) => cancelled.push(a), waiting.http)
  await other.signIn()
  other.cancelSignIn()
  assert.deepEqual(other.account(), { status: 'signed-out', failure: null })
  assert.equal(waiting.calls.filter((c) => c.url.endsWith('oauth/access_token')).length, 0)
})

test('an expired token refreshes once, even for concurrent callers, and rotates', async () => {
  const { auth, calls } = await signInAuth(
    { access_token: 'stale', refresh_token: 'r1', expires_in: 0 },
    { tokens: [[{ access_token: 'fresh', refresh_token: 'r2', expires_in: 28800 }]] }
  )
  assert.deepEqual(await Promise.all([auth.token(), auth.token()]), ['fresh', 'fresh'])
  const refreshes = calls.filter((c) => c.body.includes('grant_type=refresh_token'))
  assert.equal(refreshes.length, 1)
  assert.match(refreshes[0].body, /refresh_token=r1/)
  assert.equal(await auth.token(), 'fresh')
})

test('a rejected refresh token signs the user out, but a dropped request does not', async () => {
  const offline = await signInAuth(
    { access_token: 'stale', refresh_token: 'r1', expires_in: 0 },
    { tokens: [new Error('offline')] }
  )
  await assert.rejects(offline.auth.token())
  assert.equal(offline.auth.account().status, 'signed-in')

  const rejected = await signInAuth(
    { access_token: 'stale', refresh_token: 'r1', expires_in: 0 },
    { tokens: [[{ error: 'bad_refresh_token' }]] }
  )
  assert.equal(await rejected.auth.token(), null)
  assert.deepEqual(rejected.auth.account(), { status: 'signed-out', failure: 'expired' })
})

test('the gh CLI connection reads its token per request and never stores it', async () => {
  const store = memoryRouterStore()
  const { http } = fakeHttp({ '/user': [[{ login: 'owl' }]] })
  let reads = 0
  const ghToken = async () => `gho_${++reads}`
  const auth = new GitHubAuth(store, cipher, () => {}, http, ghToken)
  assert.deepEqual(await auth.connectGhCli(), {
    status: 'signed-in',
    login: 'owl',
    method: 'gh-cli',
    failure: null
  })
  assert.doesNotMatch((await cipher.decrypt(store.credential('github').secret)).plain, /gho_/)
  assert.equal(await auth.token(), 'gho_2')
  assert.equal(await auth.token(), 'gho_3')
})

test('a missing gh sign-in is reported without storing a connection', async () => {
  const store = memoryRouterStore()
  const { http } = fakeHttp({})
  const auth = new GitHubAuth(
    store,
    cipher,
    () => {},
    http,
    async () => null
  )
  assert.deepEqual(await auth.connectGhCli(), { status: 'signed-out', failure: 'gh-unavailable' })
  assert.equal(store.credential('github'), null)
})

test('a personal access token is checked first, then stored encrypted', async () => {
  const store = memoryRouterStore()
  const { http } = fakeHttp({ '/user': [[{}, { status: 401 }], [{ login: 'owl' }]] })
  const auth = new GitHubAuth(store, cipher, () => {}, http)
  assert.deepEqual(await auth.connectToken('bad'), {
    status: 'signed-out',
    failure: 'invalid-token'
  })
  assert.equal(store.credential('github'), null)
  assert.equal((await auth.connectToken('good')).method, 'token')
  assert.equal(auth.method(), 'token')
  assert.doesNotMatch(store.credential('github').secret, /good/)
  assert.equal(await auth.token(), 'good')
  auth.signOut()
  assert.equal(store.credential('github'), null)
})

test('connecting another way replaces the current connection', async () => {
  const store = memoryRouterStore()
  const { http } = fakeHttp({ '/user': [[{ login: 'owl' }]] })
  const other = new GitHubAuth(
    store,
    cipher,
    () => {},
    http,
    async () => 'gho'
  )
  await other.connectToken('pat')
  await other.connectGhCli()
  assert.equal(other.method(), 'gh-cli')
  assert.equal(await other.token(), 'gho')
  const failed = new GitHubAuth(
    store,
    cipher,
    () => {},
    http,
    async () => null
  )
  await failed.load()
  const kept = await failed.connectGhCli()
  assert.equal(kept.status, 'signed-in')
  assert.equal(kept.failure, 'gh-unavailable')
})

test('a stored connection loads after a restart, and old encryption is replaced', async () => {
  const store = memoryRouterStore()
  const { http } = fakeHttp({ '/user': [[{ login: 'owl' }]] })
  await new GitHubAuth(store, cipher, () => {}, http).connectToken('pat')
  const events = []
  const restarted = new GitHubAuth(store, cipher, (account) => events.push(account), http)
  assert.equal(restarted.account().status, 'signed-out', 'nothing is decrypted before load')
  await restarted.load()
  assert.deepEqual(events, [{ status: 'signed-in', login: 'owl', method: 'token', failure: null }])
  assert.equal(await restarted.token(), 'pat')

  const session = { accessToken: 'old', refreshToken: null, expiresAt: null, login: 'owl' }
  store.saveCredential('github', 'github_app_user', staleSecret(JSON.stringify(session)))
  const legacy = new GitHubAuth(store, cipher, () => {}, http)
  assert.equal(await legacy.token(), 'old', 'token() waits for the stored connection')
  assert.equal(legacy.method(), 'app')
  assert.equal((await cipher.decrypt(store.credential('github').secret)).stale, false)

  store.saveCredential('github', 'github_token', 'not-a-secret')
  const unreadable = new GitHubAuth(store, cipher, () => {}, http)
  await unreadable.load()
  assert.deepEqual(unreadable.account(), { status: 'signed-out', failure: null })
  assert.equal(await unreadable.token(), null)
})

test('a sign-in without secure storage is refused', async () => {
  const locked = { ...cipher, unavailable: async () => 'No keychain.' }
  const auth = new GitHubAuth(memoryRouterStore(), locked, () => {}, fakeHttp({}).http)
  await assert.rejects(auth.connectToken('pat'), (e) => e.code === 'secure_storage_unavailable')
})

test('parseGitHubRemote reads github.com remotes and nothing else', () => {
  const repository = { owner: 'jackeydou', name: 'Owls' }
  assert.deepEqual(parseGitHubRemote('git@github.com:jackeydou/Owls.git'), repository)
  assert.deepEqual(parseGitHubRemote('https://github.com/jackeydou/Owls'), repository)
  assert.deepEqual(parseGitHubRemote('https://x:y@github.com/jackeydou/Owls.git'), repository)
  assert.deepEqual(parseGitHubRemote('ssh://git@github.com/jackeydou/Owls.git'), repository)
  assert.equal(parseGitHubRemote('git@gitlab.com:jackeydou/Owls.git'), null)
  assert.equal(parseGitHubRemote('https://github.com.evil.test/jackeydou/Owls'), null)
})

const pullRequestNode = (overrides = {}) => ({
  number: 7,
  title: 'Add status',
  url: 'https://github.com/o/r/pull/7',
  state: 'OPEN',
  isDraft: false,
  isCrossRepository: false,
  mergeable: 'MERGEABLE',
  reviewDecision: 'APPROVED',
  commits: {
    nodes: [
      {
        commit: {
          statusCheckRollup: {
            state: 'FAILURE',
            contexts: {
              nodes: [
                {
                  __typename: 'CheckRun',
                  name: 'b-ok',
                  status: 'COMPLETED',
                  conclusion: 'SUCCESS'
                },
                { __typename: 'CheckRun', name: 'a-run', status: 'IN_PROGRESS', conclusion: null },
                {
                  __typename: 'CheckRun',
                  name: 'skip',
                  status: 'COMPLETED',
                  conclusion: 'SKIPPED'
                },
                { __typename: 'StatusContext', context: 'z-bad', state: 'ERROR', targetUrl: null }
              ]
            }
          }
        }
      }
    ]
  },
  ...overrides
})
const repository = { owner: 'o', name: 'r' }
const graphql = (nodes) =>
  fakeHttp({ graphql: [[{ data: { repository: { pullRequests: { nodes } } } }]] }).http

test('lookupPullRequest maps state, ignores forks, and orders checks by urgency', async () => {
  const found = await lookupPullRequest(
    graphql([
      pullRequestNode({ number: 1, isCrossRepository: true }),
      pullRequestNode({ number: 2, state: 'MERGED' }),
      pullRequestNode({ number: 3, isDraft: true, mergeable: 'CONFLICTING' })
    ]),
    't',
    repository,
    'x'
  )
  assert.equal(found.pullRequest.number, 3)
  assert.equal(found.pullRequest.state, 'draft')
  assert.equal(found.pullRequest.conflicted, true)
  assert.equal(found.pullRequest.review, 'approved')
  assert.equal(found.pullRequest.checksState, 'failure')
  assert.deepEqual(
    found.pullRequest.checks.map((c) => [c.name, c.state]),
    [
      ['z-bad', 'failure'],
      ['a-run', 'pending'],
      ['b-ok', 'success'],
      ['skip', 'neutral']
    ]
  )
  assert.deepEqual(await lookupPullRequest(graphql([]), 't', repository, 'x'), { kind: 'none' })
})

test('lookupPullRequest tells missing access from auth and rate-limit failures', async () => {
  const reply = (...args) => fakeHttp({ graphql: [args] }).http
  assert.deepEqual(
    await lookupPullRequest(
      reply({ data: { repository: null }, errors: [{ type: 'NOT_FOUND' }] }),
      't',
      repository,
      'x'
    ),
    { kind: 'no-access' }
  )
  await assert.rejects(
    lookupPullRequest(reply({}, { status: 401 }), 't', repository, 'x'),
    (error) => error.reason === 'unauthorized'
  )
  await assert.rejects(
    lookupPullRequest(
      reply({}, { status: 403, headers: { 'retry-after': '120' } }),
      't',
      repository,
      'x'
    ),
    (error) => error.reason === 'rate-limited' && error.retryAt > Date.now()
  )
})

function gitRepository() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'owls-github-')))
  const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const remote = join(root, 'remote.git')
  const repo = join(root, 'repo')
  run(root, 'init', '--bare', '--quiet', remote)
  run(root, 'init', '--quiet', '--initial-branch=main', repo)
  run(repo, 'config', 'user.email', 'owl@example.test')
  run(repo, 'config', 'user.name', 'Owl')
  writeFileSync(join(repo, 'file'), 'one')
  run(repo, 'add', 'file')
  run(repo, 'commit', '--quiet', '-m', 'first')
  run(repo, 'remote', 'add', 'origin', remote)
  run(repo, 'push', '--quiet', 'origin', 'main')
  return { root, repo, remote, run }
}

test('remoteBranch follows the checked-out branch, not the planned one or its upstream', async (t) => {
  const { root, repo, remote, run } = gitRepository()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const workspaces = new GitWorkspaces(join(root, 'worktrees'))
  const workspace = workspaces.plan({ repo, subdir: '' }, 'w_1', 'head')
  await workspaces.ensure(workspace)
  assert.deepEqual(await workspaces.remoteBranch(workspace), {
    remoteUrl: remote,
    branch: 'owls/w_1',
    pushed: false
  })
  run(workspace.path, 'fetch', '--quiet', 'origin')
  run(workspace.path, 'switch', '--quiet', '-c', 'codex/topic', 'origin/main')
  assert.equal((await workspaces.remoteBranch(workspace)).branch, 'codex/topic')
  assert.equal((await workspaces.remoteBranch(workspace)).pushed, false)
  run(workspace.path, 'push', '--quiet', 'origin', 'HEAD:codex/topic')
  run(workspace.path, 'fetch', '--quiet', 'origin')
  assert.equal((await workspaces.remoteBranch(workspace)).pushed, true)
  run(workspace.path, 'switch', '--quiet', '--detach')
  assert.equal(await workspaces.remoteBranch(workspace), null)
})

const worktree = { kind: 'worktree' }
const worker = (overrides = {}) => ({
  id: 'w_1',
  routerId: 'r_1',
  workspace: worktree,
  pullRequest: null,
  ...overrides
})
const pushed = {
  remoteUrl: 'git@github.com:o/r.git',
  branch: 'codex/topic',
  pushed: true
}
function watcher({ current = worker(), local = pushed, token = 't', method = 'app', http }) {
  const statuses = []
  const links = []
  let invalidated = 0
  const github = new WorkerGitHub(
    {
      worker: (id) => (id === current.id ? current : undefined),
      remoteBranch: async () => local,
      linkPullRequest: (id, link) => {
        links.push(link)
        current.pullRequest = link
      }
    },
    { token: async () => token, invalidate: () => invalidated++, method: () => method },
    (_, status) => statuses.push(status),
    http
  )
  return { github, links, statuses, invalidations: () => invalidated }
}
const settled = async (statuses, count = 1) => {
  while (statuses.length < count) await new Promise((resolve) => setTimeout(resolve, 1))
}
const action = { routerId: 'r_1', workerId: 'w_1' }

test('watching a worker reports its pull request and links it for later', async (t) => {
  const { github, links, statuses } = watcher({ http: graphql([pullRequestNode()]) })
  t.after(() => github.close())
  github.watch(action)
  await settled(statuses)
  assert.equal(statuses[0].kind, 'pull-request')
  assert.deepEqual(links, [{ owner: 'o', name: 'r', branch: 'codex/topic', number: 7 }])
})

test('a removed worktree still finds its pull request through the link', async (t) => {
  const link = { owner: 'o', name: 'r', branch: 'gone', number: 7 }
  const { calls, http } = fakeHttp({
    graphql: [[{ data: { repository: { pullRequests: { nodes: [pullRequestNode()] } } } }]]
  })
  const { github, statuses } = watcher({
    current: worker({ pullRequest: link }),
    local: null,
    http
  })
  t.after(() => github.close())
  github.watch(action)
  await settled(statuses)
  assert.equal(statuses[0].kind, 'pull-request')
  assert.match(calls[0].body, /"branch":"gone"/)
})

test('states that need no GitHub request answer without one', async (t) => {
  const http = () => assert.fail('no request expected')
  const cases = [
    [{ current: worker({ workspace: { kind: 'checkout' } }) }, { kind: 'unsupported' }],
    [{ local: { ...pushed, remoteUrl: 'git@gitlab.com:o/r.git' } }, { kind: 'unsupported' }],
    [{ local: { ...pushed, pushed: false } }, { kind: 'not-pushed', branch: 'codex/topic' }],
    [{ token: null }, { kind: 'signed-out' }]
  ]
  for (const [input, expected] of cases) {
    const { github, statuses } = watcher({ ...input, http })
    t.after(() => github.close())
    github.watch(action)
    await settled(statuses)
    assert.deepEqual(statuses[0], expected)
  }
})

test('a revoked token signs out, and a failed poll keeps the last good answer', async (t) => {
  const revoked = watcher({ http: fakeHttp({ graphql: [[{}, { status: 401 }]] }).http })
  t.after(() => revoked.github.close())
  revoked.github.watch(action)
  await settled(revoked.statuses)
  assert.deepEqual(revoked.statuses[0], { kind: 'signed-out' })
  assert.equal(revoked.invalidations(), 1)

  const { http } = fakeHttp({
    graphql: [
      [{ data: { repository: { pullRequests: { nodes: [pullRequestNode()] } } } }],
      [{}, { status: 502 }],
      [{ data: { repository: { pullRequests: { nodes: [] } } } }]
    ]
  })
  const { github, statuses } = watcher({ http })
  t.after(() => github.close())
  github.watch(action)
  await settled(statuses)
  github.refresh()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(statuses.length, 1)
  github.refresh()
  await settled(statuses, 2)
  assert.equal(statuses[1].kind, 'no-pull-request')
})

test('unreadable repositories name the App only on an App connection', async (t) => {
  const http = fakeHttp({
    graphql: [[{ data: { repository: null }, errors: [{ type: 'NOT_FOUND' }] }]]
  }).http
  const app = watcher({ http })
  const pat = watcher({ http, method: 'token' })
  t.after(() => {
    app.github.close()
    pat.github.close()
  })
  app.github.watch(action)
  pat.github.watch(action)
  await settled(app.statuses)
  await settled(pat.statuses)
  assert.equal(app.statuses[0].kind, 'not-installed')
  assert.equal(pat.statuses[0].kind, 'no-access')
})

test('a watch for another router is ignored, and unwatching stops updates', async (t) => {
  const { github, statuses } = watcher({ http: graphql([pullRequestNode()]) })
  t.after(() => github.close())
  github.watch({ routerId: 'other', workerId: 'w_1' })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(statuses.length, 0)
  github.watch(action)
  github.unwatch(action)
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(statuses.length, 0)
})
