import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  commitIn,
  dispatchFrom,
  fakeWorkspaces,
  gitIn,
  gitSettings,
  harness,
  OwltoHost,
  PROJECT,
  projectInstructions,
  ROUTER_INSTRUCTIONS,
  renderProjects,
  report,
  repoWithRemote,
  routerInstructions,
  scripted,
  scriptedEngine,
  send,
  tempRepo,
  waitFor,
  worktreeSettings
} from '../fixtures/router-harness.mjs'
import { memoryRouterStore } from '../fixtures/router-store.mjs'

test('worktrees are only offered for repositories with a commit', async (t) => {
  const { dir, repo, workspaces } = tempRepo(t)
  const plain = join(dir, 'plain')
  const empty = join(dir, 'empty')
  mkdirSync(plain)
  gitIn(dir, 'init', '--quiet', empty)
  assert.equal(await workspaces.inspect(plain), null, 'not a repository')
  assert.equal(await workspaces.inspect(empty), null, 'no commit to branch from')
  const top = await workspaces.inspect(repo)
  assert.equal(top.subdir, '')
  const nested = await workspaces.inspect(join(repo, 'packages', 'app'))
  assert.equal(nested.repo, top.repo)
  assert.equal(nested.subdir, join('packages', 'app'))
  const plan = workspaces.plan(nested, 'w_1', 'head')
  assert.equal(plan.branch, 'owlto/w_1')
  assert.equal(plan.cwd, join(plan.path, 'packages', 'app'))
  assert.match(plan.path, /[/\\]data[/\\]worktrees[/\\]demo-[0-9a-f]{8}[/\\]w_1$/)
  assert.equal(plan.state, 'active')
})

test('a worker worktree starts from HEAD without the checkout uncommitted changes', async (t) => {
  const { repo, workspaces } = tempRepo(t)
  const head = gitIn(repo, 'rev-parse', 'HEAD')
  writeFileSync(join(repo, 'README.md'), 'uncommitted edit\n')
  writeFileSync(join(repo, 'scratch.txt'), 'untracked\n')
  const plan = workspaces.plan(
    await workspaces.inspect(join(repo, 'packages', 'app')),
    'w_2',
    'head'
  )
  const [one, two] = await Promise.all([workspaces.ensure(plan), workspaces.ensure(plan)])
  assert.equal(one, head)
  assert.equal(two, head, 'concurrent calls share one checkout')
  assert.ok(existsSync(plan.cwd))
  assert.equal(readFileSync(join(plan.path, 'README.md'), 'utf8'), 'hello\n')
  assert.equal(existsSync(join(plan.path, 'scratch.txt')), false)
  assert.equal(gitIn(plan.path, 'branch', '--show-current'), 'owlto/w_2')
  assert.equal(readFileSync(join(repo, 'README.md'), 'utf8'), 'uncommitted edit\n')
})

test('a deleted worktree directory is checked out again from its branch', async (t) => {
  const { repo, workspaces } = tempRepo(t)
  const plan = workspaces.plan(await workspaces.inspect(repo), 'w_3', 'head')
  plan.baseCommit = await workspaces.ensure(plan)
  commitIn(plan.path, 'work.txt', 'done\n')
  rmSync(plan.path, { recursive: true, force: true })
  assert.equal(await workspaces.ensure(plan), plan.baseCommit)
  assert.equal(readFileSync(join(plan.path, 'work.txt'), 'utf8'), 'done\n')
})

