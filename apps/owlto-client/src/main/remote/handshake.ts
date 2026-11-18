import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { deviceIdSchema } from '../../shared/app.js'
import { REMOTE_PROTOCOL } from '../../shared/remote.js'
import {
  dh,
  FrameCipher,
  generateKeyPair,
  isPublicKey,
  type KeyPair,
  pairingSecret,
  sessionKeys,
  sha256
} from './crypto.js'
import type { FrameChannel } from './frames.js'

/**
 * The handshake that opens every connection, before any content. Both sides prove they
 * hold their long-term X25519 key and agree on fresh session keys:
 *
 *   initiator → hs1 { mode, deviceId, publicKey, ephemeral }
 *   responder → hs2 { deviceId, publicKey, ephemeral }       (or reject { reason })
 *   keys = HKDF(DH(e_i, e_r) ‖ DH(s_i, e_r) ‖ DH(e_i, s_r) ‖ pairing secret, hash(hs1 ‖ hs2))
 *   initiator → sealed hello { name }, responder → sealed welcome { name }
 *
 * Only a holder of a static private key can compute its DH term, so opening `hello` and
 * `welcome` authenticates both sides; the ephemeral terms give forward secrecy. When
 * pairing, the peers do not know each other's keys yet; the code the user typed is
 * stretched into the pairing secret, so a man in the middle without it cannot derive the keys.
 */

export type RejectReason =
  /** The responder does not know this device, or its key changed. */
  | 'unknown_device'
  /** The responder is not waiting for a device to pair. */
  | 'not_pairing'
  /** The keys did not match: a wrong pairing code, or someone in the middle. */
  | 'auth_failed'
  /** The peer speaks a protocol version this build does not. */
  | 'protocol'
export class HandshakeError extends Error {
  constructor(
    readonly reason: RejectReason | 'identity_changed' | 'closed' | 'timeout' | 'malformed',
    message = reason
  ) {
    super(message)
  }
}

const helloSchema = z.object({
  protocol: z.number().int(),
  deviceId: deviceIdSchema,
  publicKey: z.string().refine(isPublicKey),
  ephemeral: z.string().refine(isPublicKey)
})
const hs1Schema = helloSchema.extend({ t: z.literal('hs1'), mode: z.enum(['auth', 'pair']) })
const hs2Schema = z.discriminatedUnion('t', [
  helloSchema.extend({ t: z.literal('hs2') }),
  z.object({
    t: z.literal('reject'),
    reason: z.enum(['unknown_device', 'not_pairing', 'auth_failed', 'protocol'])
  })
])
const nameSchema = z.object({
  t: z.enum(['hello', 'welcome']),
  name: z.string().trim().min(1).max(120),
  appVersion: z.string().max(64)
})

export type Peer = { deviceId: string; name: string; publicKey: string; appVersion: string }
export type Me = { deviceId: string; name: string; appVersion: string; identity: KeyPair }

/** JSON messages over a channel whose frames are sealed with the session keys. */
export class SecureChannel {
  private listener: ((message: unknown) => void) | null = null
  constructor(
    private readonly frames: FrameChannel,
    private readonly sender: FrameCipher,
    private readonly receiver: FrameCipher
  ) {
    frames.onFrame((frame) => {
      let message: unknown
      try {
        message = JSON.parse(this.receiver.open(frame).toString('utf8'))
      } catch {
        // A frame that does not open means tampering or a lost frame: nothing after it can be trusted.
        frames.close()
        return
      }
      this.listener?.(message)
    })
  }
  send(message: unknown): void {
    this.frames.send(this.sender.seal(Buffer.from(JSON.stringify(message), 'utf8')))
  }
  onMessage(listener: (message: unknown) => void): void {
    this.listener = listener
  }
  onClose(listener: (error: Error | null) => void): void {
    this.frames.onClose(listener)
  }
  close(): void {
    this.frames.close()
  }
}

/** Reads frames one at a time during the handshake, failing on close or timeout. */
function frameReader(channel: FrameChannel, timeoutMs: number) {
  const queue: Buffer[] = []
  let waiting: { resolve(frame: Buffer): void; reject(error: Error): void } | null = null
  let failure: Error | null = null
  const timer = setTimeout(() => {
    failure = new HandshakeError('timeout')
    waiting?.reject(failure)
    channel.close()
  }, timeoutMs)
  channel.onFrame((frame) => {
    if (waiting) {
      const pending = waiting
      waiting = null
      pending.resolve(frame)
    } else queue.push(frame)
  })
  channel.onClose(() => {
    failure ??= new HandshakeError('closed')
    clearTimeout(timer)
    waiting?.reject(failure)
  })
  return {
    next(): Promise<Buffer> {
      const frame = queue.shift()
      if (frame) return Promise.resolve(frame)
      if (failure) return Promise.reject(failure)
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject }
      })
    },
    done(): void {
      clearTimeout(timer)
    }
  }
}
function parse<T>(schema: z.ZodType<T>, frame: Buffer): T {
  try {
    return schema.parse(JSON.parse(frame.toString('utf8')))
  } catch {
    throw new HandshakeError('malformed')
  }
}
function encode(message: unknown): Buffer {
  return Buffer.from(JSON.stringify(message), 'utf8')
}

const HANDSHAKE_TIMEOUT_MS = 15_000

export type InitiatorMode =
  | { kind: 'auth'; deviceId: string; publicKey: string }
  | { kind: 'pair'; code: string }

