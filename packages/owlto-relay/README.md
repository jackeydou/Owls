# @owlto/relay

The relay for Remote Router over the internet. It joins a client's WebSocket to the host
Mac's, so two devices on different networks can talk without a public IP or an open port.
It only passes frames along: the Remote Router handshake and every frame after it are
end-to-end encrypted between the two devices (`apps/owlto-client/src/main/remote/`), so
the relay sees ciphertext, connection times, and sizes, never content.

## How it works

- A host that allows internet connections keeps a **control socket** open at
  `/v1/host/<mailbox>`. The first host to register a mailbox owns it; the relay stores
  only a SHA-256 of its secret.
- The host tells the relay which **tickets** may connect: one per paired client, plus a
  one-time ticket while a pairing invite is open. The relay stores their hashes.
- A client connects at `/v1/client/<mailbox>` with its ticket. The relay asks the host for a
  pipe, the host opens `/v1/pipe/<mailbox>`, and from then on binary messages pass between
  the two sockets unchanged. Clients without a valid ticket never reach the host.

The wire protocol is documented in `src/protocol.ts`; `src/room.ts` is the platform-free
logic, with two adapters:

| File | Runs on |
| --- | --- |
| `src/worker.ts` | Cloudflare Workers, one Durable Object per mailbox, WebSocket hibernation |
| `src/node.ts` | Plain Node (`ws`), for tests and self-hosting; mailboxes live in memory |

## Commands

```bash
pnpm --filter @owlto/relay test          # protocol tests against the Node relay
pnpm --filter @owlto/relay typecheck     # Node and Worker builds
pnpm --filter @owlto/relay dev:worker    # the Worker locally under wrangler (workerd)
pnpm --filter @owlto/relay serve -- --port 8787 --host 0.0.0.0   # self-hosted Node relay
pnpm --filter @owlto/relay deploy        # deploy to Cloudflare (needs `wrangler login`)
```

The app's default relay is `wss://relay.owlto.dev` (`DEFAULT_RELAY_URL` in
`apps/owlto-client/src/shared/remote.ts`). Point that domain at the deployed Worker with a
custom domain route in the Cloudflare dashboard or a `routes` entry in `wrangler.toml`.

## Not yet

R0 is a prototype. Still to come: GitHub sign-in to register a mailbox, per-IP rate limits,
per-mailbox traffic caps, cleanup of mailboxes unused for 30 days, short rendezvous codes
and QR pairing, and encrypted push notifications.
