// The architectures the M4 benchmark compares. The Router arms drive the real
// RouterService, WorkerPool, and Owls engine from the built app; only the model
// (a scripted faux provider) and the worker tasks are simulated.
import { createRequire } from 'node:module'
import { Agent } from '@earendil-works/pi-agent-core'
import { createModels, fauxProvider } from '@earendil-works/pi-ai'
import { cipher, commands, memoryRouterStore } from '../../tests/fixtures/router-store.mjs'
import { Meter, MINUTE, Policy, Slots } from './sim.mjs'

const require = createRequire(import.meta.url)
const {
  OwlsEngine,
  RouterCredentials,
  RouterService,
  ROUTER_INSTRUCTIONS
} = require('../../out/main/codex/runtime.js')

const PROJECT = { id: 'bench', name: 'bench', path: '/tmp/owls-router-bench' }
/** Matches WORKER_LIMIT, so every architecture runs at most four tasks at once. */
const PARALLEL = 4
/** Modeled time for `git worktree add` in a medium repository, paid once per worker. */
export const WORKTREE_CREATE_MS = 2000

/**
 * Worktrees as the WorkerPool sees them (RFC 11.1): every project is a
 * repository, and a worker's first turn waits while its worktree is created.
 */
function simulatedWorkspaces(clock) {
  const created = new Set()
  return {
    inspect: async (path) => ({ repo: path, subdir: '' }),
    plan: (repo, workerId, base) => ({
      kind: 'worktree',
      repo: repo.repo,
      path: `${repo.repo}/.worktrees/${workerId}`,
      cwd: `${repo.repo}/.worktrees/${workerId}`,
      branch: `owls/${workerId}`,
      base,
      baseCommit: null,
      state: 'active'
    }),
    ensure: async (workspace) => {
      if (!created.has(workspace.path)) {
        created.add(workspace.path)
        await clock.sleep(WORKTREE_CREATE_MS)
      }
      return 'bench'
    },
    release: async () => ({ worktree: 'removed', branch: 'deleted' }),
    prune: async () => {}
  }
}

/**
 * Fixed per-request context of each Router engine, in tokens. Claude Code and
 * Codex are the live per-request totals from F24 and F28; the benchmark adds
 * whatever exceeds the Owls engine's own system prompt and tools. Owls is 0:
 * its fixed context is what the request actually contains.
 */
export const ENGINE_CONTEXT = { owls: 0, 'claude-code': 3000, codex: 17_500 }

/** A faux model whose every response comes from `policy` after a simulated delay. */
function scriptedModel(clock, policy, meter, overhead, onReply) {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const step = async (context) => {
    faux.appendResponses([step])
    const message = policy.respond(context)
    await clock.sleep(meter.measure(context, message, overhead))
    onReply(message)
    return message
  }
  faux.setResponses([step])
  return { model: faux.getModel(), streamFn: models.streamSimple.bind(models) }
}

/**
 * Records when each request, follow-up, and chatter message arrives and when
 * its answer becomes visible to the user, and releases follow-ups once the
 * work they follow is visible.
 */
class Tracker {
  arrived = new Map()
  visible = new Map()
  constructor(clock, load, deliver) {
    this.clock = clock
    this.load = load
    this.deliver = deliver
  }
  arrive(id) {
    this.arrived.set(id, this.clock.now)
  }
  show(id) {
    if (this.visible.has(id) || !this.arrived.has(id)) return
    this.visible.set(id, this.clock.now)
    const unit = this.load.units.get(id)
    const parent = unit?.followUps ? unit : this.load.units.get(unit?.parent)
    if (!parent?.followUps) return
    const next = parent.followUps[unit.followUps ? 0 : parent.followUps.indexOf(unit) + 1]
    if (next)
      this.clock.after(next.delayMs, () => {
        this.arrive(next.id)
        this.deliver(next)
      })
  }
  /** Reads `ack <id>` and `[[result <id>]]` markers from a model reply. */
  reply(message) {
    for (const c of message.content) {
      if (c.type !== 'text') continue
      for (const m of c.text.matchAll(/ack (C\d+)|\[\[result ([RF][\d.]+)\]\]/g))
        this.show(m[1] ?? m[2])
    }
  }
  latencies(prefix) {
    return [...this.arrived]
      .filter(([id]) => id.startsWith(prefix))
      .map(([id, at]) => (this.visible.has(id) ? this.visible.get(id) - at : null))
  }
}

function schedule(clock, load, tracker, send) {
  for (const message of [...load.chatter, ...load.work])
    clock.at(message.at, () => {
      tracker.arrive(message.id)
      send(`<${message.id}> ${message.text}`)
    })
}

/**
 * Owls Router + workers. `passthrough` true delivers follow-ups straight to the
 * worker; false sends them to the Router (the article's "no event passthrough" arm);
 * `permission` 'workspace-write' makes workers in one checkout run one at a
 * time, unless `worktrees` gives each its own git worktree.
 */
