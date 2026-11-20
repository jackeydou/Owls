import type { PushRequest, PushResult } from './room.ts'

/**
 * Sends a host's sealed notification to an iPhone through APNs. The relay never sees what
 * the notification says: `payload` is sealed with a key only the host and the phone hold,
 * and the phone's Notification Service Extension opens it. Until it does (or when it
 * cannot), the phone shows the generic text named by the localization keys below.
 */
export type ApnsConfig = {
  /** The `.p8` key from the Apple Developer account, as PEM. */
  key: string
  keyId: string
  teamId: string
  /** The app's bundle id. */
  topic: string
}

/** Apple accepts a token for an hour; a fresh one every 50 minutes stays clear of that. */
const TOKEN_LIFETIME_MS = 50 * 60_000

export function apnsBody(payload: string): string {
  return JSON.stringify({
    aps: {
      alert: { 'title-loc-key': 'PUSH_FALLBACK_TITLE', 'loc-key': 'PUSH_FALLBACK_BODY' },
      'mutable-content': 1,
      sound: 'default'
    },
    e: payload
  })
}

export class ApnsSender {
  private readonly config: ApnsConfig
  private readonly fetcher: typeof fetch
  private cached: { jwt: string; at: number } | null = null
  constructor(config: ApnsConfig, fetcher: typeof fetch = fetch) {
    this.config = config
    this.fetcher = fetcher
  }

  async send(request: PushRequest, now = Date.now()): Promise<PushResult> {
    const host = request.sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'
    let response: Response
    try {
      response = await this.fetcher(`https://${host}/3/device/${request.token}`, {
        method: 'POST',
        headers: {
          authorization: `bearer ${await this.jwt(now)}`,
          'apns-topic': this.config.topic,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          // A notification about a waiting approval is stale after a day.
          'apns-expiration': String(Math.floor(now / 1000) + 24 * 60 * 60),
          'content-type': 'application/json'
        },
        body: apnsBody(request.payload)
      })
    } catch {
      return 'failed'
    }
    if (response.ok) return 'sent'
    if (response.status === 410) return 'gone'
    if (response.status === 400) {
      const reason = await response
        .json()
        .then((body: unknown) => (body as { reason?: unknown }).reason)
        .catch(() => null)
      if (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic') return 'gone'
    }
    return 'failed'
  }

  /** The provider token: an ES256 JWT signed with the `.p8` key. */
  async jwt(now: number): Promise<string> {
    if (this.cached && now - this.cached.at < TOKEN_LIFETIME_MS) return this.cached.jwt
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: this.config.keyId }))
    const claims = base64url(
      JSON.stringify({ iss: this.config.teamId, iat: Math.floor(now / 1000) })
    )
    const key = await crypto.subtle.importKey(
      'pkcs8',
      pemBytes(this.config.key),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    )
    // Web Crypto returns the raw r ‖ s signature, which is what JWS wants.
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(`${header}.${claims}`)
    )
    const jwt = `${header}.${claims}.${base64url(new Uint8Array(signature))}`
    this.cached = { jwt, at: now }
    return jwt
  }
}

function pemBytes(pem: string): ArrayBuffer {
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
