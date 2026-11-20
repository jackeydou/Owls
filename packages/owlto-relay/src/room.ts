import {
  CLOSE,
  type ErrorCode,
  HELLO_TIMEOUT_MS,
  type HostMessage,
  ITEM_TTL_MS,
  MAILBOX_IDLE_MS,
  MAX_CONNECTIONS_PER_MINUTE,
  MAX_ITEMS_PER_MAILBOX,
  MAX_ITEMS_PER_TICKET,
  MAX_MESSAGE_BYTES,
  MAX_MESSAGES_PER_MINUTE,
  MAX_PIPES,
  MAX_PUSHES_PER_HOUR,
  MAX_SOCKETS,
  parseHello,
  parseHostMessage,
  parseJson,
  QUEUED_BATCH_CHARS,
  type QueuedItem,
  RENDEZVOUS_TTL_MS,
  randomRendezvousCode,
  type SocketKind,
  sha256Hex
} from './protocol.ts'

/** What the relay knows about one socket; kept on the socket so it survives hibernation. */
export type Attachment =
  | { kind: SocketKind; state: 'hello'; at: number }
  | { kind: 'host'; state: 'ready' }
  | { kind: 'client'; state: 'waiting' | 'open'; pipe: string }
  | { kind: 'pipe'; state: 'open'; pipe: string }
  | { kind: 'drop'; state: 'stored' }

/** A mailbox's stored record. The relay keeps hashes only, never a secret or a ticket. */
export type Mailbox = {
  secretHash: string
  tickets: string[]
  createdAt: number
  lastHostAt: number
  /** The relay account that registered it; null on a relay that asks for none. */
  owner: string | null
}

/** At most `limit` events per fixed window of `periodMs`. */
export class RateWindow {
  private readonly limit: number
  private readonly periodMs: number
  private start = 0
  private count = 0
  constructor(limit: number, periodMs: number) {
    this.limit = limit
    this.periodMs = periodMs
  }
  take(now: number): boolean {
    if (now - this.start >= this.periodMs) {
      this.start = now
      this.count = 0
    }
    if (this.count >= this.limit) return false
    this.count++
    return true
  }
}

/**
 * A mailbox's spending limits. They live in memory: a Durable Object keeps its memory while
 * it is busy and only hibernates when quiet, so a burst cannot outlast its counters.
 */
export type Budgets = { connections: RateWindow; messages: RateWindow; pushes: RateWindow }
export function newBudgets(): Budgets {
  return {
    connections: new RateWindow(MAX_CONNECTIONS_PER_MINUTE, 60_000),
    messages: new RateWindow(MAX_MESSAGES_PER_MINUTE, 60_000),
    pushes: new RateWindow(MAX_PUSHES_PER_HOUR, 60 * 60_000)
  }
}

/** What a live rendezvous code points at. */
export type RendezvousEntry = { mailbox: string; ticket: string; expiresAt: number }
export type PushRequest = { token: string; sandbox: boolean; payload: string }
export type PushResult = 'sent' | 'gone' | 'failed'

/**
 * What a room needs beyond its own mailbox: relay accounts, the shared rendezvous codes, and
 * APNs. On Cloudflare these are other Durable Objects and outbound fetches; the Node relay
 * keeps them in memory.
 */
export interface RelayServices {
  /** Whether a host needs a signed-in relay session; false on a private relay. */
  accounts: boolean
  /** The account and stored session hash of a live session, or null. */
  checkSession(session: string): Promise<{ account: string; session: string } | null>
  /**
   * Records that the Mac signed in with `session` holds `mailbox` on `account`; false when
   * the account already holds as many mailboxes as it may.
   */
  claimMailbox(account: string, session: string, mailbox: string): Promise<boolean>
  releaseMailbox(account: string, mailbox: string): Promise<void>
  /** Takes a rendezvous code if no live entry holds it. */
  claimRendezvous(code: string, entry: RendezvousEntry): Promise<boolean>
  /** Sends a sealed notification through APNs; 'failed' when the relay has no APNs key. */
  push(request: PushRequest): Promise<PushResult>
}

/**
 * Everything a room needs from its platform: the open sockets of one mailbox, a place to keep
 * its record and queue, and randomness. A Durable Object and the Node server each implement it.
 */
