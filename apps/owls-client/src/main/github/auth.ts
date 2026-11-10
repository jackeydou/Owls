import { z } from 'zod'
import type { GitHubAccount, GitHubAuthMethod, GitHubSignInFailure } from '../../shared/github.js'
import { OwlsError } from '../app/errors.js'
import type { DecryptedSecret, SecretCipher } from '../router/credentials.js'
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
/** The stored connection, decrypted. */
type Connection =
  | { method: 'app'; session: Session }
  | { method: 'gh-cli'; login: string }
  | { method: 'token'; token: string; login: string }
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
 * one. Tokens stay in the main process and are encrypted at rest; the stored
 * connection is decrypted once by `load()` and kept in memory after that. An App
 * refresh token works once, so this class is the only thing that refreshes it,
 * and only one refresh runs at a time.
 */
export class GitHubAuth {
  private flow: Flow | null = null
  private failure: GitHubSignInFailure | null = null
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private refreshing: Promise<string | null> | null = null
  /** The decrypted stored connection; null until `load()` finds one. */
  private current: Connection | null = null
  private loading: Promise<void> | null = null

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
    const connection = this.current
    return connection
      ? {
          status: 'signed-in',
          login: login(connection),
          method: connection.method,
          failure: this.failure
        }
      : { status: 'signed-out', failure: this.failure }
  }

  /** How the user is connected, or null when they are not. */
  method(): GitHubAuthMethod | null {
    return this.current?.method ?? null
  }

  /**
   * Decrypts the stored connection and publishes it. Runs once; a stored secret
   * that cannot be decrypted reads as signed out.
   */
  load(): Promise<void> {
    this.loading ??= this.restore()
    return this.loading
  }

  /** Uses the local `gh` sign-in, whose token is read for each request and never stored. */
  async connectGhCli(): Promise<GitHubAccount> {
    await this.requireStorage()
    this.stopFlow()
    this.failure = null
    const token = await this.ghToken()
    if (!token) return this.fail('gh-unavailable')
    return this.connect(token, 'network', (login) => ({ method: 'gh-cli', login }))
  }

  /** Uses a personal access token, once GitHub confirms it works. */
  async connectToken(token: string): Promise<GitHubAccount> {
    await this.requireStorage()
    this.stopFlow()
    this.failure = null
    return this.connect(token, 'invalid-token', (login) => ({ method: 'token', token, login }))
  }

  async signIn(): Promise<GitHubAccount> {
    await this.requireStorage()
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
    this.forget()
    this.failure = null
    this.publish()
  }

  /** An access token for a request; null when the user has to sign in. */
  async token(): Promise<string | null> {
    await this.load()
    const connection = this.current
    if (!connection) return null
    if (connection.method === 'gh-cli') return this.ghToken()
    if (connection.method === 'token') return connection.token
    const { session } = connection
    if (session.expiresAt === null || session.expiresAt - EXPIRY_MARGIN_MS > Date.now())
      return session.accessToken
    this.refreshing ??= this.refresh(session).finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  /** GitHub rejected the stored token, so the user has to sign in again. */
  invalidate(): void {
    this.forget()
    this.failure = 'expired'
    this.publish()
  }

  close(): void {
    this.stopFlow()
  }

  private async requireStorage(): Promise<void> {
    const unavailable = await this.cipher.unavailable()
    if (unavailable) throw new OwlsError('secure_storage_unavailable', unavailable)
  }
  private fail(failure: GitHubSignInFailure): GitHubAccount {
    this.failure = failure
    return this.publish()
  }
  private async connect(
    token: string,
    failure: GitHubSignInFailure,
    connection: (login: string) => Connection
  ): Promise<GitHubAccount> {
    const attempt = this.attempt
    try {
      const login = await this.login(token)
      if (attempt !== this.attempt) return this.account()
      await this.save(connection(login), () => attempt === this.attempt)
    } catch {
      return attempt === this.attempt ? this.fail(failure) : this.account()
    }
    return this.publish()
  }

  private async restore(): Promise<void> {
    const row = this.store.credential(CREDENTIAL_ID)
    if (!row) return
    const decrypted = await this.decrypt(row.secret)
    const connection = decrypted && parseConnection(row.type, decrypted.plain)
    // A connection made while this ran is newer than the stored one it read.
    if (!connection || this.current || this.store.credential(CREDENTIAL_ID)?.secret !== row.secret)
      return
    this.current = connection
    this.publish()
    if (decrypted.stale) await this.reEncrypt(row.secret, connection)
  }
  private async decrypt(secret: string): Promise<DecryptedSecret | null> {
    try {
      return await this.cipher.decrypt(secret)
    } catch {
      return null
    }
  }
  /** Best effort: the stored secret still works if this fails. */
  private async reEncrypt(previous: string, connection: Connection): Promise<void> {
    try {
      const { type, plain } = serializeConnection(connection)
      const encoded = await this.cipher.encrypt(plain)
      if (this.store.credential(CREDENTIAL_ID)?.secret === previous)
        this.store.saveCredential(CREDENTIAL_ID, type, encoded)
    } catch {}
  }
  /** Encrypts and stores a connection, unless `current` says it was replaced meanwhile. */
  private async save(connection: Connection, current: () => boolean): Promise<void> {
    const { type, plain } = serializeConnection(connection)
    const encoded = await this.cipher.encrypt(plain)
    if (!current()) return
    this.store.saveCredential(CREDENTIAL_ID, type, encoded)
    this.current = connection
  }
  private forget(): void {
    this.store.removeCredential(CREDENTIAL_ID)
    this.current = null
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
      await this.save(appConnection(accessToken, reply, login), () => flow.attempt === this.attempt)
      if (flow.attempt !== this.attempt) return
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
    // The old refresh token is spent, so the new one is kept unless the session was replaced.
    await this.save(
      appConnection(reply.access_token, reply, session.login),
      () => this.current?.method === 'app' && this.current.session === session
    )
    return reply.access_token
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

function appConnection(accessToken: string, reply: TokenReply, login: string): Connection {
  const session: Session = {
    accessToken,
    refreshToken: reply.refresh_token ?? null,
    expiresAt: reply.expires_in === undefined ? null : Date.now() + reply.expires_in * 1000,
    login
  }
  return { method: 'app', session }
}
function login(connection: Connection): string {
  return connection.method === 'app' ? connection.session.login : connection.login
}
function serializeConnection(connection: Connection): { type: string; plain: string } {
  if (connection.method === 'app')
    return { type: CREDENTIAL_TYPE, plain: JSON.stringify(connection.session) }
  if (connection.method === 'gh-cli')
    return { type: GH_CLI_TYPE, plain: JSON.stringify({ login: connection.login }) }
  return {
    type: TOKEN_TYPE,
    plain: JSON.stringify({ token: connection.token, login: connection.login })
  }
}
/** Reads a decrypted credential row; null when its type or shape is unknown. */
function parseConnection(type: string, plain: string): Connection | null {
  try {
    const value: unknown = JSON.parse(plain)
    if (type === CREDENTIAL_TYPE) return { method: 'app', session: sessionSchema.parse(value) }
    if (type === GH_CLI_TYPE) return { method: 'gh-cli', login: ghCliSchema.parse(value).login }
    if (type === TOKEN_TYPE) return { method: 'token', ...tokenSchema.parse(value) }
  } catch {}
  return null
}
