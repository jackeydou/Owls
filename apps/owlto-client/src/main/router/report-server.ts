import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import appPackage from '../../../package.json'
import {
  REPORT_SERVER_NAME,
  REPORT_TOOL_DESCRIPTION,
  REPORT_TOOL_INPUT_SCHEMA,
  REPORT_TOOL_NAME,
  type ReportToolResult
} from './report.js'

const HOST = '127.0.0.1'
const PATH = /^\/workers\/([0-9a-f]{48})\/mcp$/

/**
 * A local Streamable HTTP MCP server that serves the worker report tool to
 * agents that only take MCP servers by URL (Cursor over ACP). It listens on
 * loopback only, starts on first use, and each worker session gets its own
 * unguessable path, so a call always reports for the session it was given to.
 * Requests are stateless: every POST gets a fresh MCP server.
 */
export class WorkerReportServer {
  private server: Server | null = null
  private listening: Promise<number> | null = null
  private readonly tokens = new Map<string, string>()
  private readonly sessions = new Map<string, string>()
  private closed = false

  constructor(private readonly call: (sessionId: string, input: unknown) => ReportToolResult) {}

  /** The MCP URL for one worker session; the same session keeps the same URL. */
  async endpoint(sessionId: string): Promise<string> {
    const port = await this.listen()
    let token = this.tokens.get(sessionId)
    if (!token) {
      token = randomBytes(24).toString('hex')
      this.tokens.set(sessionId, token)
      this.sessions.set(token, sessionId)
    }
    return `http://${HOST}:${port}/workers/${token}/mcp`
  }

  close(): void {
    this.closed = true
    this.server?.close()
    this.server?.closeAllConnections()
    this.server = null
    this.listening = null
    this.tokens.clear()
    this.sessions.clear()
  }

  private listen(): Promise<number> {
    if (this.closed) return Promise.reject(new Error('The worker report server is closed.'))
    this.listening ??= new Promise<number>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handle(req, res).catch(() => {
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
      })
      server.once('error', (error) => {
        this.listening = null
        reject(error)
      })
      server.listen(0, HOST, () => {
        this.server = server
        resolve((server.address() as AddressInfo).port)
      })
    })
    return this.listening
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = (this.server?.address() as AddressInfo | null)?.port
    const token = PATH.exec(new URL(req.url ?? '/', `http://${HOST}`).pathname)?.[1]
    const sessionId = token ? this.sessions.get(token) : undefined
    // A page in a browser can reach loopback too; the Host check stops DNS rebinding.
    const host = req.headers.host
    if (!sessionId || (host !== `${HOST}:${port}` && host !== `localhost:${port}`)) {
      res.writeHead(404).end()
      return
    }
    const mcp = new McpServer(
      { name: REPORT_SERVER_NAME, version: appPackage.version },
      { capabilities: { tools: {} } }
    )
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: REPORT_TOOL_NAME,
          description: REPORT_TOOL_DESCRIPTION,
          inputSchema: REPORT_TOOL_INPUT_SCHEMA as { type: 'object' }
        }
      ]
    }))
    mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      const result =
        request.params.name === REPORT_TOOL_NAME
          ? this.call(sessionId, request.params.arguments ?? {})
          : { ok: false, text: `Unknown tool ${request.params.name}.` }
      return { content: [{ type: 'text', text: result.text }], isError: !result.ok }
    })
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    })
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res)
  }
}
