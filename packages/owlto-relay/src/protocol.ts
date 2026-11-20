/**
 * The relay's own wire protocol. It is separate from Remote Router's end-to-end protocol
 * (`REMOTE_PROTOCOL` in the desktop app): the relay never reads the sealed frames it carries,
 * so an end-to-end change never needs a relay deploy.
 *
 * Four kinds of WebSocket, each at `/v1/<kind>/<mailbox>`:
 *
 *   host    a host Mac's control socket, kept open while it allows internet connections
 *           → { t: 'host', v, secret, github? }     ← { t: 'ready' } | { t: 'error', code }
 *             (`github`, a GitHub token, is needed only to register a new mailbox)
 *           → { t: 'tickets', hashes }               (replaces the tickets that may connect)
 *           → { t: 'rendezvous', ticket }            ← { t: 'rendezvous', code, expiresAt }
 *             (a short code that finds this mailbox and the pairing ticket for 5 minutes)
 *           → { t: 'ack', ids }                      (queued items the host has taken)
 *           → { t: 'push', token, sandbox, payload } ← { t: 'push-gone', token } on a dead token
 *           ← { t: 'incoming', pipe }                (a client is waiting: open a pipe for it)
 *           ← { t: 'queued', items }                 (sealed items clients left for the host)
 *   client  a client asking for a pipe to the host
 *           → { t: 'client', v, ticket }             ← { t: 'open' } | { t: 'error', code }
 *   pipe    the host's end of one client's pipe
 *           → { t: 'pipe', v, secret, pipe }         ← { t: 'open' } | { t: 'error', code }
 *   drop    a client leaving one sealed item for a host that is offline
 *           → { t: 'drop', v, ticket, item }         ← { t: 'stored' } | { t: 'error', code }
 *
 * After `open`, binary messages on a client socket and its pipe socket are passed to the
 * other side unchanged. The text message `ping` is answered with `pong` on every socket.
 *
 * One HTTP route: `GET /v1/rendezvous/<code>` answers `{ mailbox, ticket }` while the code
 * is live, so a device that was typed `K7Q2-ABCD-EFGH` finds the host; 404 otherwise.
 */
export const RELAY_PROTOCOL = 1

export type SocketKind = 'host' | 'client' | 'pipe' | 'drop'
export const SOCKET_KINDS: readonly SocketKind[] = ['host', 'client', 'pipe', 'drop']

/** A mailbox id: random, base64url, 128 bits or more. */
export const MAILBOX_PATTERN = /^[A-Za-z0-9_-]{22,64}$/
/** Tickets and secrets are hashed with SHA-256 and sent as lowercase hex. */
export const HASH_PATTERN = /^[0-9a-f]{64}$/
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/
const PIPE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
const GITHUB_TOKEN_PATTERN = /^[A-Za-z0-9_.-]{20,255}$/
/** An APNs device token, as hex. */
const PUSH_TOKEN_PATTERN = /^[0-9a-f]{32,200}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

/** The pairing code's alphabet: Crockford base32 without the letters people misread. */
export const RENDEZVOUS_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const RENDEZVOUS_LENGTH = 4
export const RENDEZVOUS_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}$/
/** How long a rendezvous code finds its mailbox: as long as a pairing code lives. */
export const RENDEZVOUS_TTL_MS = 5 * 60_000

/** The largest single WebSocket message the relay takes; senders split frames to fit. */
export const MAX_MESSAGE_BYTES = 1024 * 1024
/** Open pipes per mailbox, counting ones still waiting for the host. */
export const MAX_PIPES = 8
/** Tickets a host may register: its paired clients plus one pairing ticket. */
export const MAX_TICKETS = 64

/** Mailboxes one GitHub account may own. */
export const MAX_MAILBOXES_PER_ACCOUNT = 5
/** A mailbox whose host has not connected this long is deleted, with its queue. */
export const MAILBOX_IDLE_MS = 30 * 24 * 60 * 60_000

/** One sealed item, base64url: a message a client wrote while the host was away. */
export const MAX_ITEM_CHARS = 64 * 1024
/** Items one ticket may leave, and items a mailbox holds in all. */
export const MAX_ITEMS_PER_TICKET = 50
export const MAX_ITEMS_PER_MAILBOX = 200
/** Queued items older than this are dropped unread. */
export const ITEM_TTL_MS = 7 * 24 * 60 * 60_000
/** `queued` messages are split to stay under this many characters. */
export const QUEUED_BATCH_CHARS = 768 * 1024

/** A sealed notification, base64url; APNs takes 4 KB in all. */
export const MAX_PUSH_PAYLOAD_CHARS = 2048
/** Notifications one mailbox may send per hour. */
export const MAX_PUSHES_PER_HOUR = 60

/*
 * Cost limits. On Cloudflare every new socket is a billed request and every message wakes
 * the mailbox's Durable Object, which bills by the time it stays awake, so a broken or
 * hostile peer must not be able to keep one busy forever. Legitimate use stays far below.
 */
/** Open sockets per mailbox, of every kind. */
export const MAX_SOCKETS = 32
/** A socket that has not sent its hello this long after connecting is closed. */
export const HELLO_TIMEOUT_MS = 10_000
/** New sockets a mailbox accepts per minute. */
export const MAX_CONNECTIONS_PER_MINUTE = 60
/**
 * Messages a mailbox takes per minute, from all its sockets together. A 32 MiB snapshot is
 * 128 messages of 256 KiB, so this leaves room for several at once.
 */
export const MAX_MESSAGES_PER_MINUTE = 3_000

