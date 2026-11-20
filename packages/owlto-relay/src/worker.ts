import { DurableObject } from 'cloudflare:workers'
import {
  AccountBook,
  type AccountRecord,
  type AccountServices,
  accountOfSession,
  answerAccount
} from './accounts.ts'
import { ApnsSender } from './apns.ts'
import { parseJson, type QueuedItem, routeOf } from './protocol.ts'
import {
  type Attachment,
  type Mailbox,
  newBudgets,
  type RelayServices,
  type RendezvousEntry,
  Room,
  type RoomIO
} from './room.ts'

/**
 * The relay on Cloudflare: a Worker routes `/v1/<kind>/<mailbox>` to one Durable Object per
 * mailbox, which accepts the WebSocket with the hibernation API. Each socket keeps its
 * `Attachment`, so the object may sleep between messages and rebuild the room when it wakes.
 * Rendezvous codes and relay accounts (`accounts.ts`) are small Durable Objects of their own.
 */
export interface Env {
  RELAY_ROOM: DurableObjectNamespace<RelayRoom>
  RELAY_RENDEZVOUS: DurableObjectNamespace<RelayRendezvous>
  RELAY_ACCOUNT: DurableObjectNamespace<RelayAccount>
  /** New sockets per client IP; see `wrangler.toml`. */
  IP_LIMIT: RateLimit
  /** New sockets per mailbox, checked before its Durable Object wakes. */
  MAILBOX_LIMIT: RateLimit
  /** Rendezvous lookups per client IP, so four characters cannot be walked. */
  RENDEZVOUS_LIMIT: RateLimit
  /** Account requests (sign-in, list, remove) per client IP. */
  ACCOUNT_LIMIT: RateLimit
  /** "false" lets any host use the relay without signing in, for a private deployment. */
  REQUIRE_GITHUB?: string
  /** APNs, set with `wrangler secret put`; pushes fail quietly without them. */
  APNS_KEY?: string
  APNS_KEY_ID?: string
  APNS_TEAM_ID?: string
  APNS_TOPIC?: string
}

const tooMany = () => new Response('Too many connections.\n', { status: 429 })
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const route = routeOf(new URL(request.url).pathname)
    if (!route) return new Response('Not found\n', { status: 404 })
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    if (route.kind === 'account') {
      if (!(await env.ACCOUNT_LIMIT.limit({ key: ip })).success)
        return json({ error: 'limited' }, 429)
      const body = request.method === 'POST' ? parseJson(await request.text()) : null
      const answer = await answerAccount(
        request.method,
        route.path,
        request.headers.get('Authorization'),
        body,
        accountServices(env)
      )
      return json(answer.body, answer.status)
    }
    if (route.kind === 'rendezvous') {
      if (request.method !== 'GET') return new Response('Method not allowed\n', { status: 405 })
      if (!(await env.RENDEZVOUS_LIMIT.limit({ key: ip })).success)
        return json({ error: 'limited' }, 429)
      const stub = env.RELAY_RENDEZVOUS.get(env.RELAY_RENDEZVOUS.idFromName(route.code))
      const found = await stub.lookup()
      return found ? json(found, 200) : json({ error: 'not_found' }, 404)
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Owlto relay: WebSocket only.\n', { status: 426 })
    // Turned away here, a reconnect loop costs a Worker request and never reaches the
    // Durable Object, which bills by duration.
    if (!(await env.IP_LIMIT.limit({ key: ip })).success) return tooMany()
    if (!(await env.MAILBOX_LIMIT.limit({ key: route.mailbox })).success) return tooMany()
    const stub = env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(route.mailbox))
    return stub.fetch(request)
  }
} satisfies ExportedHandler<Env>

const MAILBOX_KEY = 'mailbox'
const ITEM_PREFIX = 'item:'

function accountServices(env: Env): AccountServices {
  return {
    verifyGitHub,
    account: (account) => env.RELAY_ACCOUNT.get(env.RELAY_ACCOUNT.idFromName(account)),
    room: (mailbox) => env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(mailbox))
  }
}

