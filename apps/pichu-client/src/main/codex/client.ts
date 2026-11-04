import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { accessSync, constants, existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { createInterface } from 'node:readline'
import appPackage from '../../../package.json'
import { CodexRuntimeError } from './errors.js'
import { frameSchema, type RpcFrame, safeText } from './protocol.js'

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
export function discoverExecutable(explicit: string | null): string {
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const candidates = explicit
    ? [explicit]
    : [
        ...(process.env.PATH ?? '')
          .split(delimiter)
          .filter(Boolean)
          .map((p) => join(p, name)),
        join(homedir(), '.local', 'bin', name),
        '/opt/homebrew/bin/codex',
        '/usr/local/bin/codex',
        '/Applications/Codex.app/Contents/Resources/codex',
        '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
      ]
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue
      accessSync(candidate, constants.X_OK)
      return realpathSync(candidate)
    } catch {
      /* Try the next installation. */
    }
  }
  throw new CodexRuntimeError(
    'not_installed',
    'Codex CLI was not found. Select your local Codex executable in Settings.'
  )
}
export class CodexClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private closed = true
  constructor(
    private readonly onFrame: (frame: RpcFrame) => void,
    private readonly onClose: (reason: string) => void
  ) {}
  /** `args` are extra app-server flags; `experimentalApi` is needed for dynamic tools (F6). */
  async start(
    executable: string,
    options: { args?: string[]; cwd?: string; experimentalApi?: boolean } = {}
  ): Promise<string> {
    if (this.child) throw new CodexRuntimeError('busy', 'Codex is already connected.')
    const child = spawn(
      executable,
      ['app-server', '--listen', 'stdio://', ...(options.args ?? [])],
      {
        cwd: options.cwd,
        stdio: 'pipe',
        windowsHide: true,
        detached: process.platform !== 'win32'
      }
    )
    this.child = child
    this.closed = false
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', (line) => {
      if (this.closed || this.child !== child) return
      if (line.length > 8 * 1024 * 1024) {
        this.stop()
        return
      }
      try {
        const frame = frameSchema.parse(JSON.parse(line))
        if (frame.method) this.onFrame(frame)
        else if (typeof frame.id === 'number') {
          const pending = this.pending.get(frame.id)
          if (!pending) return
          clearTimeout(pending.timer)
          this.pending.delete(frame.id)
          if (frame.error)
            pending.reject(
              new CodexRuntimeError('native_error', safeText(frame.error.message).slice(0, 800))
            )
          else pending.resolve(frame.result)
        }
      } catch {
        this.stop()
      }
    })
    // Drain stderr without retaining credential-bearing diagnostics.
    child.stderr.on('data', () => {})
    child.on('error', () => this.fail('Unable to launch the selected Codex executable.'))
    child.on('exit', (code, signal) => {
      lines.close()
      if (this.child === child) this.fail(`Codex disconnected (${signal ?? code ?? 'exit'}).`)
    })
    const result = await this.request('initialize', {
      clientInfo: { name: 'owls', title: 'Owls', version: appPackage.version },
      capabilities: { experimentalApi: options.experimentalApi === true }
    })
    this.notify('initialized', {})
    return typeof result === 'object' && result !== null && 'userAgent' in result
      ? String(result.userAgent)
      : 'Codex app-server'
  }
  request(method: string, params: unknown = {}): Promise<unknown> {
    const child = this.child
    if (!child || this.closed)
      return Promise.reject(new CodexRuntimeError('not_connected', 'Codex is not connected.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new CodexRuntimeError(
            'unknown_result',
            'Codex did not acknowledge ' +
              method +
              '. Its result may be unknown; reconnect before continuing.'
          )
        )
        this.stop()
      }, 60_000)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(
          new CodexRuntimeError(
            'disconnected',
            'The Codex connection closed before the request was delivered.'
          )
        )
      })
    })
  }
  notify(method: string, params: unknown): void {
    this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`)
  }
  respond(id: string | number, result: unknown): void {
    if (!this.child || this.closed)
      throw new CodexRuntimeError(
        'request_unavailable',
        'This Codex request is no longer available.'
      )
    this.child.stdin.write(`${JSON.stringify({ id, result })}\n`)
  }
  reject(id: string | number): void {
    this.child?.stdin.write(
      `${JSON.stringify({
        id,
        error: { code: -32601, message: 'This request is not supported by Owls.' }
      })}\n`
    )
  }
  stop(): void {
    const child = this.child
    this.fail('Codex connection closed.')
    if (!child?.pid) return
    child.stdin.end()
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
      else child.kill('SIGTERM')
    } catch {
      /* The owned process already exited. */
    }
  }
  private fail(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.child = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new CodexRuntimeError('disconnected', reason))
    }
    this.pending.clear()
    this.onClose(reason)
  }
}