export interface RoomIO<S> {
  /** This room's mailbox id. */
  mailbox: string
  sockets(): S[]
  attachment(socket: S): Attachment | null
  attach(socket: S, attachment: Attachment): void
  send(socket: S, data: string | Uint8Array): void
  close(socket: S, code: number, reason: string): void
  load(): Promise<Mailbox | null>
  save(mailbox: Mailbox): Promise<void>
  items(): Promise<QueuedItem[]>
  saveItem(item: QueuedItem): Promise<void>
  deleteItems(ids: string[]): Promise<void>
  /** Deletes the mailbox record and every item. */
  deleteAll(): Promise<void>
  /** Asks for `expire()` at this time; a Durable Object sets its one alarm. */
  scheduleExpiry(at: number): Promise<void>
  randomId(): string
  now(): number
  budgets: Budgets
  services: RelayServices
}

/**
 * One mailbox's relay logic, with no platform code: checks hellos, hands pipes to the
 * host, passes sealed frames between a client and its pipe, and keeps the sealed queue. It
 * holds no state of its own, so a Durable Object can build one per event after waking.
 */
export class Room<S> {
  private readonly io: RoomIO<S>
  constructor(io: RoomIO<S>) {
    this.io = io
  }

  /**
   * Decides whether a new socket may join, before it is accepted. Sockets that never sent a
   * hello are closed here, so the room needs no timer, which would keep it awake.
   */
  admit(): boolean {
    const now = this.io.now()
    let open = 0
    for (const socket of this.io.sockets()) {
      const attachment = this.io.attachment(socket)
      if (attachment?.state === 'hello' && now - attachment.at > HELLO_TIMEOUT_MS)
        this.io.close(socket, CLOSE.error, 'timeout')
      else open++
    }
    return open < MAX_SOCKETS && this.io.budgets.connections.take(now)
  }

  async message(socket: S, data: string | Uint8Array): Promise<void> {
    if (typeof data === 'string' && data === 'ping') {
      this.io.send(socket, 'pong')
      return
    }
    const size = typeof data === 'string' ? data.length : data.byteLength
    if (size > MAX_MESSAGE_BYTES) {
      this.io.close(socket, CLOSE.tooBig, 'too_big')
      return
    }
    if (!this.io.budgets.messages.take(this.io.now())) return this.fail(socket, 'limited')
    const attachment = this.io.attachment(socket)
    if (!attachment) {
      this.io.close(socket, CLOSE.error, 'bad_request')
      return
    }
    if (attachment.state === 'hello') {
      if (typeof data !== 'string') return this.fail(socket, 'bad_request')
      await this.hello(socket, attachment.kind, data)
      return
    }
    if (attachment.kind === 'host') {
      if (typeof data !== 'string') return this.fail(socket, 'bad_request')
      const message = parseHostMessage(parseJson(data))
      if (!message) return this.fail(socket, 'bad_request')
      await this.hostMessage(socket, message)
      return
    }
    if (typeof data === 'string' || attachment.kind === 'drop') return
    if (attachment.state !== 'open') return this.fail(socket, 'bad_request')
    const partner = this.partner(socket, attachment.pipe)
    if (partner) this.io.send(partner, data)
    else this.io.close(socket, CLOSE.normal, 'gone')
  }

  /** A socket closed: its pipe partner closes too, and waiting clients learn the host left. */
  async closed(socket: S): Promise<void> {
    const attachment = this.io.attachment(socket)
    if (!attachment || attachment.state === 'hello' || attachment.kind === 'drop') return
    if (attachment.kind === 'host') {
      for (const other of this.io.sockets()) {
        const theirs = this.io.attachment(other)
        if (theirs?.kind === 'client' && theirs.state === 'waiting') this.fail(other, 'offline')
      }
      if (!this.host(socket)) await this.io.scheduleExpiry(this.io.now() + MAILBOX_IDLE_MS)
      return
    }
    const partner = this.partner(socket, attachment.pipe)
    if (partner) this.io.close(partner, CLOSE.normal, 'closed')
  }

  /**
   * Deletes a mailbox whose host has stayed away for `MAILBOX_IDLE_MS`, with its queue, and
   * frees its place in its owner's count. Called when the expiry time comes.
   */
  async expire(): Promise<void> {
    const mailbox = await this.io.load()
    if (!mailbox) return
    if (this.host(null)) return
    const due = mailbox.lastHostAt + MAILBOX_IDLE_MS
    if (this.io.now() < due) {
      await this.io.scheduleExpiry(due)
      return
    }
    if (mailbox.owner) await this.io.services.releaseMailbox(mailbox.owner, this.io.mailbox)
    await this.io.deleteAll()
  }

