#!/usr/bin/env node
/**
 * A development host for the iOS app: the desktop app's real Remote Router host
 * (`RemoteService` — pairing, handshake, encryption, RPC) with a scripted Router behind it, so
 * the phone can be built and tested without a real Mac setup, agents, or API keys.
 *
 * It loads the desktop app's built main-process code, so build that first:
 *
 *   pnpm --filter owlto-client build
 *   node apps/owlto-ios/scripts/dev-host.mjs [--port 47330] [--data <dir>]
 *
 * It prints a pairing code; in the simulator, pair with 127.0.0.1:<port>. Pairings persist in
 * the data directory (default: a folder in the system temp directory).
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = dirname(fileURLToPath(import.meta.url))
const client = resolve(here, '../../owlto-client')
const require = createRequire(import.meta.url)
const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '47330' },
    data: { type: 'string', default: join(tmpdir(), 'owlto-ios-dev-host') },
    /** A relay to register with, e.g. ws://127.0.0.1:8790 from `pnpm --filter @owlto/relay serve`. */
    relay: { type: 'string' }
  }
})

let runtime
try {
  runtime = require(join(client, 'out/main/app/runtime.js'))
} catch (error) {
  console.error('Build the desktop app first: pnpm --filter owlto-client build\n', error.message)
  process.exit(1)
}
const {
  OwltoStore,
  RemoteService,
  RemoteStore,
  connectFrames,
  dialRelay,
  dropRelayItem,
  lookupRendezvous,
  tcpListen,
  toFailure
} = runtime
if (!RemoteService) {
  console.error('This build of the desktop app has no Remote Router. Build a branch that has it.')
  process.exit(1)
}
const { openSqlite } = await import(join(client, 'tests/fixtures/sqlite.mjs'))

mkdirSync(args.data, { recursive: true })
const db = new OwltoStore(openSqlite(join(args.data, 'owlto.db')), join(client, 'migrations'))

/** Dev only: keeps the host's identity key in the clear. A real Mac uses safeStorage. */
const cipher = {
  unavailable: async () => null,
  encrypt: async (plain) => `dev:${Buffer.from(plain).toString('base64')}`,
  decrypt: async (encoded) => ({
    plain: Buffer.from(encoded.slice(4), 'base64').toString(),
    stale: false
  })
}

// MARK: Sample state

const now = () => new Date().toISOString()
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()
const projects = [
  { id: 'project-owls', name: 'Owls', path: '/Users/dev/Owls' },
  { id: 'project-website', name: 'website', path: '/Users/dev/website' }
]
const routers = new Map()
const items = new Map()
const workers = new Map()
const sessions = new Map()
let rev = 1

function item(kind, text, extra = {}) {
  return { id: randomUUID(), kind, status: 'completed', text, detail: '', turnId: null, ...extra }
}
function newRouter(title, projectId, updatedAt = now()) {
  const router = {
    id: randomUUID(),
    deviceId: db.deviceId,
    title,
    projectId,
    cwd: '/Users/dev',
    status: 'idle',
    rev: rev++,
    itemCount: 0,
    preview: null,
    projectsShown: null,
    error: null,
    tokens: null,
    native: null,
    unknownBatches: [],
    archivedAt: null,
    createdAt: updatedAt,
    updatedAt
  }
  routers.set(router.id, router)
  items.set(router.id, [])
  return router
}
function newWorker(router, provider, goal, status, extra = {}) {
  const session = {
    id: randomUUID(),
    provider,
    threadId: null,
    title: goal,
    cwd: '/Users/dev/Owls',
    projectPath: '/Users/dev/Owls',
    model: null,
    effort: null,
    permission: 'workspace-write',
    status: status === 'running' ? 'running' : 'idle',
    turnId: null,
    error: null,
    items: [item('user', goal)],
    requests: [],
    diff: '',
    tokens: null,
    createdAt: now(),
    updatedAt: now()
  }
  sessions.set(session.id, session)
  const worker = {
    id: `wk_${randomUUID().slice(0, 8)}`,
    routerId: router.id,
    projectId: router.projectId,
    sessionId: session.id,
    provider,
    goal,
    title: null,
    parentId: null,
    context: null,
    permission: 'workspace-write',
    next: null,
    pending: [],
    status,
    workspace: {
      kind: 'worktree',
      path: '/tmp/wt',
      cwd: '/tmp/wt',
      branch: `${provider === 'codex' ? 'codex' : 'claude'}/${goal.slice(0, 12).replace(/\W+/g, '-').toLowerCase()}`,
      base: 'head',
      baseBranch: null,
      baseCommit: null,
      state: 'active'
    },
    pullRequest: null,
    report: null,
    degraded: false,
    createdAt: now(),
    updatedAt: now(),
    ...extra
  }
  workers.set(worker.id, worker)
  return { worker, session }
}