test('a worktree commit may write only its git dir, objects, and its branch refs', async (t) => {
  const { repo, workspaces } = tempRepo(t)
  const plan = workspaces.plan(
    await workspaces.inspect(join(repo, 'packages', 'app')),
    'w_9',
    'head'
  )
  plan.baseCommit = await workspaces.ensure(plan)
  const common = realpathSync(join(repo, '.git'))
  const [gitDir, ...shared] = await workspaces.commitPaths(plan)
  assert.equal(dirname(gitDir), join(common, 'worktrees'))
  assert.equal(gitIn(plan.path, 'rev-parse', '--absolute-git-dir'), gitDir)
  assert.deepEqual(shared, [
    join(common, 'objects'),
    join(common, 'refs', 'heads', 'owlto'),
    join(common, 'logs', 'refs', 'heads', 'owlto')
  ])

  gitIn(repo, 'pack-refs', '--all')
  rmSync(join(common, 'refs', 'heads', 'owlto'), { recursive: true, force: true })
  const again = await workspaces.commitPaths(plan)
  assert.ok(again.includes(join(common, 'refs', 'heads', 'owlto')), 'pruned ref dir is recreated')

  const checkout = { ...plan, path: repo, cwd: repo, branch: 'main' }
  assert.deepEqual(await workspaces.commitPaths(checkout), [], 'never the whole .git')
  rmSync(plan.path, { recursive: true, force: true })
  assert.deepEqual(await workspaces.commitPaths(plan), [])
})

test('releasing a worktree removes clean work, keeps branches with commits and dirty trees', async (t) => {
  const { repo, workspaces } = tempRepo(t)
  const top = await workspaces.inspect(repo)
  const ready = async (id) => {
    const plan = workspaces.plan(top, id, 'head')
    plan.baseCommit = await workspaces.ensure(plan)
    return plan
  }
  const branches = () => gitIn(repo, 'branch', '--list', 'owlto/*')

  const clean = await ready('w_clean')
  assert.deepEqual(await workspaces.release(clean, false), {
    worktree: 'removed',
    branch: 'deleted'
  })
  assert.equal(existsSync(clean.path), false)

  const committed = await ready('w_commit')
  commitIn(committed.path, 'feature.txt', 'new\n')
  assert.deepEqual(await workspaces.release(committed, false), {
    worktree: 'removed',
    branch: 'kept'
  })
  assert.match(branches(), /owlto\/w_commit/)

  const merged = await ready('w_merged')
  commitIn(merged.path, 'merged.txt', 'in\n')
  gitIn(repo, 'merge', '--quiet', '--ff-only', 'owlto/w_merged')
  assert.deepEqual(await workspaces.release(merged, false), {
    worktree: 'removed',
    branch: 'deleted'
  })

  const dirty = await ready('w_dirty')
  writeFileSync(join(dirty.path, 'draft.txt'), 'unsaved\n')
  assert.deepEqual(await workspaces.release(dirty, false), { worktree: 'kept', branch: 'kept' })
  assert.ok(existsSync(join(dirty.path, 'draft.txt')), 'uncommitted work survives')
  assert.deepEqual(await workspaces.release(dirty, true), {
    worktree: 'removed',
    branch: 'deleted'
  })
  assert.equal(existsSync(dirty.path), false)
  assert.doesNotMatch(branches(), /w_clean|w_merged|w_dirty/)
})

test('a default-branch worktree starts from the fetched remote branch', async (t) => {
  const { dir, repo, workspaces } = tempRepo(t)
  const remote = join(dir, 'remote.git')
  gitIn(dir, 'clone', '--quiet', '--bare', repo, remote)
  gitIn(repo, 'remote', 'add', 'origin', remote)
  gitIn(repo, 'fetch', '--quiet', 'origin')
  gitIn(repo, 'remote', 'set-head', 'origin', 'main')
  // The remote moves on, and the user is on a feature branch with local work.
  const upstream = join(dir, 'upstream')
  gitIn(dir, 'clone', '--quiet', remote, upstream)
  gitIn(upstream, 'config', 'user.email', 'test@example.com')
  gitIn(upstream, 'config', 'user.name', 'Test')
  commitIn(upstream, 'remote.txt', 'from remote\n')
  gitIn(upstream, 'push', '--quiet', 'origin', 'main')
  gitIn(repo, 'switch', '--quiet', '-c', 'feature')
  commitIn(repo, 'local.txt', 'local only\n')

  const top = await workspaces.inspect(repo)
  const fromMain = workspaces.plan(top, 'w_main', 'default-branch')
  assert.equal(await workspaces.ensure(fromMain), gitIn(remote, 'rev-parse', 'main'))
  assert.ok(existsSync(join(fromMain.path, 'remote.txt')), 'fetched before branching')
  assert.equal(existsSync(join(fromMain.path, 'local.txt')), false)
  const fromHead = workspaces.plan(top, 'w_head', 'head')
  assert.equal(await workspaces.ensure(fromHead), gitIn(repo, 'rev-parse', 'HEAD'))
  assert.ok(existsSync(join(fromHead.path, 'local.txt')))
})

