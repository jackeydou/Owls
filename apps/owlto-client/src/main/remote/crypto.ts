import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  randomInt,
  scrypt
} from 'node:crypto'
import { PAIRING_ALPHABET, PAIRING_CODE_LENGTH } from '../../shared/remote.js'

/**
 * The cryptography of Remote Router, on Node's built-in `crypto` only: X25519 for key
 * agreement, HKDF-SHA256 for keys, and AES-256-GCM for frames. A transport (TCP
 * now, a relay later) only ever carries what this module sealed.
 */

/** A long-term X25519 key pair; the public half is the device's remote identity. */
export type KeyPair = { privateKey: KeyObject; publicKey: string }

export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  return { privateKey, publicKey: rawPublicKey(publicKey) }
}
/** The 32-byte public key as base64url, the form peers store and compare. */
function rawPublicKey(key: KeyObject): string {
  const jwk = key.export({ format: 'jwk' })
  if (typeof jwk.x !== 'string') throw new Error('Not an X25519 key.')
  return jwk.x
}
export function exportPrivateKey(key: KeyObject): string {
  return key.export({ format: 'der', type: 'pkcs8' }).toString('base64')
}
export function importKeyPair(privateDer: string): KeyPair {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateDer, 'base64'),
    format: 'der',
    type: 'pkcs8'
  })
  return { privateKey, publicKey: rawPublicKey(createPublicKey(privateKey)) }
}
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/
export function isPublicKey(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_KEY.test(value)
}
function publicKeyObject(raw: string): KeyObject {
  return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: raw }, format: 'jwk' })
}
export function dh(privateKey: KeyObject, publicKey: string): Buffer {
  return diffieHellman({ privateKey, publicKey: publicKeyObject(publicKey) })
}

export function sha256(...parts: Buffer[]): Buffer {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest()
}

/** A random pairing code from `PAIRING_ALPHABET`, uniform over the alphabet. */
export function newPairingCode(): string {
  let code = ''
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++)
    code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]
  return code
}
/**
 * Stretches a pairing code into key material bound to one handshake. The cost makes
 * an offline guess at a captured handshake take far longer than the code lives.
 */
export function pairingSecret(code: string, transcript: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      code,
      transcript,
      32,
      { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key))
    )
  )
}

const KEY_INFO = Buffer.from('owlto-remote-v1 keys')
/** One key per direction: the initiator sends with `initiator`, the responder with `responder`. */
export function sessionKeys(
  secrets: Buffer[],
  transcript: Buffer
): { initiator: Buffer; responder: Buffer } {
  const okm = Buffer.from(hkdfSync('sha256', Buffer.concat(secrets), transcript, KEY_INFO, 64))
  return { initiator: okm.subarray(0, 32), responder: okm.subarray(32, 64) }
}

const TAG_BYTES = 16
/**
 * AES-256-GCM, not ChaCha20-Poly1305: Electron's Node runs on BoringSSL, whose `createCipheriv`
 * does not offer `chacha20-poly1305`, though plain Node (and so the tests) does.
 */
const FRAME_CIPHER = 'aes-256-gcm'
/**
 * Seals and opens frames for one direction. The nonce is a counter, so a dropped,
 * replayed, or reordered frame fails to open, and the connection closes.
 */
export class FrameCipher {
  private counter = 0n
  constructor(private readonly key: Buffer) {}
  private nonce(): Buffer {
    const nonce = Buffer.alloc(12)
    nonce.writeBigUInt64BE(this.counter, 4)
    this.counter++
    return nonce
  }
  seal(plain: Buffer): Buffer {
    const cipher = createCipheriv(FRAME_CIPHER, this.key, this.nonce(), {
      authTagLength: TAG_BYTES
    })
    const body = Buffer.concat([cipher.update(plain), cipher.final()])
    return Buffer.concat([body, cipher.getAuthTag()])
  }
  /** Throws when the frame was not sealed by the peer's matching cipher. */
  open(sealed: Buffer): Buffer {
    if (sealed.length < TAG_BYTES) throw new Error('Frame too short.')
    const decipher = createDecipheriv(FRAME_CIPHER, this.key, this.nonce(), {
      authTagLength: TAG_BYTES
    })
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES))
    return Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
      decipher.final()
    ])
  }
}