// The pending request a phone can approve; ids are UUIDs, as the host's schemas require.
function commandRequest(session, command) {
  const request = {
    id: randomUUID(),
    kind: 'command',
    title: 'Run a command',
    detail: command,
    questions: [],
    status: 'pending',
    turnId: randomUUID()
  }
  session.requests.push(request)
  session.status = 'waiting'
  return request
}

const SAMPLE_DIFF = `diff --git a/apps/owlto-client/src/main/remote/rpc.ts b/apps/owlto-client/src/main/remote/rpc.ts
index 1111111..2222222 100644
--- a/apps/owlto-client/src/main/remote/rpc.ts
+++ b/apps/owlto-client/src/main/remote/rpc.ts
@@ -58,6 +58,10 @@ export class RpcConnection {
   async function handle(frame: Frame) {
-    const { method, params } = frame
+    const parsed = remoteCallSchema.safeParse(frame)
+    if (!parsed.success) {
+      return reply(frame.id, fail('invalid'))
+    }
+    const { method, params } = parsed.data
     reply(frame.id, ok(result))
   }
diff --git a/apps/owlto-client/tests/admin/remote-router.test.mjs b/apps/owlto-client/tests/admin/remote-router.test.mjs
new file mode 100644
--- /dev/null
+++ b/apps/owlto-client/tests/admin/remote-router.test.mjs
@@ -0,0 +1,3 @@
+import assert from 'node:assert/strict'
+import test from 'node:test'
+test('pairs with a code', async () => {})
`