test('a project base branch picks where new worktrees start', async (t) => {
  const { repo, remote, workspaces } = repoWithRemote(t, 'upstream')
  gitIn(repo, 'branch', 'release')
  gitIn(repo, 'switch', '--quiet', '-c', 'feature')
  commitIn(repo, 'local.txt', 'local only\n')
  const top = await workspaces.inspect(repo)

  const fromRemote = workspaces.plan(top, 'w_remote', 'head')
  assert.equal(
    await workspaces.ensure(fromRemote, gitSettings({ baseBranch: 'upstream/main' })),
    gitIn(remote, 'rev-parse', 'main'),
    'a remote branch is fetched before branching'
  )
  assert.ok(existsSync(join(fromRemote.path, 'remote.txt')))

  const fromLocal = workspaces.plan(top, 'w_local', 'head')
  assert.equal(
    await workspaces.ensure(fromLocal, gitSettings({ baseBranch: 'release' })),
    gitIn(repo, 'rev-parse', 'release')
  )

  const missing = workspaces.plan(top, 'w_missing', 'head')
  assert.equal(
    await workspaces.ensure(missing, gitSettings({ baseBranch: 'gone/away' })),
    gitIn(repo, 'rev-parse', 'HEAD'),
    'a base branch that is gone falls back to HEAD'
  )

  gitIn(repo, 'remote', 'set-head', 'upstream', 'main')
  const byRemote = workspaces.plan(top, 'w_default', 'default-branch')
  assert.equal(
    await workspaces.ensure(byRemote, gitSettings({ remote: 'upstream' })),
    gitIn(remote, 'rev-parse', 'main'),
    'the default branch comes from the project remote'
  )
})

test('a project can delete pushed branches when their worker is removed', async (t) => {
  const { repo, workspaces } = repoWithRemote(t)
  const top = await workspaces.inspect(repo)
  const ready = async (id) => {
    const plan = workspaces.plan(top, id, 'head')
    plan.baseCommit = await workspaces.ensure(plan)
    commitIn(plan.path, `${id}.txt`, 'work\n')
    return plan
  }
  const remove = gitSettings({ deletePushedBranches: true })

  const pushed = await ready('w_pushed')
  gitIn(pushed.path, 'push', '--quiet', 'origin', pushed.branch)
  assert.deepEqual(await workspaces.release(pushed, false, remove), {
    worktree: 'removed',
    branch: 'deleted'
  })

  const ahead = await ready('w_ahead')
  gitIn(ahead.path, 'push', '--quiet', 'origin', ahead.branch)
  commitIn(ahead.path, 'more.txt', 'not pushed\n')
  assert.deepEqual(await workspaces.release(ahead, false, remove), {
    worktree: 'removed',
    branch: 'kept'
  })

  const off = await ready('w_off')
  gitIn(off.path, 'push', '--quiet', 'origin', off.branch)
  assert.deepEqual(await workspaces.release(off, false, gitSettings()), {
    worktree: 'removed',
    branch: 'kept'
  })
  const branches = gitIn(repo, 'branch', '--list', 'owlto/*')
  assert.doesNotMatch(branches, /w_pushed/)
  assert.match(branches, /w_ahead/)
  assert.match(branches, /w_off/)
})

