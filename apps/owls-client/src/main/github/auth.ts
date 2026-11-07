import { z } from 'zod'
import type { GitHubAccount, GitHubAuthMethod, GitHubSignInFailure } from '../../shared/github.js'
import { CodexRuntimeError } from '../codex/errors.js'
import type { SecretCipher } from '../router/credentials.js'
import { readGhToken } from './gh-cli.js'

/** Public by design: the device flow needs no client secret, so nothing here is sensitive. */
const CLIENT_ID = 'Iv23liQOfnIqy0qK4839'
const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USER_URL = 'https://api.github.com/user'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const CREDENTIAL_ID = 'github'
const CREDENTIAL_TYPE = 'github_app_user'
const GH_CLI_TYPE = 'github_gh_cli'
const TOKEN_TYPE = 'github_token'
const REQUEST_TIMEOUT_MS = 15_000
/** Refresh a little early so a token never expires between reading it and using it. */
const EXPIRY_MARGIN_MS = 60_000

const deviceCodeSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string().url(),
  expires_in: z.number(),
  interval: z.number()
})
/** GitHub reports OAuth failures in a 200 response, so both shapes share this schema. */
const tokenReplySchema = z.object({
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  error: z.string().optional(),
  interval: z.number().optional()
})
type TokenReply = z.infer<typeof tokenReplySchema>
const sessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().nullable(),
  expiresAt: z.number().nullable(),
  login: z.string()
})
type Session = z.infer<typeof sessionSchema>
/** `gh` keeps its own token, so this connection stores only who it belongs to. */
const ghCliSchema = z.object({ login: z.string() })
const tokenSchema = z.object({ token: z.string(), login: z.string() })
type Flow = {
  attempt: number
  deviceCode: string
  intervalMs: number
  deadline: number
  userCode: string
  verificationUri: string
}

export type GitHubHttp = typeof fetch
/** The credential rows the sign-in needs; `RouterStore` in the app. */
export type GitHubCredentialStore = {
  credential(id: string): { type: string; secret: string } | null
  saveCredential(id: string, type: string, secret: string): void
  removeCredential(id: string): void
}

/**
 * The user's one GitHub connection: the GitHub App through the device flow, the
 * local `gh` sign-in, or a personal access token. Connecting replaces the last
 * one. Tokens stay in the main process and are encrypted at rest. An App refresh
 * token works once, so this class is the only thing that refreshes it, and only
 * one refresh runs at a time.
 */
export class GitHubAuth {
  private flow: Flow | null = null
  private failure: GitHubSignInFailure | null = null
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private refreshing: Promise<string | null> | null = null

  constructor(
    private readonly store: GitHubCredentialStore,
    private readonly cipher: SecretCipher,
    private readonly emit: (account: GitHubAccount) => void,
    private readonly http: GitHubHttp = fetch,
    private readonly ghToken: () => Promise<string | null> = readGhToken
  ) {}

  account(): GitHubAccount {
    if (this.flow)
      return {
        status: 'pending',
        userCode: this.flow.userCode,
        verificationUri: this.flow.verificationUri,
        expiresAt: new Date(this.flow.deadline).toISOString()
      }
    const connection = this.connection()
    return connection
      ? { status: 'signed-in', ...connection, failure: this.failure }
      : { status: 'signed-out', failure: this.failure }
  }

  /** How the user is connected, or null when they are not. */
  method(): GitHubAuthMethod | null {
    return this.connection()?.method ?? null
  }

  /** Uses the local `gh` sign-in, whose token is read for each request and never stored. */
  async connectGhCli(): Promise<GitHubAccount> {
    this.requireStorage()
    this.stopFlow()
    this.failure = null
    const token = await this.ghToken()
    if (!token) return this.fail('gh-unavailable')
    return this.connect(token, 'network', (login) =>
      this.store.saveCredential(
        CREDENTIAL_ID,
        GH_CLI_TYPE,
        this.cipher.encrypt(JSON.stringify({ login }))
      )
    )
  }

  /** Uses a personal access token, once GitHub confirms it works. */
  async connectToken(token: string): Promise<GitHubAccount> {
    this.requireStorage()
    this.stopFlow()
    this.failure = null
    return this.connect(token, 'invalid-token', (login) =>
      this.store.saveCredential(
        CREDENTIAL_ID,
        TOKEN_TYPE,
        this.cipher.encrypt(JSON.stringify({ token, login }))
      )
    )
  }

  async signIn(): Promise<GitHubAccount> {
    this.requireStorage()
    this.stopFlow()
    const attempt = this.attempt
    this.failure = null
    try {
      const code = deviceCodeSchema.parse(
        await this.post(DEVICE_CODE_URL, { client_id: CLIENT_ID })
      )
      if (attempt !== this.attempt) return this.account()
      this.flow = {
        attempt,
        deviceCode: code.device_code,
        intervalMs: code.interval * 1000,
        deadline: Date.now() + code.expires_in * 1000,
        userCode: code.user_code,
        verificationUri: code.verification_uri
      }
      this.schedule(this.flow)
    } catch {
      if (attempt === this.attempt) this.failure = 'network'
    }
    return this.publish()
  }

  cancelSignIn(): void {
    this.stopFlow()
    this.failure = null
    this.publish()
  }

  signOut(): void {
    this.stopFlow()
    this.store.removeCredential(CREDENTIAL_ID)
    this.failure = null
    this.publish()
  }