export async function runRouter(clock, load, options) {
  const meter = new Meter()
  const store = memoryRouterStore()
  const policy = new Policy('router', options.permission)
  const overhead = (fixed) => Math.max(0, ENGINE_CONTEXT[options.engine] - fixed)
  const tracker = new Tracker(clock, load, (f) =>
    options.passthrough ? directed(f) : send(`<${f.id}> ${f.text}`)
  )
  const { model, streamFn } = scriptedModel(clock, policy, meter, overhead, (m) => tracker.reply(m))
  const settings = {
    permission: 'workspace-write',
    provider: 'claude-code',
    model: null,
    effort: null,
    claudeModel: null,
    claudeEffort: null,
    router: {
      engine: 'owls',
      owls: null,
      claudeModel: null,
      codexModel: null,
      maxPermission: 'workspace-write',
      worktrees: Boolean(options.worktrees)
    }
  }
  // Worker turns: each takes the simulated work time of the tags it carries.
  let sessions = 0
  const sessionOf = new Map()
  let service
  const startTurn = (sessionId, text) => {
    const tags = [...new Set([...text.matchAll(/<([RF][\d.]+)>/g)].map((m) => m[1]))]
    for (const tag of tags) if (tag.startsWith('R')) sessionOf.set(tag, sessionId)
    const workMs = tags.reduce((sum, tag) => sum + (load.units.get(tag)?.workMs ?? 0), 0)
    clock.after(workMs, () => {
      const summary = tags
        .map((tag) => `<done ${tag}> ${load.units.get(tag)?.summary ?? ''}`)
        .join('\n')
      service.settled(sessionId, {
        status: 'completed',
        structured: { status: 'done', summary: summary.slice(0, 1000), artifacts: [] },
        text: ''
      })
    })
  }
  const host = {
    projects: () => [PROJECT],
    threadHome: () => PROJECT.path,
    settings: () => settings,
    providerReady: () => true,
    createSession: (input) => ({ id: `s${++sessions}`, ...input }),
    remove: () => {},
    send: async ({ sessionId, text }) => {
      await service.prepare(sessionId)
      service.profile(sessionId)
      startTurn(sessionId, text)
    },
    // Worker turns are short simulated blocks; Router follow-ups wait for the next turn.
    steer: async () => 'not_running',
    interrupt: async () => {}
  }
  service = new RouterService(
    store,
    new RouterCredentials(store, cipher),
    commands(),
    host,
    () => {},
    (request) =>
      new OwlsEngine({
        routerId: request.router.id,
        model,
        thinking: 'off',
        streamFn,
        getApiKey: () => undefined,
        instructions: ROUTER_INSTRUCTIONS,
        tools: request.tools,
        history: request.history,
        state: request.state,
        persist: request.persist,
        version: 'bench'
      }),
    options.worktrees ? simulatedWorkspaces(clock) : undefined
  )
  const router = service.createThread({ projectId: PROJECT.id })
  let commandId = 0
  const send = (text, workerId) =>
    void service.send({ routerId: router.id, commandId: `m${++commandId}`, text, workerId })
  // The user names the worker, as an @ message does (RFC 4.4); its report still goes to the Router.
  const directed = (f) => {
    const sessionId = sessionOf.get(f.parent)
    const worker = service.snapshot().workers.find((w) => w.sessionId === sessionId)
    send(`<${f.id}> ${f.text}`, worker.id)
  }
  schedule(clock, load, tracker, send)
  await clock.run(24 * 60 * MINUTE)
  const batches = store.batches('delivered')
  service.close()
  return {
    tracker,
    meter,
    batches: batches.length,
    events: batches.reduce((sum, b) => sum + b.eventSeqs.length, 0)
  }
}

const SINGLE_INSTRUCTIONS = `You are a coding agent for one software project, talking with the user and their team.

Use the task tool for any request that needs reading or changing code, running commands, or looking things up. Give each task an ID and a goal a capable engineer could act on. Reply briefly, conclusion first, and answer questions that need no work directly.`

/**
 * One agent session handles everything, delegating work to subagents.
 * `background` false waits for each subagent inside the turn, as the default
 * Task tool does; true returns at once and reports the result as a new message.
 */
export async function runSingle(clock, load, options) {
  const meter = new Meter()
  const policy = new Policy('single')
  const slots = new Slots(PARALLEL)
  let agent
  let running = false
  const queue = []
  const receive = (text) => {
    if (running) agent.steer({ role: 'user', content: text, timestamp: clock.now })
    else {
      queue.push(text)
      void pump()
    }
  }
  const pump = async () => {
    if (running || !queue.length) return
    running = true
    await agent.prompt(queue.splice(0).join('\n\n'))
    running = false
    void pump()
  }
  const tracker = new Tracker(clock, load, (f) => receive(`<${f.id}> ${f.text}`))
  const { model, streamFn } = scriptedModel(
    clock,
    policy,
    meter,
    () => 0,
    (m) => tracker.reply(m)
  )
  const work = async (id) => {
    await slots.take()
    await clock.sleep(load.units.get(id)?.workMs ?? 0)
    slots.release()
    return `<done ${id}> ${load.units.get(id)?.summary ?? ''}`
  }
  const task = {
    name: 'task',
    label: 'Task',
    description: 'Runs a subagent on one piece of work and returns its summary.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, prompt: { type: 'string' } },
      required: ['id', 'prompt'],
      additionalProperties: false
    },
    execute: async (_callId, params) => {
      if (!options.background)
        return { content: [{ type: 'text', text: await work(params.id) }], details: {} }
      void work(params.id).then((text) => receive(`Background task finished.\n${text}`))
      return { content: [{ type: 'text', text: `Started ${params.id}.` }], details: {} }
    }
  }
  agent = new Agent({
    initialState: {
      systemPrompt: SINGLE_INSTRUCTIONS,
      model,
      thinkingLevel: 'off',
      tools: [task],
      messages: []
    },
    streamFn,
    getApiKey: () => undefined,
    sessionId: 'single',
    toolExecution: 'parallel',
    steeringMode: 'all'
  })
  schedule(clock, load, tracker, receive)
  await clock.run(24 * 60 * MINUTE)
  return { tracker, meter, batches: null, events: null }
}
