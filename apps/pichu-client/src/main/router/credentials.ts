import type { OwlsProviderId } from '../../shared/router.js'
import { CodexRuntimeError } from '../codex/errors.js'
import type { RouterStore } from './store.js'

/** The encryption the credential store needs; Electron's safeStorage in the app. */
export type SecretCipher = {
  /** Null when secrets can be stored, otherwise why not. */
  unavailable(): string | null
  encrypt(plain: string): string
  decrypt(encoded: string): string
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
  configured(): OwlsProviderId[] {
    return this.store.credentialIds() as OwlsProviderId[]
  }
  has(providerId: OwlsProviderId): boolean {
    return this.store.credential(providerId) !== null
  }
  key(providerId: OwlsProviderId): string | null {
    const row = this.store.credential(providerId)
    if (!row || row.type !== 'api_key') return null
    try {
      return this.cipher.decrypt(row.secret)
    } catch {
      return null
    }
  }
  setKey(providerId: OwlsProviderId, key: string): void {
    const reason = this.cipher.unavailable()
    if (reason) throw new CodexRuntimeError('secure_storage_unavailable', reason)
    this.store.saveCredential(providerId, 'api_key', this.cipher.encrypt(key))
  }
  remove(providerId: OwlsProviderId): void {
    this.store.removeCredential(providerId)
  }
}