test('a project repository lists its branches and remotes, sorted', async (t) => {
  const { dir, repo, workspaces } = repoWithRemote(t)
  gitIn(repo, 'remote', 'set-head', 'origin', 'main')
  gitIn(repo, 'branch', 'b-feature')
  assert.deepEqual(await workspaces.refs(join(repo, 'packages')), {
    branches: ['b-feature', 'main'],
    remoteBranches: ['origin/main'],
    remotes: ['origin']
  })
  const plain = join(dir, 'plain')
  mkdirSync(plain)
  assert.equal(await workspaces.refs(plain), null)
})

test('the Router runs with the instructions saved in Settings, or the defaults', () => {
  const base = { engine: 'owlto', owlto: null, claudeModel: null, codexModel: null }
  assert.deepEqual(routerInstructions({ ...base, instructions: null }), {
    text: ROUTER_INSTRUCTIONS,
    custom: null
  })
  const mine = routerInstructions({ ...base, instructions: 'Route my way.' })
  assert.equal(mine.text, 'Route my way.')
  assert.match(mine.custom, /^[0-9a-f]{16}$/)
  assert.equal(routerInstructions({ ...base, instructions: 'Route my way.' }).custom, mine.custom)
  assert.notEqual(routerInstructions({ ...base, instructions: 'Route.' }).custom, mine.custom)
})

test('project instructions follow the worker instructions in a fixed order', () => {
  assert.equal(projectInstructions({ general: ' ', codeReview: '', pullRequest: '' }), null)
  const text = projectInstructions({
    general: 'Use pnpm.',
    codeReview: '',
    pullRequest: 'Fill in the template.'
  })
  assert.ok(text.indexOf('Use pnpm.') < text.indexOf('Fill in the template.'))
  assert.doesNotMatch(text, /review code/)
  assert.match(text, /report to the Router/)
})

test('the Router reads each project description in its project list', () => {
  const text = renderProjects(
    [
      { id: 'p2', name: 'web', path: '/w', settings: { description: 'Marketing\n site' } },
      { id: 'p1', name: 'api', path: '/a' }
    ],
    'p1',
    ['cursor', 'codex']
  )
  assert.equal(
    text,
    'Coding agents connected: codex, cursor\nProjects:\n- api · p1 · default\n- web · p2 — Marketing site'
  )
  assert.equal(renderProjects([], null, []), 'Coding agents connected: none')
})

test('the Router reads each project agent order and model lists', () => {
  const settings = (agents) => ({ description: '', agents })
  const models = (claude = [], codex = []) => ({
    codex,
    'claude-code': claude,
    cursor: [],
    antigravity: []
  })
  const text = renderProjects(
    [
      {
        id: 'p1',
        name: 'api',
        path: '/a',
        settings: settings({
          order: [
            { id: 'claude-code', on: true },
            { id: 'cursor', on: false },
            { id: 'codex', on: true }
          ],
          models: models([
            { id: 'opus', on: true },
            { id: 'haiku', on: false },
            { id: 'sonnet', on: true }
          ])
        })
      },
      {
        id: 'p2',
        name: 'web',
        path: '/w',
        settings: settings({ order: [], models: models([], [{ id: 'gpt-6', on: true }]) })
      },
      { id: 'p3', name: 'zoo', path: '/z', settings: settings({ order: [], models: models() }) }
    ],
    null,
    ['codex', 'claude-code']
  )
  assert.equal(
    text,
    [
      'Coding agents connected: codex, claude-code',
      'Projects:',
      '- api · p1',
      '  agents, in order: claude-code (models: opus, sonnet), codex',
      '- web · p2',
      '  agents: any connected; codex (models: gpt-6)',
      '- zoo · p3'
    ].join('\n')
  )
})

