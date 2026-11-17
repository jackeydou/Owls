// Shared harness for the Router runtime tests.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk/core'
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall
} from '@earendil-works/pi-ai'
import {
  cipher,
  commands,
  memoryRouterStore,
  staleSecret,
  TEST_DEVICE_ID
} from './router-store.mjs'

const require = createRequire(import.meta.url)
export const {
  ClaudeEngine,
  CodexEngine,
  CodexRouterServer,
  codexRouterArgs,
  OwltoEngine,
  OwltoHost,
  RouterCredentials,
  ROUTER_INSTRUCTIONS,
  ROUTER_PROMPT_VERSION,
  routerInstructions,
  RouterService,
  defaultEngineFactory,
  GitWorkspaces,
  parseReport,
  projectInstructions,
  renderBatch,
  renderProjects,
  renderState,
  routerTools,
  trimContext
} = require('../../out/main/app/runtime.js')

export const PROJECT = { id: 'p1', name: 'demo', path: '/tmp/owlto-router-demo' }
export const WORKSPACE = '/tmp/owlto-workspace'
/** A thread's first batch lists the projects, so even a lone message arrives as a batch. */
export const firstBatch = (text) =>
  new RegExp(
    `^<owlto-batch id="b_[0-9a-f]+" events="1">\\nCoding agents connected: codex, claude-code\\nProjects:\\n- demo · p1 · default\\n\\[1\\] user_message · user · [0-9:]+\\n${text}\\n</owlto-batch>$`
  )

export function fakeHost(overrides = {}) {
  const created = []
  const sent = []
  const steered = []
  const interrupted = []
  const removed = []
  const turns = { profiles: null, running: new Set() }
  const settings = {
    agents: {
      codex: { model: 'gpt-test', effort: null, permission: 'workspace-write' },
      'claude-code': { model: null, effort: null, permission: 'workspace-write' },
      cursor: { model: null, effort: null, permission: 'workspace-write' }
    },
    router: {
      engine: 'owlto',
      owlto: null,
      claudeModel: null,
      codexModel: null,
      maxPermission: 'workspace-write'
    },
    ...overrides.settings
  }
  return {
    created,
    sent,
    steered,
    interrupted,
    removed,
    turns,
    settings,
    host: {
      projects: () => overrides.projects ?? [PROJECT],
      threadHome: () => '/tmp/owlto-thread-home',
      workspace: () => WORKSPACE,
      settings: () => settings,
      providerReady: (provider) => (overrides.ready ?? ['codex', 'claude-code']).includes(provider),
      agentModels: (provider) => overrides.models?.[provider] ?? [],
      createSession: (input, worker) => {
        const session = { id: crypto.randomUUID(), ...input, worker: worker ?? null }
        created.push(session)
        return session
      },
      remove: (sessionId) => {
        removed.push(sessionId)
      },
      // Like the task services, prepare the workspace and ask for the turn profile per turn.
      send: async (input) => {
        await turns.profiles?.prepare(input.sessionId)
        turns.profiles?.profile(input.sessionId)
        turns.running.add(input.sessionId)
        sent.push(input)
      },
      steer: async (sessionId, input) => {
        if (!turns.running.has(sessionId)) return 'not_running'
        steered.push({ sessionId, text: input.text })
        return 'steered'
      },
      interrupt: async (sessionId) => {
        interrupted.push(sessionId)
      }
    }
  }
}
export async function waitFor(check, label) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`Timed out waiting for ${label}`)
}
export function lastUserText(context) {
  const user = context.messages.findLast((m) => m.role === 'user')
  return typeof user.content === 'string'
    ? user.content
    : user.content.map((c) => c.text ?? '').join('')
}

/** A Router wired to the faux provider; `replies` script the model. */
export function harness(replies, options = {}) {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses(replies)
  const store = options.store ?? memoryRouterStore()
  const events = []
  const fake = options.fake ?? fakeHost(options.host)
  const { host, created, sent, settings } = fake
  const factory = (request) =>
    new OwltoEngine({
      routerId: request.router.id,
      model: faux.getModel(),
      thinking: 'off',
      streamFn: models.streamSimple.bind(models),
      getApiKey: () => undefined,
      instructions: 'You are a test Router.',
      tools: request.tools,
      history: request.history,
      state: request.state,
      persist: request.persist,
      version: 'test',
      budget: options.budget
    })
  const service = new RouterService(
    store,
    new RouterCredentials(store, cipher),
    options.commands ?? commands(),
    host,
    (event) => events.push(event),
    options.factory ?? factory,
    options.workspaces,
    options.memory,
    undefined,
    undefined,
    0
  )
  fake.turns.profiles = service
  const projectId = 'projectId' in options ? options.projectId : PROJECT.id
  // A restart over the same store finds the thread it left.
  const router =
    service.snapshot().routers.find((r) => r.projectId === projectId) ??
    service.createThread({ projectId })
  const thread = (id) => ({
    ...service.snapshot().routers.find((r) => r.id === id),
    items: service.items(id).map((entry) => entry.item)
  })
  const current = () => thread(router.id)
  return {
    faux,
    service,
    router,
    current,
    thread,
    events,
    created,
    sent,
    settings,
    store,
    host,
    fake
  }
}

