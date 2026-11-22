/**
 * The CDP gate: a loopback WebSocket that speaks just enough of Chrome's browser-level
 * DevTools protocol for Playwright's `connectOverCDP`, backed by the debuggers of Owlto's
 * own browser tabs instead of a real browser endpoint.
 *
 * Electron's `--remote-debugging-port` would expose every target, Owlto's own window
 * included, to any local process. The gate exposes only browser tabs, and each endpoint
 * only the tabs of the worker it was issued for. See docs/RFC_OWLTO_IN_APP_BROWSER.md.
 */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { type RawData, type WebSocket, WebSocketServer } from 'ws'

export type CdpParams = Record<string, unknown> | undefined

/** One tab, as the gate needs it. */
export interface GateTab {
  readonly id: string
  /** The worker key that owns it. */
  readonly key: string
  /** Sends a CDP command to the page, or to one of its child sessions (frames, workers). */
  send(method: string, params: CdpParams, sessionId?: string): Promise<unknown>
}

/** What the gate asks of the browser that owns the tabs. */
export interface GateBackend {
  /** What `Browser.getVersion` reports. The user agent must not say Headless. */
  version(): { product: string; userAgent: string }
  tabs(key: string): GateTab[]
  createTab(key: string, url: string): Promise<GateTab>
  closeTab(key: string, tabId: string): boolean
  activateTab(key: string, tabId: string): void
  /** False while the user holds the tab; input from scripts is refused then. */
  agentMayDrive(tabId: string): boolean
  /** Sees each command a script sends a tab, to name what the agent is doing. */
  noteCommand(tabId: string, method: string, params: CdpParams): void
}

type TargetInfo = { targetId: string; [field: string]: unknown }
type TabSession = { tab: GateTab; sessionId: string; targetInfo: TargetInfo; children: Set<string> }
type Client = {
  key: string
  socket: WebSocket
  autoAttach: boolean
  /** By tab id. */
  sessions: Map<string, TabSession>
  attaching: Map<string, Promise<TabSession>>
}
type Command = { id: number; method: string; params?: CdpParams; sessionId?: string }

/** Commands a page session may not send: they reach outside the tab. */
const SESSION_BLOCKED = new Set([
  'Target.createTarget',
  'Target.closeTarget',
  'Target.createBrowserContext',
  'Target.disposeBrowserContext',
  'Target.attachToBrowserTarget',
  'Target.exposeDevToolsProtocol',
  'Target.setRemoteLocations'
])
const SESSION_BLOCKED_DOMAINS = ['Browser.', 'SystemInfo.', 'Tethering.']
/** Browser-level commands answered by routing them through one of the caller's tabs. */
const VIA_TAB = new Set(['Storage.getCookies', 'Storage.setCookies', 'Storage.clearCookies'])
/** Browser-level commands Owlto accepts and ignores: Owlto's session owns these policies. */
const IGNORED = new Set([
  'Browser.setDownloadBehavior',
  'Browser.grantPermissions',
  'Browser.resetPermissions',
  'Target.setDiscoverTargets'
])

class GateError extends Error {}

export class CdpGate {
  private server: Server | null = null
  private port = 0
  private readonly wss = new WebSocketServer({ noServer: true })
  /** Endpoint tokens, each naming the worker key it was issued for. */
  private readonly tokens = new Map<string, string>()
  private readonly clients = new Set<Client>()
  private nextSession = 1

  constructor(private readonly backend: GateBackend) {}

  private starting: Promise<void> | null = null

  /** Starts listening on first use, so Owlto opens no port until a worker browses. */
  private start(): Promise<void> {
    this.starting ??= this.listen().catch((error: unknown) => {
      this.starting = null
      throw error
    })
    return this.starting
  }

  private async listen(): Promise<void> {
    const server = createServer((_request, response) => {
      response.statusCode = 404
      response.end()
    })
    server.on('upgrade', (request, socket, head) => this.upgrade(request, socket, head))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.port = (server.address() as AddressInfo).port
    this.server = server
  }