test('workers that write start together, each in its own worktree', async () => {
  const workspaces = fakeWorkspaces()
  const { engine, factory } = scriptedEngine()
  const { service, router, current, sent, created } = harness([], {
    factory,
    workspaces,
    host: { ready: ['claude-code'], settings: worktreeSettings }
  })
  const results = []
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length !== 1) return
    for (const goal of ['Write A', 'Write B'])
      results.push(JSON.parse(await tools[0].execute({ goal })))
    results.push(
      JSON.parse(
        await tools[0].execute({ goal: 'Write C', workspace: 'checkout', base: 'default-branch' })
      )
    )
    results.push(JSON.parse(await tools[0].execute({ goal: 'Write D', workspace: 'checkout' })))
    results.push(JSON.parse(await tools[0].execute({ goal: 'Write E', base: 'default-branch' })))
  }
  send(service, router, 'Five changes')
  await waitFor(() => current().status === 'idle' && results.length === 5, 'dispatches')
  assert.deepEqual(
    results.map((r) => [r.status, r.workspace, r.branch === null ? null : 'branch']),
    [
      ['started', 'worktree', 'branch'],
      ['started', 'worktree', 'branch'],
      ['started', 'checkout', null],
      ['queued', 'checkout', null],
      ['started', 'worktree', 'branch']
    ],
    'only writers sharing the checkout wait for each other'
  )
  assert.equal(results[0].branch, `owlto/${results[0].workerId}`)
  assert.deepEqual(
    sent.map((s) => s.text),
    ['Write A', 'Write B', 'Write C', 'Write E']
  )
  const a = created.find((c) => c.cwd === `/worktrees/${results[0].workerId}`)
  assert.deepEqual(a.worker, { kind: 'worktree', projectPath: PROJECT.path })
  assert.equal(created.find((c) => c.cwd === PROJECT.path).worker, null)
  const workerA = service.snapshot().workers.find((w) => w.goal === 'Write A')
  assert.equal(workerA.workspace.baseCommit, 'c0ffee', 'prepared before the turn')
  assert.deepEqual(await service.prepare(workerA.sessionId), [`/git/owlto/${workerA.id}`])
  const workerC = service.snapshot().workers.find((w) => w.goal === 'Write C')
  assert.deepEqual(await service.prepare(workerC.sessionId), [], 'a checkout writes nothing else')
  assert.equal(
    service.snapshot().workers.find((w) => w.goal === 'Write E').workspace.base,
    'default-branch'
  )
  const profile = service.profile(workerA.sessionId)
  assert.match(profile.instructions, new RegExp(`branch owlto/${workerA.id}`))
  assert.doesNotMatch(
    service.profile(service.snapshot().workers.find((w) => w.goal === 'Write C').sessionId)
      .instructions,
    /worktree/
  )
  service.close()
})

test('a worker follows its project settings from its next turn', async () => {
  const workspaces = fakeWorkspaces()
  const gits = []
  const { ensure, release } = workspaces
  workspaces.ensure = (workspace, git) => {
    gits.push(['ensure', git])
    return ensure(workspace)
  }
  workspaces.release = (workspace, force, git) => {
    gits.push(['release', git])
    return release(workspace, force)
  }
  const project = {
    ...PROJECT,
    settings: {
      description: '',
      git: gitSettings({ baseBranch: 'origin/main', remote: 'upstream' }),
      instructions: { general: 'Use pnpm.', codeReview: '', pullRequest: '' }
    }
  }
  const projects = [project]
  const { engine, factory } = scriptedEngine()
  const { service, router, current, fake } = harness([], {
    factory,
    workspaces,
    host: { ready: ['claude-code'], settings: worktreeSettings, projects }
  })
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length === 1) await tools[0].execute({ goal: 'Write A' })
  }
  send(service, router, 'One change')
  await waitFor(() => current().status === 'idle' && fake.sent.length === 1, 'dispatch')
  const worker = service.snapshot().workers[0]
  assert.deepEqual(gits[0], ['ensure', project.settings.git])
  const before = service.profile(worker.sessionId).instructions
  assert.match(before, /Use pnpm\./)
  assert.match(before, /push this branch to the upstream remote/)

  projects[0] = {
    ...project,
    settings: {
      ...project.settings,
      instructions: { ...project.settings.instructions, general: '' }
    }
  }
  assert.doesNotMatch(service.profile(worker.sessionId).instructions, /Use pnpm\./)
  service.observe({ type: 'removed', sessionId: worker.sessionId })
  await waitFor(() => gits.some(([kind]) => kind === 'release'), 'release')
  assert.deepEqual(
    gits.find(([kind]) => kind === 'release'),
    ['release', project.settings.git]
  )
  service.close()
})

