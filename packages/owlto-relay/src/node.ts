import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type RawData, type WebSocket, WebSocketServer } from 'ws'
import {
  AccountBook,
  type AccountRecord,
  type AccountServices,
  accountOfSession,
  answerAccount,
  type IdentityProvider,
  type ProviderIdentity
} from './accounts.ts'
import { MAX_MESSAGE_BYTES, parseJson, type QueuedItem, routeOf } from './protocol.ts'
import {
  type Attachment,
  type Budgets,
  type Mailbox,
  newBudgets,
  type PushRequest,
  type PushResult,
  RateWindow,
  type RelayServices,
  type RendezvousEntry,
  Room,
  type RoomIO
} from './room.ts'

/**
 * The relay on plain Node, for tests and for people who run their own relay. Everything
 * lives in memory, so a restart forgets mailboxes and hosts register again on reconnect.
 */
export type NodeRelay = {
  /** The `ws://` base URL, e.g. `ws://127.0.0.1:52011`. */
  url: string
  /** Runs a mailbox's expiry check now, as its alarm would; for tests. */
  expire(mailbox: string): Promise<void>
  /** Whether the relay still holds a record for this mailbox. */
  has(mailbox: string): boolean
  close(): Promise<void>
}

export type NodeRelayOptions = {
  port?: number
  host?: string
  /**
   * Asks an identity provider who a token belongs to. When set, hosts need a relay account
   * session (`accounts.ts`); a self-hosted relay usually leaves it out.
   */
  verifyIdentity?: (provider: IdentityProvider, token: string) => Promise<ProviderIdentity | null>
  /** Sends a notification; without it pushes fail, as on a relay with no APNs key. */
  push?: (request: PushRequest) => Promise<PushResult>
  now?: () => number
}

type RoomState = {
  sockets: Set<WebSocket>
  attachments: WeakMap<WebSocket, Attachment>
  mailbox: Mailbox | null
  items: Map<string, QueuedItem>
  budgets: Budgets
  expiry: NodeJS.Timeout | null
}

/** setTimeout's longest delay; a later expiry checks again when this fires. */
const MAX_TIMER_MS = 2 ** 31 - 1
/** Rendezvous lookups per IP per minute, so four characters cannot be walked. */
const RENDEZVOUS_LOOKUPS_PER_MINUTE = 10
/** Account requests per IP per minute. */
const ACCOUNT_REQUESTS_PER_MINUTE = 30