/** Asks GitHub who a token belongs to. The token is used once and never stored. */
async function verifyGitHub(token: string): Promise<{ id: number; login: string } | null> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'owlto-relay'
      }
    })
    if (!response.ok) return null
    const user = (await response.json()) as { id?: unknown; login?: unknown }
    return typeof user.id === 'number' && typeof user.login === 'string'
      ? { id: user.id, login: user.login }
      : null
  } catch {
    return null
  }
}

export class RelayRoom extends DurableObject<Env> {
  private readonly budgets = newBudgets()
  private apns: ApnsSender | null = null
  private mailboxId: string | null = null
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Keepalive pings from either side are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request): Promise<Response> {
    const route = routeOf(new URL(request.url).pathname)
    if (!route || route.kind === 'rendezvous' || route.kind === 'account')
      return new Response('Not found\n', { status: 404 })
    await this.rememberMailbox(route.mailbox)
    if (!this.room().admit()) return tooMany()
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    const hello: Attachment = { kind: route.kind, state: 'hello', at: Date.now() }
    server.serializeAttachment(hello)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.restoreMailbox()
    await this.room().message(
      socket,
      typeof message === 'string' ? message : new Uint8Array(message)
    )
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.restoreMailbox()
    await this.room().closed(socket)
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.restoreMailbox()
    await this.room().closed(socket)
  }

  async alarm(): Promise<void> {
    await this.restoreMailbox()
    if (this.mailboxId) await this.room().expire()
  }

  /** For the account routes: whether the host is online. */
  async status(): Promise<{ online: boolean; lastHostAt: number } | null> {
    await this.restoreMailbox()
    return this.mailboxId ? this.room().status() : null
  }
  /** Its session ended: disconnect the host. */
  async evict(): Promise<void> {
    await this.restoreMailbox()
    if (this.mailboxId) this.room().evict()
  }
  /** Removed on its account: close everything and delete the mailbox. */
  async destroy(): Promise<void> {
    await this.restoreMailbox()
    if (this.mailboxId) await this.room().destroy()
  }

  /** Waking from hibernation or for an alarm loses memory; the id comes back from storage. */
  private async restoreMailbox(): Promise<void> {
    this.mailboxId ??= (await this.ctx.storage.get<string>('id')) ?? null
  }

  /** The mailbox id is only in the URL, so it is kept for wakes that come without one. */
  private async rememberMailbox(mailbox: string): Promise<void> {
    if (this.mailboxId === mailbox) return
    this.mailboxId = mailbox
    if ((await this.ctx.storage.get<string>('id')) !== mailbox)
      await this.ctx.storage.put('id', mailbox)
  }

  private services(): RelayServices {
    const env = this.env
    return {
      accounts: env.REQUIRE_GITHUB !== 'false',
      checkSession: async (session) => {
        const account = accountOfSession(session)
        if (!account) return null
        const hash = await env.RELAY_ACCOUNT.get(env.RELAY_ACCOUNT.idFromName(account)).check(
          session
        )
        return hash ? { account, session: hash } : null
      },
      claimMailbox: (account, session, mailbox) =>
        env.RELAY_ACCOUNT.get(env.RELAY_ACCOUNT.idFromName(account)).claim(session, mailbox),
      releaseMailbox: (account, mailbox) =>
        env.RELAY_ACCOUNT.get(env.RELAY_ACCOUNT.idFromName(account)).release(mailbox),
      claimRendezvous: (code, entry) =>
        env.RELAY_RENDEZVOUS.get(env.RELAY_RENDEZVOUS.idFromName(code)).claim(entry),
      push: async (request) => {
        if (!env.APNS_KEY || !env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_TOPIC)
          return 'failed'
        this.apns ??= new ApnsSender({
          key: env.APNS_KEY,
          keyId: env.APNS_KEY_ID,
          teamId: env.APNS_TEAM_ID,
          topic: env.APNS_TOPIC
        })
        return this.apns.send(request)
      }
    }
  }

  private room(): Room<WebSocket> {
    const storage = this.ctx.storage
    const io: RoomIO<WebSocket> = {
      mailbox: this.mailboxId ?? '',
      sockets: () => this.ctx.getWebSockets(),
      attachment: (socket) => (socket.deserializeAttachment() as Attachment | null) ?? null,
      attach: (socket, attachment) => socket.serializeAttachment(attachment),
      send: (socket, data) => {
        try {
          socket.send(data)
        } catch {
          // The socket closed in the meantime; its close handler cleans up.
        }
      },
      close: (socket, code, reason) => {
        try {
          socket.close(code, reason)
        } catch {
          // Already closed.
        }
      },
      load: async () => (await storage.get<Mailbox>(MAILBOX_KEY)) ?? null,
      save: (mailbox) => storage.put(MAILBOX_KEY, mailbox),
      items: async () => [...(await storage.list<QueuedItem>({ prefix: ITEM_PREFIX })).values()],
      saveItem: (item) => storage.put(`${ITEM_PREFIX}${item.id}`, item),
      deleteItems: async (ids) => {
        if (ids.length) await storage.delete(ids.map((id) => `${ITEM_PREFIX}${id}`))
      },
      deleteAll: async () => {
        await storage.deleteAlarm()
        await storage.deleteAll()
        this.mailboxId = null
      },
      scheduleExpiry: (at) => storage.setAlarm(at),
      randomId: () => {
        const bytes = crypto.getRandomValues(new Uint8Array(16))
        return btoa(String.fromCharCode(...bytes))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
      },
      now: () => Date.now(),
      budgets: this.budgets,
      services: this.services()
    }
    return new Room(io)
  }
}

