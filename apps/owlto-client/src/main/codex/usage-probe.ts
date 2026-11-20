import type { CodexAccount } from '../../shared/app.js'
import { type AgentUsage, unavailableUsage } from '../../shared/usage.js'
import { CodexClient } from './client.js'
import { parseAccount } from './protocol.js'
import { parseCodexRateLimits } from './usage.js'

type PlanAccount = Extract<CodexAccount, { kind: 'chatgpt' }>

/** One short-lived child per in-flight read, including initialize and account verification. */
export class CodexUsageProbe {
  private current: { client: CodexClient; result: Promise<AgentUsage> } | null = null

  read(executable: string, account: PlanAccount): Promise<AgentUsage> {
    if (this.current) return this.current.result
    const client = new CodexClient(
      (frame) => {
        if (frame.id !== undefined) client.reject(frame.id)
      },
      () => {}
    )
    const deadline = setTimeout(() => client.stop(), 30_000)
    const result = this.query(client, executable, account)
      .catch(() => unavailableUsage('codex', 'failed', account.plan))
      .finally(() => {
        clearTimeout(deadline)
        client.stop()
        if (this.current?.client === client) this.current = null
      })
    this.current = { client, result }
    return result
  }

  stop(): void {
    // Disconnect and app shutdown can end the parent's event loop before a
    // grace timer runs. This disposable child has no threads or pending work to save.
    this.current?.client.stop('Codex usage check cancelled.', 'SIGKILL')
    this.current = null
  }

  private async query(client: CodexClient, executable: string, expected: PlanAccount) {
    // Same executable, inherited environment and working directory as the account connection.
    await client.start(executable)
    const account = parseAccount(await client.request('account/read', { refreshToken: false }))
    if (account.kind !== 'chatgpt' || account.email !== expected.email)
      return unavailableUsage('codex', 'failed', expected.plan)
    return parseCodexRateLimits(await client.request('account/rateLimits/read', null), account.plan)
  }
}
