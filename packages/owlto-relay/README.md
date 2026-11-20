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
- **Accounts.** A Mac signs in once: it gets a GitHub token through Owlto's own no-scope
  OAuth App ("Owlto Relay", device flow), and posts it to `POST /v1/account/login`. The relay
  asks GitHub who it is, throws the token away, and returns a relay session
  `s1.<account>.<random>` (account = `sha256("github:" + id)`; only a hash of the session is
  stored in `RelayAccount`). Every host hello carries the session, so signing out
  (`DELETE /v1/account/session`) or removing a Mac (`DELETE /v1/account/mailbox/<id>`) cuts it
  off at once, and `GET /v1/account` lists the account's Macs. One account owns at most 5
  mailboxes and 20 sessions; a session idle for 180 days stops working. Clients never sign
  in; they use tickets. A private deployment can set `REQUIRE_GITHUB = "false"`.
- **Rendezvous codes.** While a pairing invite is open the host asks for a 4-character code;
  `GET /v1/rendezvous/<code>` returns the mailbox and one-time ticket for 5 minutes. The
  app shows `K7Q2-ABCD-EFGH`: the first group finds the mailbox, the last two are the
  pairing code, which never reaches the relay. Lookups are limited to 10 per IP a minute.
- **Offline queue.** When the host is away, a paired client may leave sealed messages at
  `/v1/drop/<mailbox>`: up to 50 per ticket and 200 per mailbox, 64 KiB each, kept 7 days.
  They are sealed to the host's long-term key (`main/remote/sealed.ts` in the app), and the
  host acknowledges each one after it runs it.
- **Push.** The host sends `push` with a phone's APNs token and a payload sealed with a key
  only the phone holds; the relay forwards it to APNs (60 per mailbox an hour) and tells
  the host when a token is gone. The phone's notification extension opens it.
- **Expiry.** A mailbox whose host has not connected for 30 days is deleted, with its queue
  and its account slot, by one Durable Object alarm.

The wire protocol is documented in `src/protocol.ts`; `src/room.ts` is the platform-free
logic, with two adapters:

| File | Runs on |
| --- | --- |
| `src/worker.ts` | Cloudflare Workers, one Durable Object per mailbox, WebSocket hibernation |
| `src/node.ts` | Plain Node (`ws`), for tests and self-hosting; mailboxes live in memory |

## Account index (D1)

Each account's record lives in its `RelayAccount` Durable Object, which only answers for
that one account. So accounts can be counted and found, every change also writes one row
to the D1 database `owlto-relay-accounts` (`owlto-relay-accounts-debug` for the debug
relay): `account` (the hash), `login`, `macs`, `sessions`, `created_at`, `last_seen_at`
(a day stale at most), `updated_at`. No session, hash of one, or mailbox id goes there.
The relay never reads it back, and a failed write is retried by the next change.

`wrangler deploy` creates the database on first deploy (there is no `database_id` in
`wrangler.toml`), and the Worker creates the table on first write. To query it:

```bash
pnpm exec wrangler d1 execute owlto-relay-accounts --remote \
  --command "SELECT count(*), sum(macs) FROM accounts"
pnpm exec wrangler d1 execute owlto-relay-accounts --remote \
  --command "SELECT * FROM accounts WHERE login = 'octocat'"
```

## Commands

```bash
pnpm --filter @owlto/relay test          # protocol tests against the Node relay
pnpm --filter @owlto/relay typecheck     # Node and Worker builds
pnpm --filter @owlto/relay dev:worker    # the Worker locally under wrangler (workerd)
pnpm --filter @owlto/relay serve -- --port 8787 --host 0.0.0.0   # self-hosted Node relay
pnpm --filter @owlto/relay deploy:debug  # deploy the debug relay (needs `wrangler login`)
pnpm --filter @owlto/relay deploy        # deploy the production relay
```

## Deploying

`wrangler.toml` has two deployments. Release builds of the app use the production relay,
`wss://relay.owlto.dev`; debug builds and `pnpm dev` use `wss://relay-debug.owlto.dev`
(`RELAY_URL` in `apps/owlto-client/src/main/build-flavor.ts`). Both domains are Worker
custom domains, so the `owlto.dev` zone must be on the same Cloudflare account.

The **Deploy relay** workflow (`.github/workflows/deploy-relay.yml`, run by hand) runs the
tests and deploys the environment you pick. It needs two repository secrets:

- `CLOUDFLARE_API_TOKEN`: a token with *Workers Scripts: Edit* and *D1: Edit* on the
  account, and *Workers Routes: Edit* on the `owlto.dev` zone.
- `CLOUDFLARE_ACCOUNT_ID`.

Push notifications need an APNs auth key (a `.p8` from the Apple Developer account, Keys →
Apple Push Notifications service). Set it once per environment; without it pushes fail
quietly and everything else works:

```bash
cd packages/owlto-relay
pnpm exec wrangler secret put APNS_KEY [--env debug]      # paste the .p8 file's contents
pnpm exec wrangler secret put APNS_KEY_ID [--env debug]   # the key's 10-character id
pnpm exec wrangler secret put APNS_TEAM_ID [--env debug]  # the Apple team id
```

`APNS_TOPIC` (the iOS bundle id) is a plain var in `wrangler.toml`. Each push says whether
its token is a sandbox token, so one relay serves both Xcode builds and TestFlight.

## Keeping the Cloudflare bill bounded

Durable Objects bill per request and for the time an object stays awake; a hibernated object
with idle WebSockets costs nothing
([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). The relay
is built so nothing keeps an object awake or reconnecting on its own:

- **One alarm per mailbox, at most once a month**: when the host leaves, the object sets an
  alarm 30 days out to delete the mailbox. Nothing else runs on a timer, so it sleeps
  whenever its sockets are quiet.
- **Keepalive pings are free**: the text `ping` is answered by
  `setWebSocketAutoResponse` without waking the object. The app pings relay sockets every
  30 s this way, and sends end-to-end pings over a pipe only after 4 quiet minutes
  (`RELAY_KEEPALIVE` in the app's `remote/relay.ts`), since those do wake the object.
- **Rate limits before the object wakes**: the Worker allows 120 new sockets a minute per IP
  and 30 per mailbox, 10 rendezvous lookups a minute per IP, and 30 account requests a minute per IP (`[[ratelimits]]` in
  `wrangler.toml`).
- **Per-mailbox caps inside the object** (`src/protocol.ts`): 32 open sockets, 60 new
  sockets and 3,000 messages a minute; a socket that sends no hello within 10 s is closed
  when the next one arrives. A mailbox over its message budget has the offending socket
  closed with `limited`.
- **Clients back off**: hosts reconnect after 1 s up to 5 min with jitter, clients up to
  5 min over the relay, and the backoff resets only after a connection held for a minute.
  A host pushed off by another Mac with the same secret, or turned away with `denied` or
  `version`, stops retrying until the Mac wakes or the user toggles the relay.

Set these in the Cloudflare dashboard as well, since code cannot cap an invoice:

- A Durable Objects spending limit, and a separate Workers spending limit
  ([spend management](https://developers.cloudflare.com/durable-objects/platform/spend-management/)).
  At the limit new requests are rejected, but messages on already-open WebSockets still
  flow, so the caps above still matter.
- A billing email alert.