function seed() {
  const busy = newRouter('移动端配对后的消息转发', 'project-owls', minutesAgo(2))
  const done = newWorker(busy, 'codex', '梳理 remote RPC 方法和 schema 校验', 'reported', {
    report: {
      status: 'done',
      summary:
        '12 个方法在 host 端都用本地 IPC 的同一套 schema 再校验一次。`sendRouter` 会拒绝笔记和附件。',
      artifacts: [{ kind: 'file', ref: 'src/main/remote/rpc.ts' }]
    }
  })
  done.session.items.push(item('assistant', '梳理完了：12 个方法都在 host 端再校验。'))
  done.session.diff = SAMPLE_DIFF
  const testing = newWorker(busy, 'claude-code', '为 remote-router 补集成测试', 'running', {
    pending: [{ id: 'pm_1', text: '顺便覆盖一下配对码过期的情况', createdAt: now() }],
    pullRequest: { owner: 'jackeydou', name: 'Owls', branch: 'claude/remote-tests', number: 192 }
  })
  testing.session.items.push(
    item('command', 'pnpm --filter owlto-client build'),
    item('files', 'tests/admin/remote-router.test.mjs'),
    item('assistant', '18 个用例写好了，跑一遍 test:admin。')
  )
  testing.session.diff = SAMPLE_DIFF
  commandRequest(testing.session, 'pnpm --filter owlto-client test:admin')
  pushItems(
    busy,
    [
      item(
        'user',
        '手机配对之后，要能在手机上给 Router 发消息、看到 Worker 的结果。先梳理 remote 的 RPC 方法，再补集成测试。'
      ),
      item('tool', 'list_projects'),
      item('assistant', '好的，拆成两件事并行做：'),
      item('worker', 'dispatch', { workerId: done.worker.id }),
      item('worker', 'dispatch', { workerId: testing.worker.id }),
      item('assistant', '第一个 Worker 完成了：12 个方法在 host 端都用同一套 schema 再校验一次。')
    ],
    false
  )

  const release = newRouter('Release 2026.11.1800 发布检查', 'project-owls', minutesAgo(18))
  release.unknownBatches = [{ id: 'batch_1', events: 2, createdAt: minutesAgo(20) }]
  const notes = newWorker(release, 'cursor', '发布说明补 Highlights', 'reported', {
    report: {
      status: 'needs_input',
      summary: '要不要在 Highlights 里写 Remote Router？',
      artifacts: []
    }
  })
  notes.session.requests.push({
    id: randomUUID(),
    kind: 'question',
    title: 'Highlights',
    detail: '',
    status: 'pending',
    turnId: randomUUID(),
    questions: [
      {
        id: 'q1',
        header: 'Highlights',
        question: '这次发布的 Highlights 要不要写 Remote Router？',
        isSecret: false,
        options: [
          { label: '写，放第一条', description: '它是这次最大的变化' },
          { label: '先不写', description: '等手机端一起发' }
        ]
      }
    ]
  })
  pushItems(
    release,
    [
      item('user', '检查 2026.11.1800 能不能发布'),
      item('worker', 'dispatch', { workerId: notes.worker.id }),
      item('assistant', 'release:check 通过，DMG 已上传。发布说明等你确认。')
    ],
    false
  )

  const hover = newRouter('侧边栏 hover 颜色统一', 'project-owls', minutesAgo(65))
  const hoverWorker = newWorker(hover, 'claude-code', '统一侧边栏 hover 颜色', 'reported', {
    report: { status: 'done', summary: '改好了，PR 检查已通过。', artifacts: [] }
  })
  pushItems(
    hover,
    [
      item('user', '侧边栏 hover 颜色统一成一种'),
      item('worker', 'dispatch', { workerId: hoverWorker.worker.id }),
      item('assistant', '改好了，PR 检查已通过，可以合并。')
    ],
    false
  )
}

function pushItems(router, added, notify = true) {
  const list = items.get(router.id)
  const entries = added.map((it) => ({
    item: it,
    position: list.length + added.indexOf(it),
    rev: rev++
  }))
  list.push(...entries)
  router.itemCount = list.length
  const last = [...added].reverse().find((it) => it.kind === 'assistant')
  if (last) router.preview = last.text
  router.updatedAt = now()
  router.rev = rev++
  if (notify) {
    emit({ type: 'thread-items', routerId: router.id, items: entries })
    emit({ type: 'router', router })
  }
}

function emit(event) {
  service.observe(event)
}
function touchWorker(worker) {
  worker.updatedAt = now()
  emit({ type: 'worker', worker })
}
function touchSession(session) {
  session.updatedAt = now()
  emit({ type: 'session', session })
}
const later = (ms, fn) => setTimeout(fn, ms)

// MARK: Scripted Router

function routerReply(router, text) {
  router.status = 'running'
  emit({ type: 'router', router })
  later(1500, () => {
    const { worker, session } = newWorker(router, 'claude-code', text.slice(0, 40), 'running')
    touchWorker(worker)
    touchSession(session)
    pushItems(router, [
      item('assistant', `收到：「${text}」。派一个 Worker 去做。`),
      item('worker', 'dispatch', { workerId: worker.id })
    ])
    router.status = 'idle'
    emit({ type: 'router', router })
    later(2500, () => {
      session.items.push(item('assistant', '先跑一下测试。'))
      commandRequest(session, 'pnpm test')
      touchSession(session)
    })
  })
}

