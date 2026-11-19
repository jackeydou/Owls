import { z } from 'zod'
import { type Failure, failureSchema } from '../../shared/app.js'
import type { SecureChannel } from './handshake.js'

/**
 * Requests, replies, and events over a secure channel. Both sides may send any of them;
 * which requests a side answers is up to its handler.
 */
const messageSchema = z.union([
  z.object({
    t: z.literal('req'),
    id: z.number().int().nonnegative(),
    method: z.string().max(64),
    params: z.unknown()
  }),
  z.object({
    t: z.literal('res'),
    id: z.number().int().nonnegative(),
    ok: z.literal(true),
    value: z.unknown()
  }),
  z.object({
    t: z.literal('res'),
    id: z.number().int().nonnegative(),
    ok: z.literal(false),
    error: failureSchema
  }),
  z.object({ t: z.literal('event'), event: z.unknown() }),
  z.object({ t: z.literal('ping') }),
  z.object({ t: z.literal('pong') })
])

export class RemoteCallError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.message)
  }
}

const REQUEST_TIMEOUT_MS = 60_000
const PING_INTERVAL_MS = 20_000
/** Silence this long means the peer went away (asleep, or off the network). */
const IDLE_TIMEOUT_MS = 50_000

export type RpcHandlers = {
  /** Answers a request; a thrown error becomes a failure reply. */
  request(method: string, params: unknown): Promise<unknown>
  event(event: unknown): void
}

export class RpcConnection {
  private nextId = 1
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }
  >()
  private lastHeard = Date.now()
  private readonly heartbeat: NodeJS.Timeout
  private closed = false
  private closeListeners: (() => void)[] = []
  constructor(
    private readonly channel: SecureChannel,
    private readonly handlers: RpcHandlers,
    private readonly toFailure: (error: unknown) => Failure
  ) {
    channel.onMessage((raw) => this.receive(raw))
    channel.onClose(() => this.finish())
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastHeard > IDLE_TIMEOUT_MS) {
        this.close()
        return
      }
      this.channel.send({ t: 'ping' })
    }, PING_INTERVAL_MS)
    this.heartbeat.unref?.()
  }
  private receive(raw: unknown): void {
    this.lastHeard = Date.now()
    const parsed = messageSchema.safeParse(raw)
    if (!parsed.success) return
    const message = parsed.data
    if (message.t === 'ping') this.channel.send({ t: 'pong' })
    else if (message.t === 'event') this.handlers.event(message.event)
    else if (message.t === 'req') void this.answer(message.id, message.method, message.params)
    else if (message.t === 'res') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.ok) pending.resolve(message.value)
      else pending.reject(new RemoteCallError(message.error))
    }
  }
  private async answer(id: number, method: string, params: unknown): Promise<void> {
    try {
      const value = await this.handlers.request(method, params)
      if (!this.closed) this.channel.send({ t: 'res', id, ok: true, value: value ?? null })
    } catch (error) {
      if (!this.closed) this.channel.send({ t: 'res', id, ok: false, error: this.toFailure(error) })
    }
  }
  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed)
      return Promise.reject(
        new RemoteCallError({ code: 'remote_offline', message: 'The device is not connected.' })
      )
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new RemoteCallError({ code: 'remote_timeout', message: 'The device did not answer.' })
        )
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.channel.send({ t: 'req', id, method, params: params ?? null })
    })
  }
  event(event: unknown): void {
    if (!this.closed) this.channel.send({ t: 'event', event })
  }
  onClose(listener: () => void): void {
    if (this.closed) listener()
    else this.closeListeners.push(listener)
  }
  close(): void {
    this.channel.close()
    this.finish()
  }
  private finish(): void {
    if (this.closed) return
    this.closed = true
    clearInterval(this.heartbeat)
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new RemoteCallError({ code: 'remote_offline', message: 'The device disconnected.' }))
    }
    this.pending.clear()
    for (const listener of this.closeListeners) listener()
    this.closeListeners = []
  }
}
