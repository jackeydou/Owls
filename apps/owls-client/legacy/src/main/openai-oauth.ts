import { createServer } from 'node:net'
import {
  type Api,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  createModels,
  type Model
} from '@earendil-works/pi-ai'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { safeStorage } from 'electron'
import { OPENAI_OAUTH_PROVIDER_ID } from '../shared/openai-oauth.js'
import { deleteStoredSetting, getStoredSetting, setStoredSetting } from './stores/settings-store.js'

const OPENAI_OAUTH_CREDENTIAL_SETTING = 'openAiOAuthCredential'
const OPENAI_OAUTH_CALLBACK_PORT = 1455

// pi-ai's default OAuth loaders use runtime-relative imports that cannot be
// resolved after electron-vite bundles the main process into a single entry.
registerBunOAuthFlows()

let credentialWriteQueue: Promise<void> = Promise.resolve()

function secureCredentialStorageError(): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) {
    return 'Secure credential storage is unavailable on this device'
  }
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    return 'OpenAI sign-in requires a system keyring; Electron basic_text storage is not secure enough for OAuth tokens'
  }
  return undefined
}

function assertSecureCredentialStorage(): void {
  const error = secureCredentialStorageError()
  if (error) throw new Error(error)
}

function parseCredential(value: unknown): Credential | undefined {
  if (!value || typeof value !== 'object') return undefined
  const credential = value as Record<string, unknown>
  if (
    credential.type !== 'oauth' ||
    typeof credential.access !== 'string' ||
    !credential.access ||
    typeof credential.refresh !== 'string' ||
    !credential.refresh ||
    typeof credential.expires !== 'number'
  ) {
    return undefined
  }
  return credential as Credential
}

function readStoredCredential(): Credential | undefined {
  if (secureCredentialStorageError()) return undefined
  const encrypted = getStoredSetting(OPENAI_OAUTH_CREDENTIAL_SETTING)
  if (!encrypted) return undefined
  try {
    const value: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')))
    return parseCredential(value)
  } catch {
    return undefined
  }
}

function writeStoredCredential(credential: Credential | undefined): void {
  if (!credential) {
    deleteStoredSetting(OPENAI_OAUTH_CREDENTIAL_SETTING)
    return
  }
  assertSecureCredentialStorage()
  const encrypted = safeStorage.encryptString(JSON.stringify(credential)).toString('base64')
  setStoredSetting(OPENAI_OAUTH_CREDENTIAL_SETTING, encrypted)
}

const credentialStore: CredentialStore = {
  async read(providerId) {
    return providerId === OPENAI_OAUTH_PROVIDER_ID ? readStoredCredential() : undefined
  },
  async list(): Promise<readonly CredentialInfo[]> {
    return readStoredCredential() ? [{ providerId: OPENAI_OAUTH_PROVIDER_ID, type: 'oauth' }] : []
  },
  async modify(providerId, update) {
    if (providerId !== OPENAI_OAUTH_PROVIDER_ID) return undefined
    let result: Credential | undefined
    const write = credentialWriteQueue.then(async () => {
      const current = readStoredCredential()
      result = (await update(current)) ?? current
      writeStoredCredential(result)
    })
    credentialWriteQueue = write.catch(() => undefined)
    await write
    return result
  },
  async delete(providerId) {
    if (providerId !== OPENAI_OAUTH_PROVIDER_ID) return
    const write = credentialWriteQueue.then(() => writeStoredCredential(undefined))
    credentialWriteQueue = write.catch(() => undefined)
    await write
  }
}

const openAIOAuthModels = createModels({ credentials: credentialStore })
openAIOAuthModels.setProvider(openaiCodexProvider())

function abortablePendingPrompt(signal?: AbortSignal): Promise<string> {
  return new Promise((_, reject) => {
    const abort = (): void => reject(new Error('Login completed in the browser'))
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function hasOpenAIOAuthCredential(): boolean {
  return Boolean(readStoredCredential())
}

export function listOpenAIOAuthChatModels(): Model<Api>[] {
  return [...openAIOAuthModels.getModels(OPENAI_OAUTH_PROVIDER_ID)].sort((a, b) =>
    a.id.localeCompare(b.id)
  )
}

async function assertCallbackPortAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer()
    server.once('error', () => {
      reject(
        new Error(
          `OpenAI sign-in needs localhost port ${OPENAI_OAUTH_CALLBACK_PORT}. Close another active Codex login and try again.`
        )
      )
    })
    server.listen(OPENAI_OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })
}

function validatedOpenAIAuthUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com') {
    throw new Error('OpenAI sign-in returned an unexpected authorization URL')
  }
  return url.toString()
}

export async function loginOpenAIOAuth(openUrl: (url: string) => Promise<void>): Promise<void> {
  assertSecureCredentialStorage()
  await assertCallbackPortAvailable()
  await openAIOAuthModels.login(OPENAI_OAUTH_PROVIDER_ID, 'oauth', {
    prompt: (prompt) => {
      if (prompt.type === 'select') return Promise.resolve('browser')
      if (prompt.type === 'manual_code') return abortablePendingPrompt(prompt.signal)
      return Promise.reject(new Error(`Unsupported OpenAI login prompt: ${prompt.type}`))
    },
    notify: (event) => {
      if (event.type === 'auth_url') {
        const url = validatedOpenAIAuthUrl(event.url)
        void openUrl(url).catch(() => {
          console.error('[openai-oauth] failed to open the OpenAI sign-in URL')
        })
      }
    }
  })
}

export async function logoutOpenAIOAuth(): Promise<void> {
  await openAIOAuthModels.logout(OPENAI_OAUTH_PROVIDER_ID)
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const encoded = token.split('.')[1]
    if (!encoded) return undefined
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function accountIdFromToken(token: string): string | undefined {
  const payload = decodeJwtPayload(token)
  const auth = payload?.['https://api.openai.com/auth']
  if (!auth || typeof auth !== 'object') return undefined
  const accountId = (auth as Record<string, unknown>).chatgpt_account_id
  return typeof accountId === 'string' && accountId ? accountId : undefined
}

export async function getOpenAIOAuthRequestAuth(): Promise<{
  accessToken: string
  accountId?: string
}> {
  const result = await openAIOAuthModels.getAuth(OPENAI_OAUTH_PROVIDER_ID)
  const accessToken = result?.auth.apiKey
  if (!accessToken) throw new Error('OpenAI OAuth sign-in is required')
  const accountId = accountIdFromToken(accessToken)
  return { accessToken, ...(accountId ? { accountId } : {}) }
}