test('without worktrees, writers in one project still take turns', async () => {
  for (const [label, options] of [
    ['setting off', { host: {}, workspaces: fakeWorkspaces() }],
    [
      'not a repository',
      {
        host: { ready: ['claude-code'], settings: worktreeSettings },
        workspaces: fakeWorkspaces({ git: false })
      }
    ]
  ]) {
    const { engine, factory } = scriptedEngine()
    const { service, router, current } = harness([], { factory, ...options })
    const results = []
    engine.onRun = async (_input, tools) => {
      if (engine.runs.length !== 1) return
      for (const goal of ['Write A', 'Write B'])
        results.push(JSON.parse(await tools[0].execute({ goal })))
    }
    send(service, router, 'Two changes')
    await waitFor(() => current().status === 'idle' && results.length === 2, label)
    assert.deepEqual(
      results.map((r) => [r.status, r.workspace]),
      [
        ['started', 'checkout'],
        ['queued', 'checkout']
      ],
      label
    )
    service.close()
  }
})

test('a worktree that cannot be prepared fails the dispatch and the follow-up', async () => {
  const workspaces = fakeWorkspaces({ failEnsure: true })
  const { engine, factory } = scriptedEngine()
  const { service, router, current } = harness([], {
    factory,
    workspaces,
    host: { ready: ['claude-code'], settings: worktreeSettings }
  })
  let error = null
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length === 1)
      await tools[0].execute({ goal: 'Write A' }).catch((e) => (error = e))
  }
  send(service, router, 'Change it')
  await waitFor(() => current().status === 'idle' && error, 'dispatch')
  assert.equal(error.code, 'dispatch_failed')
  const worker = service.snapshot().workers[0]
  assert.equal(worker.status, 'failed')
  await assert.rejects(service.prepare(worker.sessionId), (e) => e.code === 'worktree_failed')
  service.close()
})

