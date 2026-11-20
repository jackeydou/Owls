import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CodexConnection, Failure } from '../../shared/app.js'
import { type AgentUsage, unavailableUsage } from '../../shared/usage.js'
import { OwltoError, toFailure } from '../app/errors.js'
import { CodexClient, discoverExecutable } from './client.js'
import { parseAccount, parseModels, type RpcFrame } from './protocol.js'
import { CodexUsageProbe } from './usage-probe.js'

const execFileAsync = promisify(execFile)
const retryDelays = [1000, 2000, 4000, 8000, 16_000]

/** Owns the account's stdio connection. Recovery never opens a thread or sends a turn. */
export class CodexAccountConnection {
  client: CodexClient | null = null
  state: CodexConnection = {
    status: 'disconnected',
    executablePath: null,
    version: null,
    account: { kind: 'signed-out' },
    models: [],
    error: null
  }
  private pending: Promise<CodexConnection> | null = null
  private controller: AbortController | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private readySince = 0
  private readonly probe = new CodexUsageProbe()

  constructor(
    private readonly executablePath: () => string | null,
    private readonly frame: (frame: RpcFrame) => void,
    private readonly publish: (state: CodexConnection) => void,
    private readonly lost: (reason: string) => void
  ) {}

  connect(): Promise<CodexConnection> {
    if (this.pending) return this.pending
    this.cancel()
    this.attempts = 0
    return this.open(false)
  }

  disconnect(): CodexConnection {
    this.cancel()
    this.update({
      status: 'disconnected',
      account: { kind: 'signed-out' },
      models: [],
      error: null
    })
    return this.state
  }

  private cancel(): void {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    this.controller?.abort()
    this.controller = null
    this.pending = null
    this.probe.stop()
    const client = this.client
    this.client = null
    client?.stop()
  }

  private open(recovering: boolean): Promise<CodexConnection> {
    const controller = new AbortController()
    this.controller = controller
    const client = new CodexClient(this.frame, (reason) => {
      // An unsuccessful handshake is handled by openClient's catch. cancel() also
      // detaches the client before deliberately stopping it.
      if (this.client !== client) return
      this.client = null
      if (this.state.status !== 'ready') return
      this.probe.stop()
      this.lost(reason)
      if (controller.signal.aborted) return
      if (performance.now() - this.readySince >= 60_000) this.attempts = 0
      this.recover({ code: 'disconnected', message: reason })
    })
    this.client = client
    this.update({ status: 'connecting', error: null })
    const pending = this.openClient(client, controller.signal, recovering).finally(() => {
      if (this.controller === controller) this.pending = null
    })
    this.pending = pending
    return pending
  }

  private async openClient(client: CodexClient, signal: AbortSignal, recovering: boolean) {
    try {
      const executable = discoverExecutable(this.executablePath())
      const { stdout } = await execFileAsync(executable, ['--version'], {
        timeout: 10_000,
        maxBuffer: 4096,
        windowsHide: true,
        signal
      })
      if (signal.aborted) return this.state
      await client.start(executable, { experimentalApi: true })
      const account = await this.accountAndModels(client)
      if (!signal.aborted) {
        // The final reply and a protocol failure can arrive in the same stdout chunk.
        if (this.client !== client) throw new OwltoError('disconnected')
        this.readySince = performance.now()
        this.update({
          ...account,
          executablePath: executable,
          version: stdout.trim(),
          status: 'ready',
          error: null
        })
      }
    } catch (error) {
      if (!signal.aborted) {
        this.client = null
        client.stop()
        const failure = toFailure(error)
        if (recovering) this.recover(failure)
        else
          this.update({
            status: 'error',
            account: { kind: 'signed-out' },
            models: [],
            error: failure
          })
      }
    }
    return this.state
  }

  private recover(error: Failure): void {
    const delay = retryDelays[this.attempts]
    if (delay === undefined) {
      this.update({ status: 'error', error })
      return
    }
    this.attempts++
    this.retry = setTimeout(() => {
      this.retry = null
      void this.open(true)
    }, delay)
    this.update({ status: 'connecting', error: null })
  }

  async refreshAccount(): Promise<void> {
    const client = this.client
    if (!client || this.state.status !== 'ready') return
    try {
      const updated = await this.accountAndModels(client)
      if (client !== this.client) return
      const previous = this.state.account
      if (
        previous.kind === 'chatgpt' &&
        (updated.account.kind !== 'chatgpt' || updated.account.email !== previous.email)
      )
        this.probe.stop()
      this.update(updated)
    } catch (error) {
      if (client === this.client) this.update({ error: toFailure(error) })
    }
  }

  private async accountAndModels(client: CodexClient) {
    const account = parseAccount(await client.request('account/read', { refreshToken: false }))
    const models =
      account.kind === 'signed-out'
        ? []
        : parseModels(await client.request('model/list', { limit: 100, includeHidden: false }))
    return { account, models }
  }

  async usage(): Promise<AgentUsage> {
    const { status, account, executablePath } = this.state
    if (status !== 'ready' || !executablePath) return unavailableUsage('codex', 'not-connected')
    if (account.kind === 'signed-out') return unavailableUsage('codex', 'signed-out')
    if (account.kind === 'api-key') return unavailableUsage('codex', 'api-key')
    if (account.kind === 'external') return unavailableUsage('codex', 'no-plan-limits')
    return this.probe.read(executablePath, account)
  }

  readyClient(): CodexClient {
    if (!this.client || this.state.status !== 'ready')
      throw new OwltoError('not_connected', 'Connect your local Codex installation in Settings.')
    return this.client
  }

  private update(change: Partial<CodexConnection>): void {
    this.state = { ...this.state, ...change }
    this.publish(this.state)
  }
}