  /** The endpoint a worker's scripts connect to; it shows only that worker's tabs. */
  async endpoint(key: string): Promise<string> {
    await this.start()
    let token = [...this.tokens].find(([, owner]) => owner === key)?.[0]
    if (!token) {
      token = randomBytes(24).toString('hex')
      this.tokens.set(token, key)
    }
    return `ws://127.0.0.1:${this.port}/devtools/browser/${token}`
  }

  /** Forgets a worker: its endpoint stops working and its connections close. */
  revoke(key: string): void {
    for (const [token, owner] of this.tokens) if (owner === key) this.tokens.delete(token)
    for (const client of this.clients) if (client.key === key) client.socket.close()
  }

  /** A tab's debugger event, from its main session or a child one. */
  tabEvent(tabId: string, method: string, params: CdpParams, childSessionId?: string): void {
    for (const client of this.clients) {
      const session = client.sessions.get(tabId)
      if (!session) continue
      const child = typeof params?.sessionId === 'string' ? params.sessionId : null
      if (method === 'Target.attachedToTarget' && child) session.children.add(child)
      if (method === 'Target.detachedFromTarget' && child) session.children.delete(child)
      this.emit(client, {
        method,
        params: params ?? {},
        sessionId: childSessionId || session.sessionId
      })
    }
  }

  /** A worker's new tab, such as a page its script opened; auto-attached clients get it. */
  tabAdded(tab: GateTab): void {
    for (const client of this.clients)
      if (client.key === tab.key && client.autoAttach) void this.attach(client, tab).catch(() => {})
  }

  tabRemoved(tabId: string): void {
    for (const client of this.clients) {
      const session = client.sessions.get(tabId)
      if (!session) continue
      client.sessions.delete(tabId)
      this.emit(client, {
        method: 'Target.detachedFromTarget',
        params: { sessionId: session.sessionId, targetId: session.targetInfo.targetId }
      })
    }
  }