test('removing a worktree worker cleans up, keeps unmerged work, and can discard', async () => {
  const kept = new Set()
  const workspaces = fakeWorkspaces({
    release: (workspace, force) =>
      force
        ? { worktree: 'removed', branch: 'kept' }
        : kept.has(workspace.branch)
          ? { worktree: 'kept', branch: 'kept' }
          : { worktree: 'removed', branch: 'kept' }
  })
  const { engine, factory } = scriptedEngine()
  const { service, router, current } = harness([], {
    factory,
    workspaces,
    host: { ready: ['claude-code'], settings: worktreeSettings }
  })
  engine.onRun = async (_input, tools) => {
    if (engine.runs.length !== 1) return
    for (const goal of ['Merged later', 'Left dirty']) await tools[0].execute({ goal })
  }
  send(service, router, 'Two changes')
  await waitFor(() => current().status === 'idle' && service.snapshot().workers.length === 2, 'go')
  const byGoal = (goal) => service.snapshot().workers.find((w) => w.goal === goal)
  for (const goal of ['Merged later', 'Left dirty'])
    service.settled(byGoal(goal).sessionId, report('ok'))
  await waitFor(() => engine.runs.length === 2 && current().status === 'idle', 'reports')
  kept.add(byGoal('Left dirty').workspace.branch)

  service.observe({ type: 'removed', sessionId: byGoal('Merged later').sessionId })
  await waitFor(() => engine.runs.length === 3, 'removal batch')
  assert.match(
    engine.runs[2].text,
    new RegExp(`unmerged work stays on branch owlto/${byGoal('Merged later').id}`)
  )
  assert.equal(byGoal('Merged later').workspace.state, 'released')

  service.observe({ type: 'removed', sessionId: byGoal('Left dirty').sessionId })
  await waitFor(() => byGoal('Left dirty').workspace.state === 'kept', 'kept worktree')
  await assert.rejects(
    service.discardWorktree({ routerId: router.id, workerId: byGoal('Merged later').id }),
    (e) => e.code === 'request_unavailable'
  )
  await service.discardWorktree({ routerId: router.id, workerId: byGoal('Left dirty').id })
  assert.equal(byGoal('Left dirty').workspace.state, 'released')
  assert.deepEqual(
    workspaces.calls.filter((c) => c[0] === 'release').map((c) => c[2]),
    [false, false, true]
  )
  service.close()
})

test('restart prunes worktrees and finishes a cleanup that did not complete', async () => {
  const store = memoryRouterStore()
  const first = scriptedEngine()
  const failing = fakeWorkspaces({
    release: () => {
      throw new Error('repository locked')
    }
  })
  const one = harness([], {
    store,
    factory: first.factory,
    workspaces: failing,
    host: { ready: ['claude-code'], settings: worktreeSettings }
  })
  first.engine.onRun = async (_input, tools) => {
    if (first.engine.runs.length === 1) await tools[0].execute({ goal: 'Write A' })
  }
  send(one.service, one.router, 'Change it')
  await waitFor(
    () => one.current().status === 'idle' && one.service.snapshot().workers.length,
    'go'
  )
  const worker = one.service.snapshot().workers[0]
  one.service.settled(worker.sessionId, report('ok'))
  one.service.observe({ type: 'removed', sessionId: worker.sessionId })
  await waitFor(() => failing.calls.some((c) => c[0] === 'release'), 'failed cleanup')
  assert.equal(one.service.snapshot().workers[0].workspace.state, 'active')
  one.service.close()

  const workspaces = fakeWorkspaces()
  const two = harness([], {
    store,
    factory: scriptedEngine().factory,
    workspaces,
    host: { ready: ['claude-code'], settings: worktreeSettings }
  })
  await two.service.recovered
  assert.deepEqual(workspaces.calls, [
    ['prune', PROJECT.path],
    ['release', `owlto/${worker.id}`, false]
  ])
  assert.equal(two.service.snapshot().workers[0].workspace.state, 'released')
  two.service.close()
})

test('the host lists the sessions of every runtime, newest first, and routes by owner', async () => {
  const session = (id, updatedAt) => ({ id, updatedAt })
  const calls = []
  const runtime = (name, ids) => ({
    setTurnProfiles() {},
    connectionState: () => ({ status: 'ready', account: { kind: 'unknown' } }),
    owns: (id) => ids.includes(id),
    interrupt: async (id) => calls.push([name, id]),
    createSession: (input) => {
      calls.push([name, 'create', input.provider])
      return session(`${name}-new`, '9')
    }
  })
  const host = new OwltoHost(
    {
      ...runtime('codex', ['codex-worker']),
      snapshot: () => ({ sessions: [session('codex-worker', '1')] })
    },
    { ...runtime('claude', ['claude-worker']), sessionList: () => [session('claude-worker', '2')] },
    { ...runtime('cursor', ['cursor-worker']), sessionList: () => [session('cursor-worker', '3')] },
    {
      ...runtime('antigravity', ['antigravity-worker']),
      sessionList: () => [session('antigravity-worker', '4')]
    },
    '/tmp/owlto-thread-home',
    '/tmp/owlto-projects',
    '/tmp/owlto-workspace'
  )
  assert.deepEqual(
    host.snapshot().sessions.map((s) => s.id),
    ['antigravity-worker', 'cursor-worker', 'claude-worker', 'codex-worker']
  )
  const workers = host.workerHost()
  await workers.interrupt('cursor-worker')
  await workers.interrupt('claude-worker')
  await workers.interrupt('codex-worker')
  workers.createSession({ provider: 'cursor' })
  assert.deepEqual(calls, [
    ['cursor', 'cursor-worker'],
    ['claude', 'claude-worker'],
    ['codex', 'codex-worker'],
    ['cursor', 'create', 'cursor']
  ])
  assert.equal(workers.providerReady('cursor'), true)
})

