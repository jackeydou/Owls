/**
 * The relay's own wire protocol. It is separate from Remote Router's end-to-end protocol
 * (`REMOTE_PROTOCOL` in the desktop app): the relay never reads the sealed frames it carries,
 * so an end-to-end change never needs a relay deploy.
 *
 * Three kinds of WebSocket, each at `/v1/<kind>/<mailbox>`:
 *
 *   host    a host Mac's control socket, kept open while it allows internet connections
 *           → { t: 'host', v, secret }                ← { t: 'ready' } | { t: 'error', code }
 *           → { t: 'tickets', hashes }                 (replaces the tickets that may connect)
 *           ← { t: 'incoming', pipe }                  (a client is waiting: open a pipe for it)
 *   client  a client asking for a pipe to the host
 *           → { t: 'client', v, ticket }               ← { t: 'open' } | { t: 'error', code }
 *   pipe    the host's end of one client's pipe
 *           → { t: 'pipe', v, secret, pipe }           ← { t: 'open' } | { t: 'error', code }
 *
 * After `open`, binary messages on a client socket and its pipe socket are passed to the
 * other side unchanged. The text message `ping` is answered with `pong` on every socket.
 */
export const RELAY_PROTOCOL = 1

export type SocketKind = 'host' | 'client' | 'pipe'
export const SOCKET_KINDS: readonly SocketKind[] = ['host', 'client', 'pipe']

/** A mailbox id: random, base64url, 128 bits or more. */
export const MAILBOX_PATTERN = /^[A-Za-z0-9_-]{22,64}$/
/** Tickets and secrets are hashed with SHA-256 and sent as lowercase hex. */
export const HASH_PATTERN = /^[0-9a-f]{64}$/
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/
const PIPE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

/** The largest single WebSocket message the relay takes; senders split frames to fit. */
export const MAX_MESSAGE_BYTES = 1024 * 1024
/** Open pipes per mailbox, counting ones still waiting for the host. */
export const MAX_PIPES = 8
/** Tickets a host may register: its paired clients plus one pairing ticket. */
export const MAX_TICKETS = 64

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

export type Hello =
  | { t: 'host'; v: number; secret: string }
  | { t: 'client'; v: number; ticket: string }
  | { t: 'pipe'; v: number; secret: string; pipe: string }

export type HostMessage = { t: 'tickets'; hashes: string[] }

/** Parses `/v1/<kind>/<mailbox>`; null for anything else. */
export function routeOf(path: string): { kind: SocketKind; mailbox: string } | null {
  const match = /^\/v1\/([a-z]+)\/([^/?#]+)$/.exec(path)
  if (!match) return null
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

/** Checks a socket's first message against the kind its URL named. */
export function parseHello(kind: SocketKind, value: unknown): Hello | 'version' | null {
  if (!isObject(value) || value.t !== kind) return null
  if (value.v !== RELAY_PROTOCOL) return typeof value.v === 'number' ? 'version' : null
  if (kind === 'host')
    return typeof value.secret === 'string' && TOKEN_PATTERN.test(value.secret)
      ? { t: 'host', v: RELAY_PROTOCOL, secret: value.secret }
      : null
  if (kind === 'client')
    return typeof value.ticket === 'string' && TOKEN_PATTERN.test(value.ticket)
      ? { t: 'client', v: RELAY_PROTOCOL, ticket: value.ticket }
      : null
  return typeof value.secret === 'string' &&
    TOKEN_PATTERN.test(value.secret) &&
    typeof value.pipe === 'string' &&
    PIPE_PATTERN.test(value.pipe)
    ? { t: 'pipe', v: RELAY_PROTOCOL, secret: value.secret, pipe: value.pipe }
    : null
}

export function parseHostMessage(value: unknown): HostMessage | null {
  if (!isObject(value) || value.t !== 'tickets' || !Array.isArray(value.hashes)) return null
  const hashes = value.hashes
  if (hashes.length > MAX_TICKETS) return null
  if (!hashes.every((hash) => typeof hash === 'string' && HASH_PATTERN.test(hash))) return null
  return { t: 'tickets', hashes: [...new Set(hashes as string[])].sort() }
}

/** SHA-256 as lowercase hex, with Web Crypto so Node and Workers share it. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** WebSocket close codes the relay uses; 4000–4999 are free for applications. */
export const CLOSE = {
  normal: 1000,
  tooBig: 1009,
  error: 4000
} as const