/** Opens a connection as the side that dialed. Resolves with the channel and who answered. */
export async function initiate(
  frames: FrameChannel,
  me: Me,
  mode: InitiatorMode
): Promise<{ channel: SecureChannel; peer: Peer }> {
  const reader = frameReader(frames, HANDSHAKE_TIMEOUT_MS)
  try {
    const ephemeral = generateKeyPair()
    const hs1 = encode({
      t: 'hs1',
      protocol: REMOTE_PROTOCOL,
      mode: mode.kind,
      deviceId: me.deviceId,
      publicKey: me.identity.publicKey,
      ephemeral: ephemeral.publicKey
    })
    frames.send(hs1)
    const hs2Frame = await reader.next()
    const hs2 = parse(hs2Schema, hs2Frame)
    if (hs2.t === 'reject') throw new HandshakeError(hs2.reason)
    if (hs2.protocol !== REMOTE_PROTOCOL) throw new HandshakeError('protocol')
    if (
      mode.kind === 'auth' &&
      (hs2.deviceId !== mode.deviceId || hs2.publicKey !== mode.publicKey)
    )
      throw new HandshakeError('identity_changed')
    const transcript = sha256(hs1, hs2Frame)
    const secrets = [
      dh(ephemeral.privateKey, hs2.ephemeral),
      dh(me.identity.privateKey, hs2.ephemeral),
      dh(ephemeral.privateKey, hs2.publicKey)
    ]
    if (mode.kind === 'pair') secrets.push(await pairingSecret(mode.code, transcript))
    const keys = sessionKeys(secrets, transcript)
    const sender = new FrameCipher(keys.initiator)
    const receiver = new FrameCipher(keys.responder)
    frames.send(
      sender.seal(encode({ t: 'hello', name: me.name, appVersion: me.appVersion, nonce: nonce() }))
    )
    const reply = await reader.next()
    let welcome: z.infer<typeof nameSchema>
    try {
      welcome = nameSchema.parse(JSON.parse(receiver.open(reply).toString('utf8')))
    } catch {
      // A plain-text reject arrives when the responder could not open our hello.
      const rejected = hs2Schema.safeParse(safeJson(reply))
      throw new HandshakeError(
        rejected.success && rejected.data.t === 'reject' ? rejected.data.reason : 'auth_failed'
      )
    }
    if (welcome.t !== 'welcome') throw new HandshakeError('malformed')
    reader.done()
    return {
      channel: new SecureChannel(frames, sender, receiver),
      peer: {
        deviceId: hs2.deviceId,
        name: welcome.name,
        publicKey: hs2.publicKey,
        appVersion: welcome.appVersion
      }
    }
  } catch (error) {
    reader.done()
    frames.close()
    throw error
  }
}

export type ResponderPolicy = {
  /** The stored public key of a paired device; null for a device this side does not know. */
  knownKey(deviceId: string): string | null
  /** The active pairing code; null when not pairing. */
  pairingCode(): string | null
  /** A pairing attempt failed to prove the code. */
  pairingFailed(): void
}

/** Answers a connection as the side that listened. */
export async function respond(
  frames: FrameChannel,
  me: Me,
  policy: ResponderPolicy
): Promise<{ channel: SecureChannel; peer: Peer; paired: boolean }> {
  const reader = frameReader(frames, HANDSHAKE_TIMEOUT_MS)
  const reject = (reason: RejectReason) => {
    frames.send(encode({ t: 'reject', reason }))
    frames.close()
    return new HandshakeError(reason)
  }
  try {
    const hs1Frame = await reader.next()
    const hs1 = parse(hs1Schema, hs1Frame)
    if (hs1.protocol !== REMOTE_PROTOCOL) throw reject('protocol')
    const pairing = hs1.mode === 'pair'
    const code = pairing ? policy.pairingCode() : null
    if (pairing && !code) throw reject('not_pairing')
    if (!pairing && policy.knownKey(hs1.deviceId) !== hs1.publicKey) throw reject('unknown_device')
    const ephemeral = generateKeyPair()
    const hs2 = encode({
      t: 'hs2',
      protocol: REMOTE_PROTOCOL,
      deviceId: me.deviceId,
      publicKey: me.identity.publicKey,
      ephemeral: ephemeral.publicKey
    })
    frames.send(hs2)
    const transcript = sha256(hs1Frame, hs2)
    const secrets = [
      dh(ephemeral.privateKey, hs1.ephemeral),
      dh(ephemeral.privateKey, hs1.publicKey),
      dh(me.identity.privateKey, hs1.ephemeral)
    ]
    if (code) secrets.push(await pairingSecret(code, transcript))
    const keys = sessionKeys(secrets, transcript)
    const sender = new FrameCipher(keys.responder)
    const receiver = new FrameCipher(keys.initiator)
    let hello: z.infer<typeof nameSchema>
    try {
      hello = nameSchema.parse(JSON.parse(receiver.open(await reader.next()).toString('utf8')))
    } catch (error) {
      if (error instanceof HandshakeError) throw error
      if (pairing) policy.pairingFailed()
      throw reject('auth_failed')
    }
    if (hello.t !== 'hello') throw reject('auth_failed')
    frames.send(
      sender.seal(
        encode({ t: 'welcome', name: me.name, appVersion: me.appVersion, nonce: nonce() })
      )
    )
    reader.done()
    return {
      channel: new SecureChannel(frames, sender, receiver),
      peer: {
        deviceId: hs1.deviceId,
        name: hello.name,
        publicKey: hs1.publicKey,
        appVersion: hello.appVersion
      },
      paired: pairing
    }
  } catch (error) {
    reader.done()
    frames.close()
    throw error
  }
}

/** Random padding-free filler, so two hellos with the same name never seal to related text. */
function nonce(): string {
  return randomBytes(8).toString('hex')
}
function safeJson(frame: Buffer): unknown {
  try {
    return JSON.parse(frame.toString('utf8'))
  } catch {
    return null
  }
}