test('dispatch follows the project agent order and model list', async () => {
  const model = (id, efforts = []) => ({ id, name: id, efforts, isDefault: false })
  const ORDERED = {
    ...PROJECT,
    settings: {
      description: '',
      agents: {
        order: [
          { id: 'cursor', on: true },
          { id: 'claude-code', on: true },
          { id: 'codex', on: false }
        ],
        models: {
          codex: [],
          'claude-code': [
            { id: 'gone', on: true },
            { id: 'haiku', on: false },
            { id: 'opus', on: true },
            { id: 'sonnet', on: true }
          ],
          cursor: []
        }
      }
    }
  }
  const { engine, service, router, current, created } = scripted({
    host: {
      projects: [ORDERED],
      ready: ['codex', 'claude-code'],
      models: { 'claude-code': [model('haiku'), model('opus', ['high']), model('sonnet')] },
      settings: {
        agents: {
          codex: { model: 'gpt-test', effort: null, permission: 'workspace-write' },
          'claude-code': { model: 'haiku', effort: 'high', permission: 'read-only' },
          cursor: { model: null, effort: null, permission: 'workspace-write' }
        }
      }
    }
  })
  const results = []
  engine.onRun = async (_input, tools) => {
    const dispatch = dispatchFrom(tools)
    for (const input of [
      { goal: 'First choice' },
      { goal: 'Named model', model: 'sonnet' },
      { goal: 'Unlisted model', model: 'haiku' },
      { goal: 'Unused agent', provider: 'codex' },
      { goal: 'Disconnected agent', provider: 'cursor' }
    ])
      results.push(await dispatch.execute(input).then(JSON.parse, (error) => error.code))
  }
  await send(service, router, 'go')
  await waitFor(() => current().status === 'idle' && results.length === 5, 'dispatches')
  assert.match(
    engine.runs[0].text,
    /agents, in order: cursor, claude-code \(models: gone, opus, sonnet\)/
  )
  assert.deepEqual(results.slice(2), [
    'invalid_request',
    'provider_unavailable',
    'provider_unavailable'
  ])
  assert.deepEqual(
    created.map((s) => [s.provider, s.model, s.effort, s.permission]),
    [
      ['claude-code', 'opus', 'high', 'read-only'],
      ['claude-code', 'sonnet', null, 'read-only']
    ],
    'skips the disconnected agent and the model the agent no longer offers'
  )
  service.close()
})

test('a project without choices uses the first connected agent and its settings', async () => {
  const { engine, service, router, current, created } = scripted({
    host: { ready: ['claude-code'] }
  })
  engine.onRun = async (_input, tools) => {
    await dispatchFrom(tools).execute({ goal: 'Any agent' })
  }
  await send(service, router, 'go')
  await waitFor(() => current().status === 'idle' && created.length === 1, 'dispatch')
  assert.deepEqual(
    [created[0].provider, created[0].model, created[0].permission],
    ['claude-code', null, 'workspace-write']
  )
  service.close()
})
