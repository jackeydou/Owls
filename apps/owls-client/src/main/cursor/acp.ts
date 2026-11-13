import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { z } from 'zod'
import { OwlsError } from '../app/errors.js'
import { safeText } from '../codex/protocol.js'

/** One JSON-RPC 2.0 message. Requests carry `id` and `method`; notifications only `method`. */
const frameSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional()
})

/** JSON-RPC's code for a method the receiver does not implement. */
export const METHOD_NOT_FOUND = -32601
const INTERNAL_ERROR = -32603
const LINE_LIMIT = 8 * 1024 * 1024
const STDERR_LIMIT = 4000

/** Thrown by a request handler to answer with a JSON-RPC error instead of a result. */
export class AcpReplyError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
    this.name = 'AcpReplyError'
  }
}

export type AcpHandlers = {
  /** A notification from the agent; it needs no answer. */
  notification(method: string, params: unknown): void
  /** A request from the agent. The resolved value is the result; a rejection answers with an error. */
  request(method: string, params: unknown): Promise<unknown>
  /** The agent process exited or its stream broke; pending requests have been rejected. */
  closed(reason: string): void
}

type Pending = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * The client side of an Agent Client Protocol connection: newline-delimited
 * JSON-RPC 2.0 over an agent process's stdin and stdout. Owns the process; its
 * stderr is kept only as a short tail for error messages.
 */
export class AcpConnection {
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private closed = false
  private stderr = ''

  constructor(private readonly handlers: AcpHandlers) {}

  start(executable: string, args: string[], cwd: string): void {
    if (this.child || this.closed) throw new OwlsError('busy', 'The agent is already running.')
    const child = spawn(executable, args, {
      cwd,
      stdio: 'pipe',
      windowsHide: true,
      // A process group lets close() stop the shells and tools the agent started.
      detached: process.platform !== 'win32'
    })
    this.child = child
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', (line) => {
      if (this.closed || this.child !== child || !line.trim()) return
      if (line.length > LINE_LIMIT) {
        this.fail('The agent sent a message that is too large.')
        return
      }
      let frame: z.infer<typeof frameSchema>
      try {
        frame = frameSchema.parse(JSON.parse(line))
      } catch {
        // ACP reserves stdout for protocol messages; anything else means the stream is unusable.
        this.fail('The agent sent a message Owls could not read.')
        return
      }
      this.receive(frame)
    })
    child.stderr.on('data', (data: Buffer) => {
      this.stderr = (this.stderr + data.toString('utf8')).slice(-STDERR_LIMIT)
    })
    child.on('error', () => this.fail('Unable to launch the selected Cursor executable.'))
    child.on('exit', (code, signal) => {
      lines.close()
      if (this.child === child) this.fail(`The agent exited (${signal ?? code ?? 'exit'}).`)
    })
  }

  /** The end of the agent's diagnostics, with credentials redacted. */
  diagnostics(): string {
    return safeText(this.stderr.trim()).slice(-1000)
  }

  /** `timeoutMs` null waits for as long as the agent works, as a prompt turn must. */
  request(method: string, params: unknown, timeoutMs: number | null): Promise<unknown> {
    const child = this.child
    if (!child || this.closed)
      return Promise.reject(new OwlsError('cursor_disconnected', 'The agent is not running.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id)
              reject(new OwlsError('cursor_disconnected', `The agent did not answer ${method}.`))
            }, timeoutMs)
      this.pending.set(id, { method, resolve, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    if (this.child && !this.closed) this.write({ jsonrpc: '2.0', method, params })
  }

  /** Stops the agent and everything it started. Safe to call more than once. */
  close(): void {
    const child = this.child
    this.fail('The agent connection closed.')
    if (!child?.pid) return
    child.stdin.end()
    const signal = (name: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32') process.kill(-(child.pid as number), name)
        else child.kill(name)
      } catch {
        /* The process already exited. */
      }
    }
    signal('SIGTERM')
    const kill = setTimeout(() => signal('SIGKILL'), 3000)
    kill.unref()
    child.once('exit', () => clearTimeout(kill))
  }

  private receive(frame: z.infer<typeof frameSchema>): void {
    if (frame.method && frame.id !== undefined && frame.id !== null) {
      void this.answer(frame.id, frame.method, frame.params)
      return
    }
    if (frame.method) {
      this.handlers.notification(frame.method, frame.params)
      return
    }
    if (typeof frame.id !== 'number') return
    const pending = this.pending.get(frame.id)
    if (!pending) return
    if (pending.timer) clearTimeout(pending.timer)
    this.pending.delete(frame.id)
    if (frame.error)
      pending.reject(
        new OwlsError(
          'cursor_disconnected',
          `${pending.method}: ${safeText(frame.error.message).slice(0, 800)}`
        )
      )
    else pending.resolve(frame.result ?? null)
  }

  private async answer(id: string | number, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.handlers.request(method, params)
      this.write({ jsonrpc: '2.0', id, result: result ?? null })
    } catch (error) {
      const reply =
        error instanceof AcpReplyError
          ? { code: error.code, message: error.message }
          : { code: INTERNAL_ERROR, message: 'Owls could not handle this request.' }
      this.write({ jsonrpc: '2.0', id, error: reply })
    }
  }

  private write(frame: Record<string, unknown>): void {
    const child = this.child
    if (!child || this.closed) return
    child.stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
      if (error) this.fail('The agent connection closed before a message was delivered.')
    })
  }

  private fail(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.child = null
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(new OwlsError('cursor_disconnected', reason))
    }
    this.pending.clear()
    this.handlers.closed(reason)
  }
}
