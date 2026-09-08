import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type {
  OAuthClientProvider,
  OAuthDiscoveryState
} from '@modelcontextprotocol/sdk/client/auth.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { shell } from 'electron'
import {
  clearCustomMcpOAuthCredential,
  getCustomMcpRemoteServer,
  readCustomMcpOAuthCredential,
  writeCustomMcpOAuthCredential
} from './stores/custom-mcp-store.js'

const MCP_OAUTH_CALLBACK_PORT = 16543
const MCP_OAUTH_CALLBACK_URL = `http://127.0.0.1:${MCP_OAUTH_CALLBACK_PORT}/oauth/callback`
const MCP_OAUTH_TIMEOUT_MS = 5 * 60_000

type StoredMcpOAuthCredential = {
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  codeVerifier?: string
  discoveryState?: OAuthDiscoveryState
}

class PichuMcpOAuthProvider implements OAuthClientProvider {
  private credential: StoredMcpOAuthCredential
  private readonly authorizationState = randomBytes(24).toString('base64url')

  constructor(
    private readonly serverId: string,
    private readonly onRedirect: (url: URL) => Promise<void>
  ) {
    this.credential = readCustomMcpOAuthCredential<StoredMcpOAuthCredential>(serverId) ?? {}
  }

  get redirectUrl(): string {
    return MCP_OAUTH_CALLBACK_URL
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Owls',
      redirect_uris: [MCP_OAUTH_CALLBACK_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }

  state(): string {
    return this.authorizationState
  }

  expectedState(): string {
    return this.authorizationState
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.credential.clientInformation
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.save({ ...this.credential, clientInformation })
  }

  tokens(): OAuthTokens | undefined {
    return this.credential.tokens
  }

  saveTokens(tokens: OAuthTokens): void {
    this.save({ ...this.credential, tokens })
  }

  redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    return this.onRedirect(authorizationUrl)
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.save({ ...this.credential, codeVerifier })
  }

  codeVerifier(): string {
    if (!this.credential.codeVerifier) throw new Error('OAuth code verifier is missing')
    return this.credential.codeVerifier
  }

  saveDiscoveryState(discoveryState: OAuthDiscoveryState): void {
    this.save({ ...this.credential, discoveryState })
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.credential.discoveryState
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') {
      this.save({})
      return
    }
    const next = { ...this.credential }
    if (scope === 'client') delete next.clientInformation
    if (scope === 'tokens') delete next.tokens
    if (scope === 'verifier') delete next.codeVerifier
    if (scope === 'discovery') delete next.discoveryState
    this.save(next)
  }

  private save(credential: StoredMcpOAuthCredential): void {
    this.credential = credential
    writeCustomMcpOAuthCredential(this.serverId, credential)
  }
}

function callbackPage(success: boolean): string {
  const title = success ? 'Connected to Owls' : 'Connection failed'
  const message = success
    ? 'You can close this window and return to Owls.'
    : 'Return to Owls and try connecting again.'
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f5f2;color:#191919}main{max-width:420px;padding:40px;text-align:center}h1{font-size:22px}p{color:#666;line-height:1.5}</style><main><h1>${title}</h1><p>${message}</p></main>`
}

type AuthorizationCallback = {
  promise: Promise<string>
  cancel: () => void
}

function createAuthorizationCallback(expectedState: string): AuthorizationCallback {
  let cancel = (): void => undefined
  const promise = new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      try {
        const url = new URL(request.url ?? '/', MCP_OAUTH_CALLBACK_URL)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')
        if (error) throw new Error(`OAuth authorization failed: ${error}`)
        if (!code || state !== expectedState) throw new Error('OAuth callback was invalid')
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(callbackPage(true))
        cleanup()
        resolve(code)
      } catch (error) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        response.end(callbackPage(false))
        cleanup()
        reject(error)
      }
    })
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('OAuth sign-in timed out'))
    }, MCP_OAUTH_TIMEOUT_MS)
    const cleanup = (): void => {
      clearTimeout(timer)
      server.close()
    }
    cancel = (): void => {
      cleanup()
      reject(new Error('OAuth sign-in was cancelled'))
    }
    server.once('error', () => {
      cleanup()
      reject(new Error(`OAuth needs localhost port ${MCP_OAUTH_CALLBACK_PORT}`))
    })
    server.listen(MCP_OAUTH_CALLBACK_PORT, '127.0.0.1')
  })
  return { promise, cancel }
}

function createOAuthTransport(
  url: string,
  headers: Record<string, string>,
  provider: OAuthClientProvider
): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(url), {
    authProvider: provider,
    requestInit: { headers, redirect: 'error' }
  })
}

async function verifyConnection(
  url: string,
  headers: Record<string, string>,
  provider: OAuthClientProvider
): Promise<void> {
  const transport = createOAuthTransport(url, headers, provider)
  const client = new Client({ name: 'pichu', version: '1.0.0' }, { capabilities: {} })
  try {
    await client.connect(transport)
  } finally {
    await client.close().catch(() => undefined)
  }
}

export function isCustomMcpOAuthDiscoveryHtmlError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes("unexpected token '<'") ||
    message.includes('<!doctype') ||
    (message.includes('not valid json') && message.includes('<'))
  )
}

export async function connectCustomMcpRemoteServer(serverId: unknown): Promise<void> {
  if (typeof serverId !== 'string' || !serverId) throw new Error('Server ID is required')
  const server = getCustomMcpRemoteServer(serverId)
  let redirected = false
  let callback: AuthorizationCallback | undefined
  const provider = new PichuMcpOAuthProvider(server.id, async (url) => {
    redirected = true
    callback = createAuthorizationCallback(provider.expectedState())
    try {
      await shell.openExternal(url.toString())
    } catch (error) {
      void callback.promise.catch(() => undefined)
      callback.cancel()
      callback = undefined
      throw error
    }
  })
  const transport = createOAuthTransport(server.url, server.headers, provider)
  const client = new Client({ name: 'pichu', version: '1.0.0' }, { capabilities: {} })
  try {
    await client.connect(transport)
    return
  } catch (error) {
    if (!redirected || !callback || !(error instanceof UnauthorizedError)) {
      void callback?.promise.catch(() => undefined)
      callback?.cancel()
      throw error
    }
    const code = await callback.promise
    await transport.finishAuth(code)
  } finally {
    await client.close().catch(() => undefined)
  }
  await verifyConnection(server.url, server.headers, provider)
}

export function disconnectCustomMcpRemoteServer(serverId: unknown): void {
  if (typeof serverId !== 'string' || !serverId) throw new Error('Server ID is required')
  clearCustomMcpOAuthCredential(serverId)
}

export function oauthProviderForCustomMcpServer(serverId: string): OAuthClientProvider | undefined {
  const server = getCustomMcpRemoteServer(serverId)
  return new PichuMcpOAuthProvider(server.id, async () => {
    throw new Error('Reconnect this MCP server from Settings')
  })
}
