import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { deviceIdSchema } from '../../shared/app.js'
import { dh, generateKeyPair, isPublicKey, type KeyPair, sha256 } from './crypto.js'

/**
 * Messages sealed for one reader, outside a live connection:
 *
 * - Queue items: a client seals a message to the host's long-term key and leaves it on the
 *   relay while the host is away. The key comes from DH(ephemeral, host) and
 *   DH(client, host), so only the host can open it and only the paired client could have
 *   sealed it; the relay sees neither who wrote it nor what it says beyond the device id.
 *
 *     item = base64url(JSON { v: 1, from, eph, box })
 *     key  = HKDF-SHA256(DH(e, H) ‖ DH(C, H), salt = SHA-256(from ‖ eph ‖ H), "owlto-queue-v1")
 *     box  = base64url(nonce ‖ AES-256-GCM(key, nonce, plain, aad = from))
 *
 * - Notifications: the host seals a push for a phone with the 32-byte key the phone gave it,
 *   so APNs and the relay carry only ciphertext: base64url(nonce ‖ AES-256-GCM(key, plain)).
 */

const CIPHER = 'aes-256-gcm'
const NONCE_BYTES = 12
const TAG_BYTES = 16
const QUEUE_INFO = Buffer.from('owlto-queue-v1', 'utf8')

function seal(key: Buffer, plain: Buffer, aad: Buffer | null): Buffer {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(CIPHER, key, nonce, { authTagLength: TAG_BYTES })
  if (aad) cipher.setAAD(aad)
  return Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()])
}
function open(key: Buffer, sealed: Buffer, aad: Buffer | null): Buffer {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) throw new Error('Sealed message too short.')
  const decipher = createDecipheriv(CIPHER, key, sealed.subarray(0, NONCE_BYTES), {
    authTagLength: TAG_BYTES
  })
  if (aad) decipher.setAAD(aad)
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES))
  return Buffer.concat([
    decipher.update(sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES)),
    decipher.final()
  ])
}

function queueKey(secrets: Buffer[], from: string, eph: string, host: string): Buffer {
  const salt = sha256(Buffer.from(from, 'utf8'), Buffer.from(eph, 'utf8'), Buffer.from(host))
  return Buffer.from(hkdfSync('sha256', Buffer.concat(secrets), salt, QUEUE_INFO, 32))
}

/** What a client may leave on the relay: a message for an existing thread. */
export const queuedMessageSchema = z.object({
  seq: z.number().int().positive(),
  /** When the client wrote it, in ms; the host drops anything older than the relay keeps. */
  at: z.number().int().nonnegative(),
  method: z.literal('sendRouter'),
  params: z.unknown()
})
export type QueuedMessage = z.infer<typeof queuedMessageSchema>

const envelopeSchema = z.object({
  v: z.literal(1),
  from: deviceIdSchema,
  eph: z.string().refine(isPublicKey),
  box: z.string().regex(/^[A-Za-z0-9_-]+$/)
})

/** Seals a message from this client to a host's public key, as a relay queue item. */
export function sealForHost(
  message: QueuedMessage,
  me: { deviceId: string; identity: KeyPair },
  hostKey: string
): string {
  const ephemeral = generateKeyPair()
  const key = queueKey(
    [dh(ephemeral.privateKey, hostKey), dh(me.identity.privateKey, hostKey)],
    me.deviceId,
    ephemeral.publicKey,
    hostKey
  )
  const box = seal(key, Buffer.from(JSON.stringify(message), 'utf8'), Buffer.from(me.deviceId))
  const envelope = {
    v: 1,
    from: me.deviceId,
    eph: ephemeral.publicKey,
    box: box.toString('base64url')
  }
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')
}

/**
 * Opens a queue item on the host. `clientKey` finds the sender's stored public key; an item
 * from an unknown device, or one that does not open, returns null.
 */
export function openFromClient(
  item: string,
  identity: KeyPair,
  clientKey: (deviceId: string) => string | null
): { from: string; message: QueuedMessage } | null {
  try {
    const envelope = envelopeSchema.parse(
      JSON.parse(Buffer.from(item, 'base64url').toString('utf8'))
    )
    const sender = clientKey(envelope.from)
    if (!sender) return null
    const key = queueKey(
      [dh(identity.privateKey, envelope.eph), dh(identity.privateKey, sender)],
      envelope.from,
      envelope.eph,
      identity.publicKey
    )
    const plain = open(key, Buffer.from(envelope.box, 'base64url'), Buffer.from(envelope.from))
    const message = queuedMessageSchema.parse(JSON.parse(plain.toString('utf8')))
    return { from: envelope.from, message }
  } catch {
    return null
  }
}

/** A notification as the phone's extension opens it. */
export type PushMessage = {
  title: string
  subtitle: string
  body: string
  routerId: string | null
  workerId: string | null
}
export function sealPush(message: PushMessage, key: Buffer): string {
  return seal(key, Buffer.from(JSON.stringify(message), 'utf8'), null).toString('base64url')
}
export function openPush(payload: string, key: Buffer): PushMessage {
  return JSON.parse(open(key, Buffer.from(payload, 'base64url'), null).toString('utf8'))
}
