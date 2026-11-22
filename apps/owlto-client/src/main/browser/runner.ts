import { randomUUID } from 'node:crypto'
import { type UtilityProcess, utilityProcess } from 'electron'
import type { ReportToolResult } from '../router/report.js'
import type { HandoffResult } from './manager.js'
import type { DownloadsReport } from './profile.js'
import type { BrowserHostReply, BrowserHostRequest, BrowserRunMode } from './protocol.js'
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
      /** The CDP gate endpoint for one worker. */
      endpoint: (key: string) => Promise<string>
      /** Resolves false if the user still holds the worker's tab after `timeoutMs`. */
      waitForAgent: (key: string, timeoutMs: number) => Promise<boolean>
      shotsDir: () => string
      handoff: (key: string, reason: string, timeoutMs: number) => Promise<HandoffResult>
      /** Downloads the worker's pages finished since its last call. */
      takeDownloads: (key: string) => DownloadsReport
    }
  ) {}

  async handoff(key: string, reason: string, timeoutMs: number): Promise<ReportToolResult> {
    if (this.closed) return { ok: false, text: 'Owlto is quitting.' }
    const result = await this.paths.handoff(key, reason, timeoutMs)
    return withDownloads(handoffText(result), this.paths.takeDownloads(key))
  }

  async run(
    key: string,
    code: string,
    budgetMs: number,
    mode: BrowserRunMode
  ): Promise<ReportToolResult> {
    if (this.closed) return { ok: false, text: 'Owlto is quitting.' }
    const started = Date.now()
    if (!(await this.paths.waitForAgent(key, budgetMs)))
      return {
        ok: false,
        text: 'The user is using your browser tab. Try again after they hand it back.'
      }
    if (this.closed) return { ok: false, text: 'Owlto is quitting.' }
    const timeoutMs = Math.max(1_000, budgetMs - (Date.now() - started))
    let endpoint: string
    try {
      endpoint = await this.paths.endpoint(key)
    } catch (error) {
      return { ok: false, text: `Owlto’s browser could not start: ${String(error)}` }
    }
    const child = this.start()
    const id = randomUUID()
    const result = await new Promise<ReportToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this.stop('The browser stopped responding, so Owlto restarted it. Open the page again.')
      }, timeoutMs + HANG_GRACE_MS)
      this.pending.set(id, { resolve, timer })
      const request: BrowserHostRequest = {
        type: 'run',
        id,
        key,
        code,
        mode,
        timeoutMs,
        endpoint,
        shotsDir: this.paths.shotsDir()
      }
      child.postMessage(request)
    })
    return withDownloads(result, this.paths.takeDownloads(key))
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

function handoffText(result: HandoffResult): ReportToolResult {
  if (result.status === 'no-tab')
    return { ok: false, text: 'You have no browser tab yet. Open the page with `browser` first.' }
  const at = result.url ? ` The tab is at ${result.url}` : ''
  if (result.status === 'done')
    return { ok: true, text: `The user handed the tab back.${at} Check the page before you go on.` }
  if (result.status === 'closed')
    return { ok: false, text: 'The user closed the tab instead of handing it back.' }
  return {
    ok: false,
    text: `The user did not hand the tab back in time, so it is yours again.${at}`
  }
}

/** Adds the worker's new downloads to a reply, so it can open the files. */
function withDownloads(result: ReportToolResult, downloads: DownloadsReport): ReportToolResult {
  const lines: string[] = []
  if (downloads.done.length) lines.push('Downloaded:', ...downloads.done.map((path) => `- ${path}`))
  if (downloads.pending.length)
    lines.push(`Still downloading: ${downloads.pending.join(', ')}. The next call lists them.`)
  if (!lines.length) return result
  return { ...result, text: `${result.text}\n\n${lines.join('\n')}` }
}