  close(): void {
    for (const client of this.clients) client.socket.terminate()
    this.clients.clear()
    this.tokens.clear()
    this.wss.close()
    this.server?.close()
    this.server = null
    this.starting = null
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const token = /^\/devtools\/browser\/([0-9a-f]+)$/.exec(request.url ?? '')?.[1]
    const key = token ? this.tokens.get(token) : undefined
    // Web pages send an Origin; Playwright in the browser host does not.
    if (!key || request.headers.origin) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => this.connected(key, ws))
  }

  private connected(key: string, socket: WebSocket): void {
    const client: Client = {
      key,
      socket,
      autoAttach: false,
      sessions: new Map(),
      attaching: new Map()
    }
    this.clients.add(client)
    socket.on('message', (data) => void this.message(client, data))
    socket.on('close', () => this.clients.delete(client))
    socket.on('error', () => socket.terminate())
  }

  private async message(client: Client, data: RawData): Promise<void> {
    let command: Command
    try {
      command = JSON.parse(data.toString()) as Command
      if (typeof command.id !== 'number' || typeof command.method !== 'string') throw new Error()
    } catch {
      client.socket.close(1003, 'Malformed message')
      return
    }
    const { id, sessionId } = command
    try {
      const result = sessionId
        ? await this.sessionCommand(client, command, sessionId)
        : await this.rootCommand(client, command)
      this.emit(client, { id, sessionId, result: result ?? {} })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit(client, { id, sessionId, error: { code: -32000, message } })
    }
  }

  private async rootCommand(client: Client, { method, params }: Command): Promise<unknown> {
    const tabs = () => this.backend.tabs(client.key)
    switch (method) {
      case 'Browser.getVersion': {
        const { product, userAgent } = this.backend.version()
        return { protocolVersion: '1.3', product, revision: '', userAgent, jsVersion: '' }
      }
      case 'Target.setAutoAttach':
        client.autoAttach = true
        await Promise.all(tabs().map((tab) => this.attach(client, tab)))
        return {}
      case 'Target.getTargetInfo':
        return {
          targetInfo: { targetId: 'browser', type: 'browser', title: '', url: '', attached: true }
        }
      case 'Target.getTargets':
        return {
          targetInfos: [...client.sessions.values()].map((s) => ({
            ...s.targetInfo,
            attached: true
          }))
        }
      case 'Target.getBrowserContexts':
        return { browserContextIds: [] }
      case 'Target.createTarget': {
        const url = typeof params?.url === 'string' && params.url ? params.url : 'about:blank'
        const tab = await this.backend.createTab(client.key, url)
        const session = await this.attach(client, tab)
        return { targetId: session.targetInfo.targetId }
      }
      case 'Target.closeTarget': {
        const session = this.byTarget(client, params?.targetId)
        return { success: session ? this.backend.closeTab(client.key, session.tab.id) : false }
      }
      case 'Target.activateTarget': {
        const session = this.byTarget(client, params?.targetId)
        if (session) this.backend.activateTab(client.key, session.tab.id)
        return {}
      }
    }
    if (IGNORED.has(method)) return {}
    if (VIA_TAB.has(method)) {
      const tab = tabs()[0]
      if (!tab) throw new GateError('Open a page first.')
      const { browserContextId: _ignored, ...rest } = params ?? {}
      return tab.send(method, rest)
    }
    throw new GateError(`${method} is not available in Owlto's browser.`)
  }

  private async sessionCommand(
    client: Client,
    { method, params }: Command,
    sessionId: string
  ): Promise<unknown> {
    let session: TabSession | undefined
    let child: string | undefined
    for (const candidate of client.sessions.values()) {
      if (candidate.sessionId === sessionId) session = candidate
      else if (candidate.children.has(sessionId)) {
        session = candidate
        child = sessionId
      }
      if (session) break
    }
    if (!session) throw new GateError(`No tab for session ${sessionId}.`)
    if (SESSION_BLOCKED.has(method) || SESSION_BLOCKED_DOMAINS.some((d) => method.startsWith(d)))
      throw new GateError(`${method} is not available in Owlto's browser.`)
    if (method === 'Page.close') {
      this.backend.closeTab(client.key, session.tab.id)
      return {}
    }
    if (method === 'Target.getTargetInfo' && !child) return { targetInfo: session.targetInfo }
    if (method.startsWith('Input.') && !this.backend.agentMayDrive(session.tab.id))
      throw new GateError(
        'The user is using this tab. Wait for them to hand it back, then try again.'
      )
    this.backend.noteCommand(session.tab.id, method, params)
    return session.tab.send(method, params, child)
  }

  private attach(client: Client, tab: GateTab): Promise<TabSession> {
    const existing = client.sessions.get(tab.id)
    if (existing) return Promise.resolve(existing)
    const pending = client.attaching.get(tab.id)
    if (pending) return pending
    const attaching = (async () => {
      const reply = (await tab.send('Target.getTargetInfo', undefined)) as {
        targetInfo: TargetInfo
      }
      const session: TabSession = {
        tab,
        sessionId: `owlto-${this.nextSession++}`,
        targetInfo: { ...reply.targetInfo, attached: true },
        children: new Set()
      }
      client.sessions.set(tab.id, session)
      this.emit(client, {
        method: 'Target.attachedToTarget',
        params: {
          sessionId: session.sessionId,
          targetInfo: session.targetInfo,
          waitingForDebugger: false
        }
      })
      return session
    })().finally(() => client.attaching.delete(tab.id))
    client.attaching.set(tab.id, attaching)
    return attaching
  }

  private byTarget(client: Client, targetId: unknown): TabSession | undefined {
    return [...client.sessions.values()].find((s) => s.targetInfo.targetId === targetId)
  }

  private emit(client: Client, message: Record<string, unknown>): void {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(JSON.stringify(message))
  }
}