export async function startNodeRelay(options: NodeRelayOptions = {}): Promise<NodeRelay> {
  const now = options.now ?? (() => Date.now())
  const rooms = new Map<string, RoomState>()
  const accounts = new Map<string, AccountRecord>()
  const rendezvous = new Map<string, RendezvousEntry>()
  const lookups = new Map<string, RateWindow>()
  const accountLookups = new Map<string, RateWindow>()
  const book = (account: string) =>
    new AccountBook({
      load: async () => structuredClone(accounts.get(account) ?? null),
      save: async (record) => {
        accounts.set(account, structuredClone(record))
      },
      deleteAll: async () => {
        accounts.delete(account)
      },
      now,
      randomToken: () => randomBytes(32).toString('base64url')
    })
  const services: RelayServices = {
    accounts: Boolean(options.verifyIdentity),
    checkSession: async (session) => {
      const account = accountOfSession(session)
      const hash = account ? await book(account).check(session) : null
      return account && hash ? { account, session: hash } : null
    },
    claimMailbox: (account, session, mailbox) => book(account).claim(session, mailbox),
    releaseMailbox: (account, mailbox) => book(account).release(mailbox),
    claimRendezvous: async (code, entry) => {
      const held = rendezvous.get(code)
      if (held && held.expiresAt > now()) return false
      rendezvous.set(code, entry)
      return true
    },
    push: options.push ?? (async () => 'failed')
  }

  const server: Server = createServer((request, response) => answerHttp(request, response))
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })

  const accountServices: AccountServices = {
    verifyIdentity: options.verifyIdentity ?? (async () => null),
    account: book,
    room: (mailbox) => ({
      status: () => roomFor(mailbox).room.status(),
      evict: async () => roomFor(mailbox).room.evict(),
      destroy: () => roomFor(mailbox).room.destroy()
    })
  }

  function limited(table: Map<string, RateWindow>, ip: string, perMinute: number): boolean {
    let window = table.get(ip)
    if (!window) {
      window = new RateWindow(perMinute, 60_000)
      table.set(ip, window)
    }
    return !window.take(now())
  }

  function answerAccountHttp(request: IncomingMessage, response: ServerResponse, path: string) {
    const ip = request.socket.remoteAddress ?? 'unknown'
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (limited(accountLookups, ip, ACCOUNT_REQUESTS_PER_MINUTE))
      return send(429, { error: 'limited' })
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 16 * 1024) request.destroy()
      else chunks.push(chunk)
    })
    request.on('end', () => {
      const body = chunks.length ? parseJson(Buffer.concat(chunks).toString('utf8')) : null
      answerAccount(
        request.method ?? 'GET',
        path,
        request.headers.authorization ?? null,
        body,
        accountServices
      )
        .then((answer) => send(answer.status, answer.body))
        .catch(() => send(500, { error: 'failed' }))
    })
  }

  function answerHttp(request: IncomingMessage, response: ServerResponse): void {
    const route = routeOf(new URL(request.url ?? '/', 'http://relay').pathname)
    if (route?.kind === 'account') {
      answerAccountHttp(request, response, route.path)
      return
    }
    if (route?.kind !== 'rendezvous' || request.method !== 'GET') {
      response.writeHead(426, { 'content-type': 'text/plain' })
      response.end('Owlto relay: WebSocket only.\n')
      return
    }
    const ip = request.socket.remoteAddress ?? 'unknown'
    if (limited(lookups, ip, RENDEZVOUS_LOOKUPS_PER_MINUTE)) {
      response.writeHead(429, { 'content-type': 'application/json' })
      response.end('{"error":"limited"}')
      return
    }
    const entry = rendezvous.get(route.code)
    if (!entry || entry.expiresAt <= now()) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{"error":"not_found"}')
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ mailbox: entry.mailbox, ticket: entry.ticket }))
  }

  function roomFor(mailbox: string): { state: RoomState; room: Room<WebSocket> } {
    let state = rooms.get(mailbox)
    if (!state) {
      state = {
        sockets: new Set(),
        attachments: new WeakMap(),
        mailbox: null,
        items: new Map(),
        budgets: newBudgets(),
        expiry: null
      }
      rooms.set(mailbox, state)
    }
    const current = state
    const io: RoomIO<WebSocket> = {
      mailbox,
      sockets: () => [...current.sockets],
      attachment: (socket) => current.attachments.get(socket) ?? null,
      attach: (socket, attachment) => current.attachments.set(socket, attachment),
      send: (socket, data) => {
        if (socket.readyState === socket.OPEN) socket.send(data)
      },
      close: (socket, code, reason) => socket.close(code, reason),
      load: async () => current.mailbox,
      save: async (record) => {
        current.mailbox = record
      },
      items: async () => [...current.items.values()],
      saveItem: async (item) => {
        current.items.set(item.id, item)
      },
      deleteItems: async (ids) => {
        for (const id of ids) current.items.delete(id)
      },
      deleteAll: async () => {
        current.mailbox = null
        current.items.clear()
      },
      scheduleExpiry: async (at) => {
        if (current.expiry) clearTimeout(current.expiry)
        current.expiry = setTimeout(
          () => {
            current.expiry = null
            void roomFor(mailbox).room.expire()
          },
          Math.min(Math.max(0, at - now()), MAX_TIMER_MS)
        )
        current.expiry.unref()
      },
      randomId: () => randomBytes(16).toString('base64url'),
      now,
      budgets: current.budgets,
      services
    }
    return { state: current, room: new Room(io) }
  }

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const route = routeOf(new URL(request.url ?? '/', 'http://relay').pathname)
    if (!route || route.kind === 'rendezvous' || route.kind === 'account') {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
      return
    }
    const { state, room } = roomFor(route.mailbox)
    if (!room.admit()) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n')
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      state.sockets.add(ws)
      state.attachments.set(ws, { kind: route.kind, state: 'hello', at: now() })
      // Messages are handled one at a time per socket, as a Durable Object does.
      let queue = Promise.resolve()
      ws.on('message', (raw: RawData, isBinary: boolean) => {
        const data = isBinary ? toBytes(raw) : toBytes(raw).toString('utf8')
        queue = queue.then(() => room.message(ws, data)).catch(() => ws.terminate())
      })
      ws.on('close', () => {
        queue = queue
          .then(async () => {
            state.sockets.delete(ws)
            await room.closed(ws)
          })
          .catch(() => {})
      })
      ws.on('error', () => ws.terminate())
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address
  return {
    url: `ws://${host}:${address.port}`,
    expire: (mailbox) => roomFor(mailbox).room.expire(),
    has: (mailbox) => rooms.get(mailbox)?.mailbox != null,
    close: () =>
      new Promise((resolve) => {
        for (const state of rooms.values()) if (state.expiry) clearTimeout(state.expiry)
        for (const client of wss.clients) client.terminate()
        wss.close()
        server.close(() => resolve())
      })
  }
}

function toBytes(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw
  if (Array.isArray(raw)) return Buffer.concat(raw)
  return Buffer.from(raw)
}
