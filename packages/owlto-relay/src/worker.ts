import { DurableObject } from 'cloudflare:workers'
import { routeOf } from './protocol.ts'
import { type Attachment, type Mailbox, Room, type RoomIO } from './room.ts'

/**
 * The relay on Cloudflare: a Worker routes `/v1/<kind>/<mailbox>` to one Durable Object per
 * mailbox, which accepts the WebSocket with the hibernation API. Each socket keeps its
 * `Attachment`, so the object may sleep between messages and rebuild the room when it wakes.
 */
export interface Env {
  RELAY_ROOM: DurableObjectNamespace<RelayRoom>
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const route = routeOf(new URL(request.url).pathname)
    if (!route) return new Response('Not found\n', { status: 404 })
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Owlto relay: WebSocket only.\n', { status: 426 })
    const stub = env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(route.mailbox))
    return stub.fetch(request)
  }
} satisfies ExportedHandler<Env>

const MAILBOX_KEY = 'mailbox'

export class RelayRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Keepalive pings from either side are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request): Promise<Response> {
    const route = routeOf(new URL(request.url).pathname)
    if (!route) return new Response('Not found\n', { status: 404 })
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    const hello: Attachment = { kind: route.kind, state: 'hello' }
    server.serializeAttachment(hello)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.room().message(
      socket,
      typeof message === 'string' ? message : new Uint8Array(message)
    )
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    this.room().closed(socket)
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    this.room().closed(socket)
  }

  private room(): Room<WebSocket> {
    const io: RoomIO<WebSocket> = {
      sockets: () => this.ctx.getWebSockets(),
      attachment: (socket) => (socket.deserializeAttachment() as Attachment | null) ?? null,
      attach: (socket, attachment) => socket.serializeAttachment(attachment),
      send: (socket, data) => {
        try {
          socket.send(data)
        } catch {
          // The socket closed in the meantime; its close handler cleans up.
        }
      },
      close: (socket, code, reason) => {
        try {
          socket.close(code, reason)
        } catch {
          // Already closed.
        }
      },
      load: async () => (await this.ctx.storage.get<Mailbox>(MAILBOX_KEY)) ?? null,
      save: (mailbox) => this.ctx.storage.put(MAILBOX_KEY, mailbox),
      randomId: () => {
        const bytes = crypto.getRandomValues(new Uint8Array(16))
        return btoa(String.fromCharCode(...bytes))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
      },
      now: () => Date.now()
    }
    return new Room(io)
  }
}
