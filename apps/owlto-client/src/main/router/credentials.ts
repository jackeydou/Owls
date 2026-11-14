import type { OwltoProviderId } from '../../shared/router.js'
import { OwltoError } from '../app/errors.js'
import type { RouterStore } from './store.js'

/** A decrypted secret, and whether it should be encrypted again with the current key. */
export type DecryptedSecret = { plain: string; stale: boolean }
/** The encryption the credential store needs; Electron's async safeStorage in the app. */
export type SecretCipher = {
  /** Resolves null when secrets can be stored, otherwise why not. */
  unavailable(): Promise<string | null>
  encrypt(plain: string): Promise<string>
  decrypt(encoded: string): Promise<DecryptedSecret>
}

/**
 * Router model API keys. Keys are decrypted only in the main process and only
 * when a request is about to be sent; the renderer can write and delete them
 * but never read them back.
 */
export class RouterCredentials {
  constructor(
    private readonly store: RouterStore,
    private readonly cipher: SecretCipher
  ) {}
  configured(): OwltoProviderId[] {
    return this.store.credentialIds() as OwltoProviderId[]
  }
  has(providerId: OwltoProviderId): boolean {
    return this.store.credential(providerId)?.type === 'api_key'
  }
  async key(providerId: OwltoProviderId): Promise<string | null> {
    const row = this.store.credential(providerId)
    if (!row || row.type !== 'api_key') return null
    let secret: DecryptedSecret
    try {
      secret = await this.cipher.decrypt(row.secret)
    } catch {
      return null
    }
    if (secret.stale) await this.reEncrypt(providerId, row.secret, secret.plain)
    return secret.plain
  }
  async setKey(providerId: OwltoProviderId, key: string): Promise<void> {
    const reason = await this.cipher.unavailable()
    if (reason) throw new OwltoError('secure_storage_unavailable', reason)
    this.store.saveCredential(providerId, 'api_key', await this.cipher.encrypt(key))
  }
  remove(providerId: OwltoProviderId): void {
    this.store.removeCredential(providerId)
  }
  /** Best effort: the key still works if this fails, and a key changed meanwhile is kept. */
  private async reEncrypt(providerId: OwltoProviderId, previous: string, key: string) {
    try {
      const encoded = await this.cipher.encrypt(key)
      if (this.store.credential(providerId)?.secret === previous)
        this.store.saveCredential(providerId, 'api_key', encoded)
    } catch {}
  }
}
