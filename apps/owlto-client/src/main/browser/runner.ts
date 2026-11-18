import { randomUUID } from 'node:crypto'
import { type UtilityProcess, utilityProcess } from 'electron'
import type { ReportToolResult } from '../router/report.js'
import type { BrowserHostReply, BrowserHostRequest } from './protocol.js'
import type { WorkerBrowser } from './tool.js'

/** Extra time the host gets past a script's own timeout before it counts as hung. */
const HANG_GRACE_MS = 15_000

type Pending = { resolve: (result: ReportToolResult) => void; timer: NodeJS.Timeout }

/**
 * Starts the browser host utility process on first use and forwards worker
 * scripts to it. A host that stops answering is killed and starts again on the
 * next run, so one stuck script cannot block other workers for long.
 */
export class BrowserHost implements WorkerBrowser {
  private child: UtilityProcess | null = null
  private readonly pending = new Map<string, Pending>()
  private closed = false

  constructor(
    private readonly paths: {
      /** The built `browser/host.js` entry. */
      entry: string
      profileDir: () => string
      shotsDir: () => string
    }
  ) {}

  run(key: string, code: string, timeoutMs: number): Promise<ReportToolResult> {
    if (this.closed) return Promise.resolve({ ok: false, text: 'Owlto is quitting.' })
    const child = this.start()
    const id = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.stop('The browser stopped responding, so Owlto restarted it. Open the page again.')
      }, timeoutMs + HANG_GRACE_MS)
      this.pending.set(id, { resolve, timer })
      const request: BrowserHostRequest = {
        type: 'run',
        id,
        key,
        code,
        timeoutMs,
        profileDir: this.paths.profileDir(),
        shotsDir: this.paths.shotsDir()
      }
      child.postMessage(request)
    })
  }

  close(): void {
    this.closed = true
    this.stop('Owlto is quitting.')
  }

  private start(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(this.paths.entry, [], {
      serviceName: 'Owlto Browser',
      stdio: 'ignore'
    })
    child.on('message', (reply: BrowserHostReply) => {
      const entry = this.pending.get(reply.id)
      if (!entry) return
      this.pending.delete(reply.id)
      clearTimeout(entry.timer)
      entry.resolve({ ok: reply.ok, text: reply.text })
    })
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.settleAll('The browser host exited. Run the script again.')
    })
    this.child = child
    return child
  }

  private stop(reason: string): void {
    const child = this.child
    this.child = null
    child?.kill()
    this.settleAll(reason)
  }

  private settleAll(reason: string): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.resolve({ ok: false, text: reason })
    }
    this.pending.clear()
  }
}