  /** An access token for a request; null when the user has to sign in. */
  async token(): Promise<string | null> {
    const row = this.store.credential(CREDENTIAL_ID)
    if (row?.type === GH_CLI_TYPE) return this.ghToken()
    if (row?.type === TOKEN_TYPE) return this.stored(row.secret, tokenSchema)?.token ?? null
    const session = this.session()
    if (!session) return null
    if (session.expiresAt === null || session.expiresAt - EXPIRY_MARGIN_MS > Date.now())
      return session.accessToken
    this.refreshing ??= this.refresh(session).finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  /** GitHub rejected the stored token, so the user has to sign in again. */
  invalidate(): void {
    this.store.removeCredential(CREDENTIAL_ID)
    this.failure = 'expired'
    this.publish()
  }

  close(): void {
    this.stopFlow()
  }

  private requireStorage(): void {
    const unavailable = this.cipher.unavailable()
    if (unavailable) throw new CodexRuntimeError('secure_storage_unavailable', unavailable)
  }
  private fail(failure: GitHubSignInFailure): GitHubAccount {
    this.failure = failure
    return this.publish()
  }
  private async connect(
    token: string,
    failure: GitHubSignInFailure,
    save: (login: string) => void
  ): Promise<GitHubAccount> {
    const attempt = this.attempt
    try {
      const login = await this.login(token)
      if (attempt === this.attempt) save(login)
    } catch {
      return attempt === this.attempt ? this.fail(failure) : this.account()
    }
    return this.publish()
  }
  private connection(): { login: string; method: GitHubAuthMethod } | null {
    const row = this.store.credential(CREDENTIAL_ID)
    if (row?.type === GH_CLI_TYPE) {
      const stored = this.stored(row.secret, ghCliSchema)
      return stored && { login: stored.login, method: 'gh-cli' }
    }
    if (row?.type === TOKEN_TYPE) {
      const stored = this.stored(row.secret, tokenSchema)
      return stored && { login: stored.login, method: 'token' }
    }
    const session = this.session()
    return session && { login: session.login, method: 'app' }
  }
  private stored<T>(secret: string, schema: z.ZodType<T>): T | null {
    try {
      return schema.parse(JSON.parse(this.cipher.decrypt(secret)))
    } catch {
      return null
    }
  }

  private publish(): GitHubAccount {
    const account = this.account()
    this.emit(account)
    return account
  }
  private stopFlow(): void {
    this.attempt++
    this.flow = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
  private schedule(flow: Flow): void {
    this.timer = setTimeout(() => void this.poll(flow), flow.intervalMs)
  }
  private finishFlow(failure: GitHubSignInFailure | null): void {
    this.stopFlow()
    this.failure = failure
    this.publish()
  }

  private async poll(flow: Flow): Promise<void> {
    if (flow.attempt !== this.attempt) return
    if (Date.now() >= flow.deadline) return this.finishFlow('expired')
    let reply: TokenReply
    try {
      reply = tokenReplySchema.parse(
        await this.post(TOKEN_URL, {
          client_id: CLIENT_ID,
          device_code: flow.deviceCode,
          grant_type: DEVICE_GRANT
        })
      )
    } catch {
      // A dropped request says nothing about the code, which stays good until the deadline.
      if (flow.attempt === this.attempt) this.schedule(flow)
      return
    }
    if (flow.attempt !== this.attempt) return
    if (reply.access_token) return this.complete(flow, reply.access_token, reply)
    if (reply.error === 'authorization_pending') return this.schedule(flow)
    if (reply.error === 'slow_down') {
      flow.intervalMs =
        reply.interval === undefined ? flow.intervalMs + 5000 : reply.interval * 1000
      return this.schedule(flow)
    }
    this.finishFlow(reply.error === 'access_denied' ? 'denied' : 'expired')
  }

  private async complete(flow: Flow, accessToken: string, reply: TokenReply): Promise<void> {
    try {
      const login = await this.login(accessToken)
      if (flow.attempt !== this.attempt) return
      this.save(accessToken, reply, login)
      this.finishFlow(null)
    } catch {
      if (flow.attempt === this.attempt) this.finishFlow('network')
    }
  }

  private async refresh(session: Session): Promise<string | null> {
    if (!session.refreshToken) {
      this.invalidate()
      return null
    }
    // A failed request leaves the session alone; only GitHub's own answer ends it.
    const reply = tokenReplySchema.parse(
      await this.post(TOKEN_URL, {
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken
      })
    )
    if (!reply.access_token) {
      this.invalidate()
      return null
    }
    this.save(reply.access_token, reply, session.login)
    return reply.access_token
  }

  private save(accessToken: string, reply: TokenReply, login: string): void {
    const session: Session = {
      accessToken,
      refreshToken: reply.refresh_token ?? null,
      expiresAt: reply.expires_in === undefined ? null : Date.now() + reply.expires_in * 1000,
      login
    }
    this.store.saveCredential(
      CREDENTIAL_ID,
      CREDENTIAL_TYPE,
      this.cipher.encrypt(JSON.stringify(session))
    )
  }

  private session(): Session | null {
    const row = this.store.credential(CREDENTIAL_ID)
    return row?.type === CREDENTIAL_TYPE ? this.stored(row.secret, sessionSchema) : null
  }

  private async login(accessToken: string): Promise<string> {
    const response = await this.http(USER_URL, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`GitHub returned ${response.status}.`)
    return z.object({ login: z.string() }).parse(await response.json()).login
  }

  private async post(url: string, fields: Record<string, string>): Promise<unknown> {
    const response = await this.http(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`GitHub returned ${response.status}.`)
    return response.json()
  }
}
