import {
  CLOSE,
  type ErrorCode,
  MAX_MESSAGE_BYTES,
  MAX_PIPES,
  parseHello,
  parseHostMessage,
  parseJson,
  type SocketKind,
  sha256Hex
} from './protocol.ts'

/** What the relay knows about one socket; kept on the socket so it survives hibernation. */
export type Attachment =
  | { kind: SocketKind; state: 'hello' }
  | { kind: 'host'; state: 'ready' }
  | { kind: 'client'; state: 'waiting' | 'open'; pipe: string }
  | { kind: 'pipe'; state: 'open'; pipe: string }

/** A mailbox's stored record. The relay keeps hashes only, never a secret or a ticket. */
export type Mailbox = {
  secretHash: string
  tickets: string[]
  createdAt: number
  lastHostAt: number
}

/**
 * Everything a room needs from its platform: the open sockets of one mailbox, a place to keep
 * its record, and randomness. A Durable Object and the Node server each implement it.
 */
export interface RoomIO<S> {
  sockets(): S[]
  attachment(socket: S): Attachment | null
  attach(socket: S, attachment: Attachment): void
  send(socket: S, data: string | Uint8Array): void
  close(socket: S, code: number, reason: string): void
  load(): Promise<Mailbox | null>
  save(mailbox: Mailbox): Promise<void>
  randomId(): string
  now(): number
}

/**
 * One mailbox's relay logic, with no platform code: checks hellos, hands pipes to the
 * host, and passes sealed frames between a client and its pipe. It holds no state of its
 * own, so a Durable Object can build one per event after waking from hibernation.
 */
export class Room<S> {
  private readonly io: RoomIO<S>
  constructor(io: RoomIO<S>) {
    this.io = io
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
      const mailbox = await this.io.load()
      if (mailbox) await this.io.save({ ...mailbox, tickets: message.hashes })
      // A removed ticket takes effect for new pipes; open ones belong to devices the host
      // still trusts until it closes them through the end-to-end channel.
      return
    }
    if (typeof data === 'string') return
    if (attachment.state !== 'open') return this.fail(socket, 'bad_request')
    const partner = this.partner(socket, attachment.pipe)
    if (partner) this.io.send(partner, data)
    else this.io.close(socket, CLOSE.normal, 'gone')
  }

  /** A socket closed: its pipe partner closes too, and waiting clients learn the host left. */
  closed(socket: S): void {
    const attachment = this.io.attachment(socket)
    if (!attachment || attachment.state === 'hello') return
    if (attachment.kind === 'host') {
      for (const other of this.io.sockets()) {
        const theirs = this.io.attachment(other)
        if (theirs?.kind === 'client' && theirs.state === 'waiting') this.fail(other, 'offline')
      }
      return
    }
    const partner = this.partner(socket, attachment.pipe)
    if (partner) this.io.close(partner, CLOSE.normal, 'closed')
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
      // The first host to register a mailbox owns it. Mailbox ids are random, so a
      // collision means a guess, which the secret then stops.
      await this.io.save(
        mailbox
          ? { ...mailbox, lastHostAt: now }
          : { secretHash, tickets: [], createdAt: now, lastHostAt: now }
      )
      for (const other of this.io.sockets())
        if (other !== socket && this.io.attachment(other)?.kind === 'host')
          this.fail(other, 'replaced')
      this.io.attach(socket, { kind: 'host', state: 'ready' })
      this.io.send(socket, JSON.stringify({ t: 'ready' }))
      return
    }
    if (hello.t === 'client') {
      if (!mailbox?.tickets.includes(await sha256Hex(hello.ticket)))
        return this.fail(socket, 'denied')
      const host = this.io.sockets().find((other) => {
        const theirs = this.io.attachment(other)
        return theirs?.kind === 'host' && theirs.state === 'ready'
      })
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