export type ErrorCode =
  /** The hello did not parse, or did not match the socket's kind. */
  | 'bad_request'
  /** A wrong secret or ticket. */
  | 'denied'
  /** The host is not connected. */
  | 'offline'
  /** Too many pipes for this mailbox. */
  | 'busy'
  /** The pipe the host asked for no longer waits. */
  | 'gone'
  /** A newer host connection for the same mailbox took over. */
  | 'replaced'
  /** The peer speaks a relay protocol this relay does not. */
  | 'version'
  /** The mailbox sent more messages than the relay takes per minute. */
  | 'limited'
  /** A new mailbox needs a GitHub sign-in, and none was given or it did not check out. */
  | 'login'
  /** The GitHub account already owns as many mailboxes as it may. */
  | 'quota'
  /** The mailbox's queue is full. */
  | 'full'

export type Hello =
  | { t: 'host'; v: number; secret: string; github: string | null }
  | { t: 'client'; v: number; ticket: string }
  | { t: 'pipe'; v: number; secret: string; pipe: string }
  | { t: 'drop'; v: number; ticket: string; item: string }

export type HostMessage =
  | { t: 'tickets'; hashes: string[] }
  | { t: 'rendezvous'; ticket: string }
  | { t: 'ack'; ids: string[] }
  | { t: 'push'; token: string; sandbox: boolean; payload: string }

/** An item a client left, as the host receives it. `from` is the hash of the ticket used. */
export type QueuedItem = { id: string; from: string; at: number; item: string }

export type Route =
  | { kind: SocketKind; mailbox: string }
  | { kind: 'rendezvous'; code: string }

/** Parses `/v1/<kind>/<mailbox>` or `/v1/rendezvous/<code>`; null for anything else. */
export function routeOf(path: string): Route | null {
  const match = /^\/v1\/([a-z]+)\/([^/?#]+)$/.exec(path)
  if (!match) return null
  if (match[1] === 'rendezvous')
    return RENDEZVOUS_PATTERN.test(match[2]) ? { kind: 'rendezvous', code: match[2] } : null
  const kind = SOCKET_KINDS.find((k) => k === match[1])
  if (!kind || !MAILBOX_PATTERN.test(match[2])) return null
  return { kind, mailbox: match[2] }
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function token(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

/** Checks a socket's first message against the kind its URL named. */
export function parseHello(kind: SocketKind, value: unknown): Hello | 'version' | null {
  if (!isObject(value) || value.t !== kind) return null
  if (value.v !== RELAY_PROTOCOL) return typeof value.v === 'number' ? 'version' : null
  if (kind === 'host') {
    if (!token(value.secret)) return null
    const github = value.github ?? null
    if (github !== null && !(typeof github === 'string' && GITHUB_TOKEN_PATTERN.test(github)))
      return null
    return { t: 'host', v: RELAY_PROTOCOL, secret: value.secret, github }
  }
  if (kind === 'client')
    return token(value.ticket) ? { t: 'client', v: RELAY_PROTOCOL, ticket: value.ticket } : null
  if (kind === 'drop')
    return token(value.ticket) &&
      typeof value.item === 'string' &&
      value.item.length <= MAX_ITEM_CHARS &&
      BASE64URL_PATTERN.test(value.item)
      ? { t: 'drop', v: RELAY_PROTOCOL, ticket: value.ticket, item: value.item }
      : null
  return token(value.secret) && typeof value.pipe === 'string' && PIPE_PATTERN.test(value.pipe)
    ? { t: 'pipe', v: RELAY_PROTOCOL, secret: value.secret, pipe: value.pipe }
    : null
}

export function parseHostMessage(value: unknown): HostMessage | null {
  if (!isObject(value)) return null
  if (value.t === 'tickets') {
    if (!Array.isArray(value.hashes) || value.hashes.length > MAX_TICKETS) return null
    const hashes = value.hashes
    if (!hashes.every((hash) => typeof hash === 'string' && HASH_PATTERN.test(hash))) return null
    return { t: 'tickets', hashes: [...new Set(hashes as string[])].sort() }
  }
  if (value.t === 'rendezvous')
    return token(value.ticket) ? { t: 'rendezvous', ticket: value.ticket } : null
  if (value.t === 'ack') {
    if (!Array.isArray(value.ids) || value.ids.length > MAX_ITEMS_PER_MAILBOX) return null
    if (!value.ids.every((id) => typeof id === 'string' && PIPE_PATTERN.test(id))) return null
    return { t: 'ack', ids: value.ids as string[] }
  }
  if (value.t === 'push')
    return typeof value.token === 'string' &&
      PUSH_TOKEN_PATTERN.test(value.token) &&
      typeof value.sandbox === 'boolean' &&
      typeof value.payload === 'string' &&
      value.payload.length <= MAX_PUSH_PAYLOAD_CHARS &&
      BASE64URL_PATTERN.test(value.payload)
      ? { t: 'push', token: value.token, sandbox: value.sandbox, payload: value.payload }
      : null
  return null
}

/** SHA-256 as lowercase hex, with Web Crypto so Node and Workers share it. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A random rendezvous code from the pairing alphabet. */
export function randomRendezvousCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RENDEZVOUS_LENGTH))
  return [...bytes].map((byte) => RENDEZVOUS_ALPHABET[byte % RENDEZVOUS_ALPHABET.length]).join('')
}

/** WebSocket close codes the relay uses; 4000–4999 are free for applications. */
export const CLOSE = {
  normal: 1000,
  tooBig: 1009,
  error: 4000
} as const
