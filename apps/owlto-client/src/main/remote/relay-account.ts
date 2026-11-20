import { z } from 'zod'
import type {
  RemoteRelayAccount,
  RemoteRelayMac,
  RemoteRelaySignInFailure
} from '../../shared/remote.js'
import { OwltoError } from '../app/errors.js'
import type { GitHubCredentialStore } from '../github/auth.js'
import type { DecryptedSecret, SecretCipher } from '../router/credentials.js'

/**
 * Owlto's own GitHub OAuth App for the relay, "Owlto Relay". It asks for no scope, so its
 * token can only read a public profile; it is not the app's GitHub connection. Public by
 * design: the device flow needs no client secret.
 */
export const RELAY_CLIENT_ID = 'Ov23liMVwICtVSHS13Jr'
const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const CREDENTIAL_ID = 'relay'
const CREDENTIAL_TYPE = 'relay_session'
const REQUEST_TIMEOUT_MS = 15_000

const deviceCodeSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string().url(),
  expires_in: z.number(),
  interval: z.number()
})
const tokenReplySchema = z.object({
  access_token: z.string().optional(),
  error: z.string().optional(),
  interval: z.number().optional()
})
const storedSchema = z.object({ session: z.string(), login: z.string() })
type Stored = z.infer<typeof storedSchema>
const loginReplySchema = storedSchema
const macsReplySchema = z.object({
  mailboxes: z.array(
    z.object({
      mailbox: z.string(),
      name: z.string().nullable(),
      claimedAt: z.number(),
      thisMac: z.boolean(),
      online: z.boolean(),
      lastHostAt: z.number().nullable()
    })
  )
})
type Flow = {
  attempt: number
  deviceCode: string
  intervalMs: number
  deadline: number
  userCode: string
  verificationUri: string
}

export type RelayAccountOptions = {
  store: GitHubCredentialStore
  cipher: SecretCipher
  /** The relay's WebSocket base URL; account requests go to its https twin. */
  relayUrl: string
  /** This Mac's name, shown on the account's list of Macs. */
  deviceName: () => string
  /** Signed in, signed out, or the sign-in moved on. */
  changed: () => void
  http?: typeof fetch
}

/**
 * This Mac's relay account. The GitHub token from the device flow goes to the relay once,
 * which checks who it is and hands back a relay session; only that session is kept,
 * encrypted. The relay can end it at any time (sign out, the Mac removed on another Mac),
 * and every host connect shows it again.
 */
export class RelayAccount {
  private readonly options: RelayAccountOptions
  private readonly http: typeof fetch
  private current: Stored | null = null
  private failure: RemoteRelaySignInFailure | null = null
  private flow: Flow | null = null
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private loading: Promise<void> | null = null

  constructor(options: RelayAccountOptions) {
    this.options = options
    this.http = options.http ?? fetch
  }

  state(): RemoteRelayAccount {
    if (this.flow)
      return {
        status: 'pending',
        userCode: this.flow.userCode,
        verificationUri: this.flow.verificationUri,
        expiresAt: new Date(this.flow.deadline).toISOString()
      }
    return this.current
      ? { status: 'signed-in', login: this.current.login }
      : { status: 'signed-out', failure: this.failure }
  }

  /** The relay session for the host hello; null when this Mac is not signed in. */
  async session(): Promise<string | null> {
    await this.load()
    return this.current?.session ?? null
  }

  /** The loaded session, without waiting for `load()`; null when there is none yet. */
  loadedSession(): string | null {
    return this.current?.session ?? null
  }

  load(): Promise<void> {
    this.loading ??= this.restore()
    return this.loading
  }