/** One rendezvous code: the mailbox and pairing ticket it finds, until it expires. */
export class RelayRendezvous extends DurableObject<Env> {
  async claim(entry: RendezvousEntry): Promise<boolean> {
    const held = await this.ctx.storage.get<RendezvousEntry>('entry')
    if (held && held.expiresAt > Date.now()) return false
    await this.ctx.storage.put('entry', entry)
    await this.ctx.storage.setAlarm(entry.expiresAt)
    return true
  }
  async lookup(): Promise<{ mailbox: string; ticket: string } | null> {
    const entry = await this.ctx.storage.get<RendezvousEntry>('entry')
    if (!entry || entry.expiresAt <= Date.now()) return null
    return { mailbox: entry.mailbox, ticket: entry.ticket }
  }
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }
}

/** One relay account: its GitHub login, sessions, and mailboxes; see `accounts.ts`. */
export class RelayAccount extends DurableObject<Env> {
  private book(): AccountBook {
    const storage = this.ctx.storage
    return new AccountBook({
      load: async () => (await storage.get<AccountRecord>('account')) ?? null,
      save: (record) => storage.put('account', record),
      deleteAll: () => storage.deleteAll(),
      now: () => Date.now(),
      randomToken: () => {
        const bytes = crypto.getRandomValues(new Uint8Array(32))
        return btoa(String.fromCharCode(...bytes))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
      }
    })
  }
  createSession(account: string, login: string, name: string): Promise<string> {
    return this.book().createSession(account, login, name)
  }
  check(session: string): Promise<string | null> {
    return this.book().check(session)
  }
  claim(session: string, mailbox: string): Promise<boolean> {
    return this.book().claim(session, mailbox)
  }
  release(mailbox: string): Promise<void> {
    return this.book().release(mailbox)
  }
  revoke(session: string): Promise<string[]> {
    return this.book().revoke(session)
  }
  revokeHash(hash: string): Promise<string[]> {
    return this.book().revokeHash(hash)
  }
  info(): ReturnType<AccountBook['info']> {
    return this.book().info()
  }
}