function finishWorker(worker, session) {
  worker.status = 'reported'
  worker.report = {
    status: 'done',
    summary: '做完了，测试全部通过。',
    artifacts: [{ kind: 'file', ref: 'src/main/remote/rpc.ts' }]
  }
  session.status = 'idle'
  session.items.push(item('assistant', '做完了，测试全部通过。'))
  session.diff = SAMPLE_DIFF
  touchSession(session)
  touchWorker(worker)
  const router = routers.get(worker.routerId)
  pushItems(router, [item('assistant', `「${worker.goal}」完成了。`)])
}

function findRequest(requestId) {
  for (const session of sessions.values()) {
    const request = session.requests.find((r) => r.id === requestId)
    if (request) return { session, request }
  }
  return null
}

const api = {
  snapshot: () => ({
    sessions: [...sessions.values()],
    projects,
    connection: {
      status: 'ready',
      executablePath: null,
      version: null,
      account: { kind: 'external' },
      models: [],
      error: null
    },
    claude: {},
    cursor: {},
    routers: [...routers.values()],
    workers: [...workers.values()]
  }),
  threadItems: ({ routerId, after }) =>
    (items.get(routerId) ?? []).filter((entry) => (entry.rev ?? 0) > after),
  createThread: ({ projectId }) => {
    const router = newRouter(null, projectId)
    emit({ type: 'router', router })
    return router
  },
  stageAttachment: ({ name, mimeType, data }) => {
    const attachment = { id: randomUUID(), name, mimeType, size: data.byteLength }
    console.log(`staged ${name} (${mimeType}, ${data.byteLength} bytes)`)
    return attachment
  },
  sendRouter: ({ routerId, text, workerId, attachments }) => {
    if (attachments?.length)
      console.log(`message carries ${attachments.map((a) => a.name).join(', ')}`)
    const router = routers.get(routerId)
    if (!router) throw new Error('No such thread.')
    if (!router.title) router.title = text.slice(0, 30)
    if (workerId) {
      const worker = workers.get(workerId)
      const session = sessions.get(worker.sessionId)
      pushItems(router, [item('user', text, { workerId })])
      if (worker.status === 'running') {
        worker.pending = [
          ...(worker.pending ?? []),
          { id: `pm_${randomUUID().slice(0, 6)}`, text, createdAt: now() }
        ]
        touchWorker(worker)
      } else {
        session.items.push(item('user', text, { author: 'user' }))
        worker.status = 'running'
        touchSession(session)
        touchWorker(worker)
        later(3000, () => finishWorker(worker, session))
      }
      return
    }
    pushItems(router, [item('user', text)])
    routerReply(router, text)
  },
  interruptRouter: (routerId) => {
    const router = routers.get(routerId)
    router.status = 'interrupted'
    pushItems(router, [item('notice', '你打断了 Router。')])
  },
  archiveThread: ({ routerId, archived }) => {
    const router = routers.get(routerId)
    router.archivedAt = archived ? now() : null
    emit({ type: 'router', router })
  },
  resolveBatch: ({ routerId, batchId }) => {
    const router = routers.get(routerId)
    router.unknownBatches = router.unknownBatches.filter((b) => b.id !== batchId)
    emit({ type: 'router', router })
  },
  stopWorker: ({ workerId }) => {
    const worker = workers.get(workerId)
    worker.status = 'stopped'
    touchWorker(worker)
  },
  steerPendingMessage: ({ workerId, messageId }) => {
    const worker = workers.get(workerId)
    const message = worker.pending.find((m) => m.id === messageId)
    worker.pending = worker.pending.filter((m) => m.id !== messageId)
    const session = sessions.get(worker.sessionId)
    if (message) session.items.push(item('user', message.text, { author: 'user' }))
    touchSession(session)
    touchWorker(worker)
  },
  dropPendingMessage: ({ workerId, messageId }) => {
    const worker = workers.get(workerId)
    worker.pending = worker.pending.filter((m) => m.id !== messageId)
    touchWorker(worker)
  },
  respond: ({ requestId, decision, answers }) => {
    const found = findRequest(requestId)
    if (!found) throw new Error('That request is gone.')
    found.request.status = 'resolved'
    const worker = [...workers.values()].find((w) => w.sessionId === found.session.id)
    found.session.items.push(
      item(
        'notice',
        decision === 'accept'
          ? `已批准${answers ? `：${Object.values(answers).flat().join('、')}` : ''}`
          : decision === 'decline'
            ? '已拒绝'
            : '已取消这一轮'
      )
    )
    found.session.status = 'running'
    touchSession(found.session)
    if (worker && decision === 'accept') later(2500, () => finishWorker(worker, found.session))
  },
  previewFile: ({ ref }) => ({
    status: 'ok',
    preview: {
      path: `/Users/dev/Owls/apps/owlto-client/${ref}`,
      name: ref.split('/').pop(),
      label: `Owls/${ref}`,
      size: 512,
      line: null,
      body: {
        kind: 'text',
        text: 'export class RpcConnection {\n  private nextId = 1\n  request(method: string, params: unknown) {\n    return this.send({ t: "req", id: this.nextId++, method, params })\n  }\n}\n',
        truncated: false
      }
    }
  })
}