  async signIn(): Promise<void> {
    const unavailable = await this.options.cipher.unavailable()
    if (unavailable) throw new OwltoError('secure_storage_unavailable', unavailable)
    this.stopFlow()
    const attempt = this.attempt
    this.failure = null
    try {
      const code = deviceCodeSchema.parse(
        await this.postGitHub(DEVICE_CODE_URL, { client_id: RELAY_CLIENT_ID })
      )
      if (attempt !== this.attempt) return
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
    this.options.changed()
  }

  cancelSignIn(): void {
    this.stopFlow()
    this.failure = null
    this.options.changed()
  }

  /** Ends the session on the relay (best effort) and forgets it here. */
  async signOut(): Promise<void> {
    this.stopFlow()
    const session = await this.session()
    this.forget(null)
    if (session) await this.relay('DELETE', '/session', session).catch(() => null)
  }

  /** The relay turned the stored session down: this Mac has to sign in again. */
  invalidate(): void {
    if (!this.current) return
    this.forget('expired')
  }

  async macs(): Promise<RemoteRelayMac[]> {
    const session = await this.session()
    if (!session) throw new OwltoError('remote_relay_login', 'Sign in to the relay first.')
    const reply = await this.relay('GET', '', session)
    return [...macsReplySchema.parse(reply).mailboxes].sort(
      (a, b) => Number(b.thisMac) - Number(a.thisMac) || a.claimedAt - b.claimedAt
    )
  }

  async removeMac(mailbox: string): Promise<RemoteRelayMac[]> {
    const session = await this.session()
    if (!session) throw new OwltoError('remote_relay_login', 'Sign in to the relay first.')
    await this.relay('DELETE', `/mailbox/${mailbox}`, session)
    // Removing this Mac's own mailbox ends its own session too.
    const own = this.current?.session === session ? await this.check(session) : true
    return own ? this.macs() : []
  }

  close(): void {
    this.stopFlow()
  }

  private async check(session: string): Promise<boolean> {
    try {
      await this.relay('GET', '', session)
      return true
    } catch (error) {
      if (error instanceof OwltoError && error.code === 'remote_relay_login') return false
      throw error
    }
  }

  private async restore(): Promise<void> {
    const row = this.options.store.credential(CREDENTIAL_ID)
    if (!row || row.type !== CREDENTIAL_TYPE) return
    let opened: DecryptedSecret
    try {
      opened = await this.options.cipher.decrypt(row.secret)
    } catch {
      return
    }
    const parsed = storedSchema.safeParse(safeJson(opened.plain))
    // A sign-in that finished while this ran is newer than the row it read.
    if (!parsed.success || this.current) return
    this.current = parsed.data
    if (opened.stale)
      this.options.store.saveCredential(
        CREDENTIAL_ID,
        CREDENTIAL_TYPE,
        await this.options.cipher.encrypt(opened.plain)
      )
    this.options.changed()
  }

  private forget(failure: RemoteRelaySignInFailure | null): void {
    this.options.store.removeCredential(CREDENTIAL_ID)
    this.current = null
    this.failure = failure
    this.options.changed()
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
  private finishFlow(failure: RemoteRelaySignInFailure | null): void {
    this.stopFlow()
    this.failure = failure
    this.options.changed()
  }

  private async poll(flow: Flow): Promise<void> {
    if (flow.attempt !== this.attempt) return
    if (Date.now() >= flow.deadline) return this.finishFlow('expired')
    let reply: z.infer<typeof tokenReplySchema>
    try {
      reply = tokenReplySchema.parse(
        await this.postGitHub(TOKEN_URL, {
          client_id: RELAY_CLIENT_ID,
          device_code: flow.deviceCode,
          grant_type: DEVICE_GRANT
        })
      )
    } catch {
      if (flow.attempt === this.attempt) this.schedule(flow)
      return
    }
    if (flow.attempt !== this.attempt) return
    if (reply.access_token) return this.complete(flow, reply.access_token)
    if (reply.error === 'authorization_pending') return this.schedule(flow)
    if (reply.error === 'slow_down') {
      flow.intervalMs =
        reply.interval === undefined ? flow.intervalMs + 5000 : reply.interval * 1000
      return this.schedule(flow)
    }
    this.finishFlow(reply.error === 'access_denied' ? 'denied' : 'expired')
  }

  /** Trades the GitHub token for a relay session; the token is not kept. */
  private async complete(flow: Flow, github: string): Promise<void> {
    try {
      const stored = loginReplySchema.parse(
        await this.relay('POST', '/login', null, { github, name: this.options.deviceName() })
      )
      const encoded = await this.options.cipher.encrypt(JSON.stringify(stored))
      if (flow.attempt !== this.attempt) return
      this.options.store.saveCredential(CREDENTIAL_ID, CREDENTIAL_TYPE, encoded)
      this.current = stored
      this.finishFlow(null)
    } catch {
      if (flow.attempt === this.attempt) this.finishFlow('relay')
    }
  }

  /** One `/v1/account…` request. A 401 throws `remote_relay_login` and forgets a matching session. */
  private async relay(
    method: string,
    path: string,
    session: string | null,
    body?: unknown
  ): Promise<unknown> {
    const base = this.options.relayUrl.replace(/^ws/, 'http').replace(/\/+$/, '')
    const response = await this.http(`${base}/v1/account${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(session ? { Authorization: `Bearer ${session}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (response.status === 401) {
      if (session && this.current?.session === session) this.invalidate()
      throw new OwltoError('remote_relay_login', 'The relay sign-in has ended. Sign in again.')
    }
    if (response.status === 429)
      throw new OwltoError('remote_unreachable', 'The relay is busy. Try again in a minute.')
    if (!response.ok)
      throw new OwltoError('remote_unreachable', `The relay returned ${response.status}.`)
    return response.json()
  }

  private async postGitHub(url: string, fields: Record<string, string>): Promise<unknown> {
    const response = await this.http(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`GitHub returned ${response.status}.`)
    return response.json()
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