  /** Whether the host is connected, and when it last connected; null for no mailbox. */
  async status(): Promise<{ online: boolean; lastHostAt: number } | null> {
    const mailbox = await this.io.load()
    return mailbox ? { online: this.host(null) !== null, lastHostAt: mailbox.lastHostAt } : null
  }

  /** The host's session ended: disconnect it. It reconnects only after signing in again. */
  evict(): void {
    for (const socket of this.io.sockets())
      if (this.io.attachment(socket)?.kind === 'host') this.fail(socket, 'login')
  }

  /** The owner removed this Mac on its account: close everything and forget the mailbox. */
  async destroy(): Promise<void> {
    for (const socket of this.io.sockets()) this.fail(socket, 'denied')
    await this.io.deleteAll()
  }

  private async hello(socket: S, kind: SocketKind, text: string): Promise<void> {
    const hello = parseHello(kind, parseJson(text))
    if (hello === 'version') return this.fail(socket, 'version')
    if (!hello) return this.fail(socket, 'bad_request')
    const mailbox = await this.io.load()
    if (hello.t === 'host') {
      const secretHash = await sha256Hex(hello.secret)
      const now = this.io.now()
      if (mailbox && mailbox.secretHash !== secretHash) return this.fail(socket, 'denied')
      let owner: string | null = mailbox?.owner ?? null
      // The first host to register a mailbox owns it. Mailbox ids are random, so a collision
      // means a guess, which the secret then stops. Every host connect takes a live relay
      // session, so one account cannot fill the relay with mailboxes, and signing out or
      // removing the Mac on the account cuts it off.
      if (this.io.services.accounts) {
        const who = hello.session ? await this.io.services.checkSession(hello.session) : null
        if (!who) return this.fail(socket, 'login')
        if (owner && owner !== who.account) return this.fail(socket, 'denied')
        if (!(await this.io.services.claimMailbox(who.account, who.session, this.io.mailbox)))
          return this.fail(socket, 'quota')
        owner = who.account
      }
      await this.io.save(
        mailbox
          ? { ...mailbox, lastHostAt: now, owner }
          : { secretHash, tickets: [], createdAt: now, lastHostAt: now, owner }
      )
      for (const other of this.io.sockets())
        if (other !== socket && this.io.attachment(other)?.kind === 'host')
          this.fail(other, 'replaced')
      this.io.attach(socket, { kind: 'host', state: 'ready' })
      this.io.send(socket, JSON.stringify({ t: 'ready' }))
      await this.deliverQueue(socket)
      return
    }
    if (hello.t === 'client') {
      if (!mailbox?.tickets.includes(await sha256Hex(hello.ticket)))
        return this.fail(socket, 'denied')
      const host = this.host(null)
      if (!host) return this.fail(socket, 'offline')
      const pipes = this.io.sockets().filter((other) => {
        const theirs = this.io.attachment(other)
        return theirs?.kind === 'client' && theirs.state !== 'hello'
      }).length
      if (pipes >= MAX_PIPES) return this.fail(socket, 'busy')
      const pipe = this.io.randomId()
      this.io.attach(socket, { kind: 'client', state: 'waiting', pipe })
      this.io.send(host, JSON.stringify({ t: 'incoming', pipe }))
      return
    }
    if (hello.t === 'drop') {
      const from = await sha256Hex(hello.ticket)
      if (!mailbox?.tickets.includes(from)) return this.fail(socket, 'denied')
      const items = await this.live()
      if (
        items.length >= MAX_ITEMS_PER_MAILBOX ||
        items.filter((item) => item.from === from).length >= MAX_ITEMS_PER_TICKET
      )
        return this.fail(socket, 'full')
      const item: QueuedItem = { id: this.io.randomId(), from, at: this.io.now(), item: hello.item }
      this.io.attach(socket, { kind: 'drop', state: 'stored' })
      await this.io.saveItem(item)
      this.io.send(socket, JSON.stringify({ t: 'stored' }))
      this.io.close(socket, CLOSE.normal, 'stored')
      const host = this.host(null)
      if (host) this.io.send(host, JSON.stringify({ t: 'queued', items: [item] }))
      return
    }
    if (!mailbox || mailbox.secretHash !== (await sha256Hex(hello.secret)))
      return this.fail(socket, 'denied')
    const client = this.io.sockets().find((other) => {
      const theirs = this.io.attachment(other)
      return theirs?.kind === 'client' && theirs.state === 'waiting' && theirs.pipe === hello.pipe
    })
    if (!client) return this.fail(socket, 'gone')
    this.io.attach(socket, { kind: 'pipe', state: 'open', pipe: hello.pipe })
    this.io.attach(client, { kind: 'client', state: 'open', pipe: hello.pipe })
    const open = JSON.stringify({ t: 'open' })
    this.io.send(client, open)
    this.io.send(socket, open)
  }