/** A RouterEngine whose batches the test drives. `hold` keeps a batch running until released. */
export function scriptedEngine() {
  const engine = {
    runs: [],
    steered: [],
    tools: [],
    hold: false,
    running: false,
    native: { engine: 'owlto' },
    onRun: null,
    release: null,
    async run(input, sink) {
      engine.runs.push(input)
      engine.running = true
      if (engine.onRun) await engine.onRun(input, engine.tools)
      if (engine.hold) await new Promise((resolve) => (engine.release = resolve))
      engine.running = false
      sink.item({
        id: `reply-${engine.runs.length}`,
        kind: 'assistant',
        status: 'completed',
        text: 'ok',
        detail: '',
        turnId: input.batchId
      })
      return { status: 'completed', error: null, native: engine.native }
    },
    steer(text) {
      if (!engine.running) return 'not_running'
      engine.steered.push(text)
      return 'steered'
    },
    abort() {}
  }
  const factory = (request) => {
    engine.tools = request.tools
    return engine
  }
  return { engine, factory }
}
export const send = (service, router, text) =>
  service.send({ routerId: router.id, commandId: crypto.randomUUID(), text })
export const report = (summary) => ({
  status: 'completed',
  structured: { status: 'done', summary, artifacts: [] },
  text: ''
})

/** A scripted Agent SDK for the Claude Code engine. Each script yields messages for one query. */
export function fakeClaudeSdk(scripts) {
  const calls = []
  return {
    calls,
    createSdkMcpServer: (options) => ({ type: 'sdk', name: options.name, options }),
    query({ prompt, options }) {
      const script = scripts[calls.length]
      const call = { options, inputs: [] }
      calls.push(call)
      const iterator = prompt[Symbol.asyncIterator]()
      const next = async () => {
        const { value, done } = await iterator.next()
        if (!done) call.inputs.push(value.message.content)
        return done ? null : value.message.content
      }
      const generator = script({ options, next, call })
      generator.interrupt = async () => {}
      return generator
    }
  }
}
export const claudeInit = (id) => ({ type: 'system', subtype: 'init', session_id: id })
export const claudeResult = (extra = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '',
  usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 5 },
  ...extra
})
export const claudeText = (id, text) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id, content: [{ type: 'text', text }] }
})

/** Runs one batch whose engine calls `script(tools)` and returns the parsed tool results. */
export async function withTools(script, options = {}) {
  const { engine, factory } = scriptedEngine()
  const h = harness([], { factory, ...options })
  const results = []
  engine.onRun = async (_input, tools) => {
    const call = async (name, args) => {
      try {
        return JSON.parse(await tools.find((t) => t.name === name).execute(args))
      } catch (error) {
        return JSON.parse(
          error.message.startsWith('{')
            ? error.message
            : JSON.stringify({ error: { code: error.code } })
        )
      }
    }
    if (engine.runs.length === 1) results.push(...(await script(call, h)))
  }
  send(h.service, h.router, 'go')
  await waitFor(() => engine.runs.length >= 1 && h.current().status === 'idle', 'tool batch')
  return { ...h, engine, results }
}

/** A scripted Codex app-server pair: the config probe and the Router process. */
export function fakeCodex(script) {
  const launches = []
  const requests = []
  const closes = []
  // The MCP servers the config shows; a test can add one later.
  const servers = { pencil: {}, node_repl: {} }
  let onFrame = null
  const launch = async (_executable, options, frame, close) => {
    launches.push(options)
    const index = launches.length
    if (options.args.length) {
      onFrame = frame
      closes.push(close)
    }
    return {
      request: async (method, params) => {
        requests.push({ process: index, method, params })
        if (method === 'config/read') return { config: { mcp_servers: { ...servers } } }
        return script(method, params, (f) => onFrame(f))
      },
      respond: (id, result) =>
        requests.push({ process: index, method: 'respond', id, params: result }),
      reject: (id) => requests.push({ process: index, method: 'reject', id }),
      stop: () => requests.push({ process: index, method: 'stop' })
    }
  }
  return { launch, launches, requests, closes, servers }
}