// Log each call the phone makes, so a run can be checked from the host side too.
for (const [method, run] of Object.entries(api)) {
  api[method] = (input) => {
    if (method !== 'snapshot' && method !== 'threadItems')
      console.log(`← ${method} ${JSON.stringify(input)}`)
    return run(input)
  }
}

// MARK: Host

const port = Number(args.port)
let access = true
const service = new RemoteService({
  port,
  store: new RemoteStore(db.db),
  cipher,
  deviceId: db.deviceId,
  appVersion: 'dev-host',
  api,
  accessEnabled: () => access,
  saveAccess: (enabled) => {
    access = enabled
  },
  // Without --relay the dev host stays direct only.
  relayEnabled: () => Boolean(args.relay),
  saveRelay: () => {},
  relayUrl: args.relay,
  keepAwakeEnabled: () => false,
  saveKeepAwake: () => {},
  listen: tcpListen,
  dial: connectFrames,
  dialRelay,
  lookupRendezvous,
  dropItem: dropRelayItem,
  readAttachment: () => Promise.reject(new Error('The dev host drives no other device.')),
  // A local relay runs without accounts, so the dev host never signs in.
  credentials: { credential: () => null, saveCredential: () => {}, removeCredential: () => {} },
  toFailure,
  changed: (overview) => report(overview),
  remoteEvent: () => {},
  deviceName: () => 'Owlto Dev Host',
  addresses: () => ['127.0.0.1']
})

let lastLine = ''
function report(overview) {
  const clients =
    overview.clients.map((c) => `${c.name}${c.connected ? ' (connected)' : ''}`).join(', ') ||
    'none'
  const relay = overview.pairing?.relayCode ? ` · relay code ${overview.pairing.relayCode}` : ''
  const line = `paired phones: ${clients}${overview.pairing ? ` · pairing code ${overview.pairing.code.replace(/(....)/, '$1-')}${relay}` : ''}`
  if (line !== lastLine) console.log(line)
  lastLine = line
}

seed()
const started = await service.setAccess(true)
if (!started.listening) {
  console.error(started.listenError ?? `Could not listen on port ${port}.`)
  process.exit(1)
}

function pairingLoop() {
  const overview = service.startPairing()
  report(overview)
  console.log(
    `\nPair the phone with 127.0.0.1:${port} and code ${overview.pairing.code.replace(/(....)/, '$1-')}\n`
  )
  if (overview.pairing.invite)
    console.log(`Or scan / paste this invite:\n${overview.pairing.invite}\n`)
  setTimeout(pairingLoop, 4.5 * 60_000).unref()
}
pairingLoop()
process.on('SIGINT', () => {
  service.close()
  process.exit(0)
})
