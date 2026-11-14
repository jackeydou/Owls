export type CustomMcpStdioServer = {
  id: string
  name: string
  enabled: boolean
  type: 'stdio'
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

export type CustomMcpRemoteServer = {
  id: string
  name: string
  enabled: boolean
  type: 'streamable-http'
  url: string
  headers: Record<string, string>
}

export type CustomMcpServer = CustomMcpStdioServer | CustomMcpRemoteServer

export type CustomMcpServerSummary = CustomMcpServer & {
  oauthConnected: boolean
}

export type CustomMcpConnectResult =
  | { ok: true; servers: CustomMcpServerSummary[] }
  | { ok: false; error: 'oauth_discovery_invalid' }

export type SaveCustomMcpServerInput =
  | (Omit<CustomMcpStdioServer, 'id'> & { id?: string })
  | (Omit<CustomMcpRemoteServer, 'id'> & { id?: string })