  private async hostMessage(socket: S, message: HostMessage): Promise<void> {
    if (message.t === 'tickets') {
      const mailbox = await this.io.load()
      // Storage writes are billed, so an unchanged list is not written again.
      if (mailbox && mailbox.tickets.join() !== message.hashes.join())
        await this.io.save({ ...mailbox, tickets: message.hashes })
      // A removed ticket takes effect for new pipes; open ones belong to devices the host
      // still trusts until it closes them through the end-to-end channel.
      return
    }
    if (message.t === 'ack') {
      await this.io.deleteItems(message.ids)
      return
    }
    if (message.t === 'push') {
      if (!this.io.budgets.pushes.take(this.io.now())) return
      const { t: _, ...request } = message
      if ((await this.io.services.push(request)) === 'gone')
        this.io.send(socket, JSON.stringify({ t: 'push-gone', token: message.token }))
      return
    }
    // A rendezvous code only points at a ticket the host already allows.
    const mailbox = await this.io.load()
    if (!mailbox?.tickets.includes(await sha256Hex(message.ticket))) return
    const expiresAt = this.io.now() + RENDEZVOUS_TTL_MS
    const entry: RendezvousEntry = { mailbox: this.io.mailbox, ticket: message.ticket, expiresAt }
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomRendezvousCode()
      if (await this.io.services.claimRendezvous(code, entry)) {
        this.io.send(socket, JSON.stringify({ t: 'rendezvous', code, expiresAt }))
        return
      }
    }
  }

  /** Sends the host every live item, in batches that fit a message, oldest first. */
  private async deliverQueue(socket: S): Promise<void> {
    const items = await this.live()
    let batch: QueuedItem[] = []
    let chars = 0
    for (const item of items) {
      if (batch.length && chars + item.item.length > QUEUED_BATCH_CHARS) {
        this.io.send(socket, JSON.stringify({ t: 'queued', items: batch }))
        batch = []
        chars = 0
      }
      batch.push(item)
      chars += item.item.length + 200
    }
    if (batch.length) this.io.send(socket, JSON.stringify({ t: 'queued', items: batch }))
  }

  /** The queue without expired items, which are deleted on the way. */
  private async live(): Promise<QueuedItem[]> {
    const now = this.io.now()
    const items = await this.io.items()
    const expired = items.filter((item) => now - item.at > ITEM_TTL_MS).map((item) => item.id)
    if (expired.length) await this.io.deleteItems(expired)
    return items.filter((item) => now - item.at <= ITEM_TTL_MS).sort((a, b) => a.at - b.at)
  }

  /** The ready host socket, other than `except`; null when the host is away. */
  private host(except: S | null): S | null {
    for (const other of this.io.sockets()) {
      if (other === except) continue
      const theirs = this.io.attachment(other)
      if (theirs?.kind === 'host' && theirs.state === 'ready') return other
    }
    return null
  }

  /** The other end of an open pipe: the client for a pipe socket, the pipe for a client. */
  private partner(socket: S, pipe: string): S | null {
    for (const other of this.io.sockets()) {
      if (other === socket) continue
      const theirs = this.io.attachment(other)
      if (
        theirs &&
        theirs.state === 'open' &&
        (theirs.kind === 'client' || theirs.kind === 'pipe') &&
        theirs.pipe === pipe
      )
        return other
    }
    return null
  }

  private fail(socket: S, code: ErrorCode): void {
    this.io.send(socket, JSON.stringify({ t: 'error', code }))
    this.io.close(socket, CLOSE.error, code)
  }
}