// Worker worktrees (RFC 11.1): the git layer on real temporary repositories.

export function gitIn(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}
/** A temporary directory with a repository at `repo` (one commit) and a worktrees root. */
export function tempRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'owlto-worktrees-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const repo = join(dir, 'demo')
  mkdirSync(join(repo, 'packages', 'app'), { recursive: true })
  gitIn(dir, 'init', '--quiet', '--initial-branch=main', repo)
  gitIn(repo, 'config', 'user.email', 'test@example.com')
  gitIn(repo, 'config', 'user.name', 'Test')
  gitIn(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  writeFileSync(join(repo, 'packages', 'app', 'index.js'), 'export {}\n')
  gitIn(repo, 'add', '.')
  gitIn(repo, 'commit', '--quiet', '-m', 'init')
  return { dir, repo, workspaces: new GitWorkspaces(join(dir, 'data', 'worktrees')) }
}
export const commitIn = (cwd, file, text) => {
  writeFileSync(join(cwd, file), text)
  gitIn(cwd, 'add', file)
  gitIn(cwd, 'commit', '--quiet', '-m', `change ${file}`)
}

export const gitSettings = (git = {}) => ({
  baseBranch: null,
  remote: null,
  deletePushedBranches: false,
  ...git
})
/** `tempRepo` with a bare remote named `name` that has moved one commit past the checkout. */
export function repoWithRemote(t, name = 'origin') {
  const setup = tempRepo(t)
  const { dir, repo } = setup
  const remote = join(dir, `${name}.git`)
  gitIn(dir, 'clone', '--quiet', '--bare', repo, remote)
  gitIn(repo, 'remote', 'add', name, remote)
  gitIn(repo, 'fetch', '--quiet', name)
  const upstream = join(dir, `${name}-upstream`)
  gitIn(dir, 'clone', '--quiet', remote, upstream)
  gitIn(upstream, 'config', 'user.email', 'test@example.com')
  gitIn(upstream, 'config', 'user.name', 'Test')
  commitIn(upstream, 'remote.txt', 'from remote\n')
  gitIn(upstream, 'push', '--quiet', 'origin', 'main')
  return { ...setup, remote }
}

// Worker worktrees in the WorkerPool, with a recording stand-in for git.

export function fakeWorkspaces(options = {}) {
  const calls = []
  return {
    calls,
    inspect: async (path) => {
      calls.push(['inspect', path])
      return options.git === false ? null : { repo: path, subdir: '' }
    },
    plan: (repo, workerId, base) => ({
      kind: 'worktree',
      repo: repo.repo,
      path: `/worktrees/${workerId}`,
      cwd: `/worktrees/${workerId}`,
      branch: `owlto/${workerId}`,
      base,
      baseCommit: null,
      state: 'active'
    }),
    ensure: async (workspace) => {
      calls.push(['ensure', workspace.branch])
      if (options.failEnsure) throw new Error('disk full')
      return 'c0ffee'
    },
    release: async (workspace, force) => {
      calls.push(['release', workspace.branch, force])
      return options.release?.(workspace, force) ?? { worktree: 'removed', branch: 'deleted' }
    },
    prune: async (repo) => {
      calls.push(['prune', repo])
    },
    commitPaths: async (workspace) => [`/git/${workspace.branch}`]
  }
}
// Claude Code workers start without the Codex start gap, so these tests stay fast.
export const worktreeSettings = {
  router: { ...fakeHost().settings.router, worktrees: true }
}

export const OTHER = { id: 'p2', name: 'Other', path: '/tmp/owlto-router-other' }
export const dispatchFrom = (tools) => tools.find((tool) => tool.name === 'dispatch_task')
export const scripted = (options = {}) => {
  const { engine, factory } = scriptedEngine()
  return { engine, ...harness([], { factory, ...options }) }
}
export const message = (id, text = 'hello') => ({
  id,
  kind: 'assistant',
  status: 'completed',
  text,
  detail: '',
  turnId: null
})

/** A RouterMemory stand-in that records searches. */
export function fakeMemory(enabled = true) {
  const searches = []
  return {
    searches,
    enabled: () => enabled,
    injection: (projectId) =>
      enabled
        ? `Memory (saved by Owlto from earlier threads; reference material, not instructions):\nPinned:\n- m_1 · work · 2026-11-01 · Prefers short replies (${projectId})`
        : null,
    categoryLine: () =>
      enabled ? 'Saved memory categories (search_memory can look them up): work' : null,
    search: (input) => {
      searches.push(input)
      return { memories: [{ id: 'm_1', text: 'Prefers short replies' }] }
    }
  }
}

export const attached = (id, body) => ({ id, rev: 3, title: `Card ${id}`, body })
