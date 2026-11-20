import { MAILBOX_PATTERN, MAX_MAILBOXES_PER_ACCOUNT, sha256Hex } from './protocol.ts'

/**
 * Relay accounts. A Mac signs in once with GitHub (through Owlto's own no-scope OAuth app, so
 * the token can only read a public profile); the relay checks who it is, throws the GitHub
 * token away, and hands back a session of its own:
 *
 *   s1.<account>.<random>      account = sha256("github:" + GitHub user id), hex
 *
 * The account part routes the session to its account record without a lookup; only a SHA-256
 * of the whole session is stored. A host presents its session on every connect, so signing
 * out, revoking a session, or removing a Mac on the account cuts that Mac off at once.
 *
 * HTTP, all JSON:
 *   POST   /v1/account/login            { github, name }  → { session, login }
 *   GET    /v1/account                  (Bearer session)  → { login, mailboxes: [{ mailbox, name,
 *                                                        claimedAt, thisMac, online, lastHostAt }] }
 *   DELETE /v1/account/session          (Bearer session)  → {}   (sign out this Mac)
 *   DELETE /v1/account/mailbox/<id>     (Bearer session)  → {}   (remove a Mac and its session)
 */

export const SESSION_PATTERN = /^s1\.[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/
/** Sessions one account may hold: a few Macs, each signed in again now and then. */
export const MAX_SESSIONS_PER_ACCOUNT = 20
/** A session nobody used this long stops working. */
export const SESSION_IDLE_MS = 180 * 24 * 60 * 60_000
/** `lastUsedAt` is written at most this often, so a reconnecting host costs no write. */
const TOUCH_EVERY_MS = 24 * 60 * 60_000
const GITHUB_TOKEN_PATTERN = /^[A-Za-z0-9_.-]{20,255}$/

export type SessionRecord = { hash: string; name: string; createdAt: number; lastUsedAt: number }
export type OwnedMailbox = { mailbox: string; session: string; claimedAt: number }
export type AccountInfo = { login: string; mailboxes: (OwnedMailbox & { name: string | null })[] }
export type AccountRecord = {
  login: string
  sessions: SessionRecord[]
  mailboxes: OwnedMailbox[]
}

/** The account a session belongs to, from its own text; null for anything malformed. */
export function accountOfSession(session: string): string | null {
  return SESSION_PATTERN.test(session) ? session.split('.')[1] : null
}

export type AccountIO = {
  load(): Promise<AccountRecord | null>
  save(record: AccountRecord): Promise<void>
  deleteAll(): Promise<void>
  now(): number
  /** 32 random bytes, base64url. */
  randomToken(): string
}

/** One account's record and the rules on it. A Durable Object, or a map entry on Node. */
export class AccountBook {
  private readonly io: AccountIO

  constructor(io: AccountIO) {
    this.io = io
  }

  async createSession(account: string, login: string, name: string): Promise<string> {
    const session = `s1.${account}.${this.io.randomToken()}`
    const now = this.io.now()
    const record = (await this.io.load()) ?? { login, sessions: [], mailboxes: [] }
    const sessions = this.live(record.sessions)
    // The oldest session goes when an account signs in more often than it signs out.
    while (sessions.length >= MAX_SESSIONS_PER_ACCOUNT) sessions.shift()
    sessions.push({ hash: await sha256Hex(session), name, createdAt: now, lastUsedAt: now })
    // Mailboxes stay with the account across sessions; a host only needs a live session.
    await this.io.save({ login, sessions, mailboxes: record.mailboxes })
    return session
  }

  /** The stored hash of a live session, or null. */
  async check(session: string): Promise<string | null> {
    const record = await this.io.load()
    if (!record) return null
    const hash = await sha256Hex(session)
    const found = this.live(record.sessions).find((entry) => entry.hash === hash)
    if (!found) return null
    const now = this.io.now()
    if (now - found.lastUsedAt > TOUCH_EVERY_MS) {
      found.lastUsedAt = now
      await this.io.save(record)
    }
    return hash
  }

  /**
   * Records that the Mac signed in with `session` holds `mailbox`; false when the account
   * already holds as many mailboxes as it may. Claiming again moves it to the new session.
   */
  async claim(session: string, mailbox: string): Promise<boolean> {
    const record = await this.io.load()
    if (!record) return false
    const held = record.mailboxes.find((entry) => entry.mailbox === mailbox)
    if (held) {
      if (held.session === session) return true
      held.session = session
    } else {
      if (record.mailboxes.length >= MAX_MAILBOXES_PER_ACCOUNT) return false
      record.mailboxes.push({ mailbox, session, claimedAt: this.io.now() })
      record.mailboxes.sort((a, b) => a.mailbox.localeCompare(b.mailbox))
    }
    await this.io.save(record)
    return true
  }

  async release(mailbox: string): Promise<void> {
    const record = await this.io.load()
    if (!record) return
    const mailboxes = record.mailboxes.filter((entry) => entry.mailbox !== mailbox)
    if (mailboxes.length === record.mailboxes.length) return
    await this.io.save({ ...record, mailboxes })
  }

  /** Ends a session; returns the mailboxes it held, whose hosts the caller disconnects. */
  async revoke(session: string): Promise<string[]> {
    return this.revokeHash(await sha256Hex(session))
  }

  /** Ends the session stored under `hash`, as `revoke` does. */
  async revokeHash(hash: string): Promise<string[]> {
    const record = await this.io.load()
    if (!record) return []
    const sessions = record.sessions.filter((entry) => entry.hash !== hash)
    const held = record.mailboxes.filter((entry) => entry.session === hash).map((e) => e.mailbox)
    if (!sessions.length && !record.mailboxes.length) await this.io.deleteAll()
    else await this.io.save({ ...record, sessions })
    return held
  }

  /** The account's login and mailboxes, each with the name of the Mac whose session holds it. */
  async info(): Promise<AccountInfo | null> {
    const record = await this.io.load()
    if (!record) return null
    const names = new Map(this.live(record.sessions).map((entry) => [entry.hash, entry.name]))
    return {
      login: record.login,
      mailboxes: record.mailboxes.map((entry) => ({
        ...entry,
        name: names.get(entry.session) ?? null
      }))
    }
  }

  private live(sessions: SessionRecord[]): SessionRecord[] {
    const now = this.io.now()
    return sessions.filter((entry) => now - entry.lastUsedAt < SESSION_IDLE_MS)
  }
}

/** What the account routes need from their platform. */
export interface AccountServices {
  /** Asks GitHub who a token belongs to; null when it does not check out. */
  verifyGitHub(token: string): Promise<{ id: number; login: string } | null>
  /** The account record keyed by `account` (a hash). */
  account(account: string): {
    createSession(account: string, login: string, name: string): Promise<string>
    check(session: string): Promise<string | null>
    revoke(session: string): Promise<string[]>
    revokeHash(hash: string): Promise<string[]>
    release(mailbox: string): Promise<void>
    info(): Promise<AccountInfo | null>
  }
  /** A mailbox's room: whether its host is online, and ways to end it. */
  room(mailbox: string): {
    status(): Promise<{ online: boolean; lastHostAt: number } | null>
    /** Disconnects the host, which then has to sign in again. */
    evict(): Promise<void>
    /** Deletes the mailbox, its queue, and its sockets. */
    destroy(): Promise<void>
  }
}

export type AccountReply = { status: number; body: Record<string, unknown> }

const reply = (status: number, body: Record<string, unknown>): AccountReply => ({ status, body })

/**
 * Answers `/v1/account…`. `path` is everything after `/v1/account`, `auth` the
 * Authorization header, `body` the parsed JSON body (or null).
 */
export async function answerAccount(
  method: string,
  path: string,
  auth: string | null,
  body: unknown,
  services: AccountServices
): Promise<AccountReply> {
  if (method === 'POST' && path === '/login') {
    const input = body as { github?: unknown; name?: unknown } | null
    const github = input?.github
    if (typeof github !== 'string' || !GITHUB_TOKEN_PATTERN.test(github))
      return reply(400, { error: 'bad_request' })
    const name = typeof input?.name === 'string' ? input.name.slice(0, 120) : ''
    const user = await services.verifyGitHub(github)
    if (!user) return reply(401, { error: 'login' })
    const account = await sha256Hex(`github:${user.id}`)
    const session = await services.account(account).createSession(account, user.login, name)
    return reply(200, { session, login: user.login })
  }
  const session = /^Bearer (\S+)$/.exec(auth ?? '')?.[1] ?? ''
  const account = accountOfSession(session)
  if (!account) return reply(401, { error: 'login' })
  const book = services.account(account)
  const hash = await book.check(session)
  if (!hash) return reply(401, { error: 'login' })

  if (method === 'GET' && path === '') {
    const info = await book.info()
    if (!info) return reply(401, { error: 'login' })
    const mailboxes = await Promise.all(
      info.mailboxes.map(async (entry) => {
        const status = await services.room(entry.mailbox).status()
        return {
          mailbox: entry.mailbox,
          name: entry.name,
          claimedAt: entry.claimedAt,
          thisMac: entry.session === hash,
          online: status?.online ?? false,
          lastHostAt: status?.lastHostAt ?? null
        }
      })
    )
    return reply(200, { login: info.login, mailboxes })
  }
  if (method === 'DELETE' && path === '/session') {
    for (const mailbox of await book.revoke(session)) await services.room(mailbox).evict()
    return reply(200, {})
  }
  const removing = /^\/mailbox\/([^/]+)$/.exec(path)?.[1]
  if (method === 'DELETE' && removing) {
    if (!MAILBOX_PATTERN.test(removing)) return reply(400, { error: 'bad_request' })
    const info = await book.info()
    const entry = info?.mailboxes.find((owned) => owned.mailbox === removing)
    if (!entry) return reply(404, { error: 'not_found' })
    await services.room(removing).destroy()
    await book.release(removing)
    // The removed Mac's session ends too, or its host would make the mailbox again on its
    // next connect. Removing this Mac's own mailbox signs it out.
    for (const mailbox of await book.revokeHash(entry.session))
      if (mailbox !== removing) await services.room(mailbox).evict()
    return reply(200, {})
  }
  return reply(404, { error: 'not_found' })
}
