import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type RawData, type WebSocket, WebSocketServer } from 'ws'
import { MAX_MESSAGE_BYTES, routeOf } from './protocol.ts'
import { type Attachment, type Mailbox, Room, type RoomIO } from './room.ts'

/**
 * The relay on plain Node, for tests and for people who run their own relay. Mailboxes live
 * in memory, so a restart forgets them and hosts register again on reconnect.
 */
export type NodeRelay = {
  /** The `ws://` base URL, e.g. `ws://127.0.0.1:52011`. */
  url: string
  close(): Promise<void>
}

type RoomState = {
  sockets: Set<WebSocket>
  attachments: WeakMap<WebSocket, Attachment>
  mailbox: Mailbox | null
}

export async function startNodeRelay(
  options: { port?: number; host?: string } = {}
): Promise<NodeRelay> {
  const rooms = new Map<string, RoomState>()
  const server: Server = createServer((_request, response) => {
    response.writeHead(426, { 'content-type': 'text/plain' })
    response.end('Owlto relay: WebSocket only.\n')
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })

  function roomFor(mailbox: string): { state: RoomState; room: Room<WebSocket> } {
    let state = rooms.get(mailbox)
    if (!state) {
      state = { sockets: new Set(), attachments: new WeakMap(), mailbox: null }
      rooms.set(mailbox, state)
    }
    const current = state
    const io: RoomIO<WebSocket> = {
      sockets: () => [...current.sockets],
      attachment: (socket) => current.attachments.get(socket) ?? null,
      attach: (socket, attachment) => current.attachments.set(socket, attachment),
      send: (socket, data) => {
        if (socket.readyState === socket.OPEN) socket.send(data)
      },
      close: (socket, code, reason) => socket.close(code, reason),
      load: async () => current.mailbox,
      save: async (mailbox) => {
        current.mailbox = mailbox
      },
      randomId: () => randomBytes(16).toString('base64url'),
      now: () => Date.now()
    }
    return { state: current, room: new Room(io) }
  }

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const route = routeOf(new URL(request.url ?? '/', 'http://relay').pathname)
    if (!route) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const { state, room } = roomFor(route.mailbox)
      state.sockets.add(ws)
      state.attachments.set(ws, { kind: route.kind, state: 'hello' })
      // Messages are handled one at a time per socket, as a Durable Object does.
      let queue = Promise.resolve()
      ws.on('message', (raw: RawData, isBinary: boolean) => {
        const data = isBinary ? toBytes(raw) : toBytes(raw).toString('utf8')
        queue = queue.then(() => room.message(ws, data)).catch(() => ws.terminate())
      })
      ws.on('close', () => {
        queue = queue.then(() => {
          room.closed(ws)
          state.sockets.delete(ws)
        })
      })
      ws.on('error', () => ws.terminate())
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address
  return {
    url: `ws://${host}:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate()
        wss.close()
        server.close(() => resolve())
      })
  }
}

function toBytes(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw
  if (Array.isArray(raw)) return Buffer.concat(raw)
  return Buffer.from(raw)
}
