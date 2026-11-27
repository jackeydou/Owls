import { connect, type Socket } from 'node:net'

/**
 * A two-way pipe of whole binary frames. It is all the secure channel needs from a
 * transport: TCP for direct connections now, a relay's WebSocket later.
 */
export interface FrameChannel {
  send(frame: Buffer): void
  /** Called once per frame, in order. */
  onFrame(listener: (frame: Buffer) => void): void
  /** Called once, when either side closes or the connection fails. */
  onClose(listener: (error: Error | null) => void): void
  close(): void
  /** How the end-to-end channel checks that the peer is still there; direct when absent. */
  readonly keepalive?: Keepalive
}

/**
 * When to ping a quiet peer, and how long a silence means it went away: a link quiet for
 * `pingMs` sends a ping, and closes when no answer comes before `idleMs` in all. A relay bills for
 * the time a message keeps it awake, so its pipes ping rarely and lean on the relay closing
 * a pipe when either end drops.
 */
export type Keepalive = { pingMs: number; idleMs: number }
export const DIRECT_KEEPALIVE: Keepalive = { pingMs: 20_000, idleMs: 50_000 }

/** The largest frame either side accepts; a snapshot of a long history is the biggest. */
export const MAX_FRAME_BYTES = 32 * 1024 * 1024
const HEADER_BYTES = 4

/** Frames over a TCP socket, each prefixed with its length as a 32-bit big-endian number. */
export class SocketFrames implements FrameChannel {
  private buffer: Buffer = Buffer.alloc(0)
  private frameListener: ((frame: Buffer) => void) | null = null
  private closeListeners: ((error: Error | null) => void)[] = []
  private closed = false
  private failure: Error | null = null
  /** Frames that arrived before a listener was set. */
  private early: Buffer[] = []
  constructor(private readonly socket: Socket) {
    socket.setNoDelay(true)
    socket.on('data', (chunk: Buffer) => this.receive(chunk))
    socket.on('error', (error) => {
      this.failure = error
    })
    socket.on('close', () => this.finish())
  }
  private receive(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    while (this.buffer.length >= HEADER_BYTES) {
      const length = this.buffer.readUInt32BE(0)
      if (length > MAX_FRAME_BYTES) {
        this.failure = new Error('Frame too large.')
        this.socket.destroy()
        return
      }
      if (this.buffer.length < HEADER_BYTES + length) return
      const frame = Buffer.from(this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + length))
      this.buffer = this.buffer.subarray(HEADER_BYTES + length)
      if (this.frameListener) this.frameListener(frame)
      else this.early.push(frame)
    }
  }
  private finish(): void {
    if (this.closed) return
    this.closed = true
    for (const listener of this.closeListeners) listener(this.failure)
    this.closeListeners = []
  }
  send(frame: Buffer): void {
    if (this.closed) return
    if (frame.length > MAX_FRAME_BYTES) throw new Error('Frame too large.')
    const header = Buffer.alloc(HEADER_BYTES)
    header.writeUInt32BE(frame.length, 0)
    this.socket.write(Buffer.concat([header, frame]))
  }
  onFrame(listener: (frame: Buffer) => void): void {
    this.frameListener = listener
    const early = this.early
    this.early = []
    for (const frame of early) listener(frame)
  }
  onClose(listener: (error: Error | null) => void): void {
    if (this.closed) listener(this.failure)
    else this.closeListeners.push(listener)
  }
  close(): void {
    this.socket.end()
    this.socket.destroySoon()
  }
}

/** Opens a TCP connection; rejects when it cannot connect within `timeoutMs`. */
export function connectFrames(host: string, port: number, timeoutMs = 8000): Promise<SocketFrames> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('timeout'))
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.removeAllListeners('error')
      resolve(new SocketFrames(socket))
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}
