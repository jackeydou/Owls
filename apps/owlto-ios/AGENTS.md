# AGENTS.md — Owlto iOS

The iPhone app for Remote Router: it pairs with a Mac running Owlto and drives that
Mac's Router. The Mac keeps all data and runs every worker; the phone only relays
messages and shows state. Nothing about threads is stored on the phone.

## Layout

- `Owlto.xcodeproj` — hand-maintained project using file-system synchronized groups:
  any file added under `Owlto/`, `OwltoTests/`, or `OwltoUITests/` joins its target
  automatically, so the project file rarely changes. Keep it that way; do not add
  per-file references.
- `Owlto/Remote/` — the protocol client. It must match
  `apps/owlto-client/src/main/remote/*` byte for byte:
  - `RemoteCrypto.swift`, `OwltoScrypt.c` ↔ `crypto.ts` (X25519, HKDF-SHA256,
    scrypt N=2^15, AES-256-GCM with a counter nonce)
  - `FrameSocket.swift` ↔ `frames.ts` (4-byte big-endian length prefix)
  - `Handshake.swift` ↔ `handshake.ts` (`hs1`/`hs2`, sealed `hello`/`welcome`)
  - `RpcConnection.swift` ↔ `rpc.ts` (`req`/`res`/`event`/`ping`/`pong`)
  - `RemoteHub.swift` ↔ `client.ts` (one link per paired Mac, reconnect backoff)
- `Owlto/Model/` — lenient `Decodable` mirrors of `shared/app.ts` and
  `shared/router.ts`. Decode only what the phone shows; unknown enum values map to
  an `unknown`/`other` case so a newer Mac still decodes.
- `Owlto/UI/` — SwiftUI screens. Colors come from `Theme.swift`, which mirrors the
  desktop tokens in `assets/main.css`, light and dark. `OwlAvatar.swift` draws the
  owls from the same SVG path data as `apps/owlto-client/resources/owl-avatars`.

## Protocol changes

The wire format is shared with the desktop app. When `REMOTE_PROTOCOL`, a remote
method in `remoteMethodSchemas`, a handshake message, or a crypto parameter changes
in `apps/owlto-client`, change the Swift side in the same MR and regenerate the test
vectors in `OwltoTests/RemoteProtocolTests.swift` with Node's `crypto` (each test
names the Node call that produced its value). The host re-validates every request
with the desktop's zod schemas, so request params must match them exactly
(`routerId`, `sessionId`, and `requestId` are UUIDs; `interruptRouter` takes a bare
router id).

## Build and test

`xcodebuild` breaks under some interactive shell environments on this team's
machines (the build service exits with "The Xcode build system has terminated").
Run it with a clean environment:

```bash
env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin USER="$USER" xcodebuild -project apps/owlto-ios/Owlto.xcodeproj -scheme Owlto -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

The unit tests cover crypto interop with the Mac, address and code parsing, event
decoding, timeline grouping, and diff parsing. `OwltoUITests` skips itself unless a
dev host is given (below).

## Dev host

`scripts/dev-host.mjs` runs the desktop app's real Remote Router host
(`RemoteService`) with a scripted Router and sample threads, so the phone can be
developed without a configured Mac. It loads the desktop's built main-process code:

```bash
pnpm --filter owlto-client build
```

```bash
node apps/owlto-ios/scripts/dev-host.mjs --port 47330
```

It prints a pairing code; pair the simulator with `127.0.0.1:47330`. Port 47320 is
left free for a real Owlto running on the same Mac. Debug builds accept launch
arguments for driving the app without taps (see `Owlto/App/DevLaunch.swift`), and
the UI flow test runs against a freshly started dev host:

```bash
env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin USER="$USER" TEST_RUNNER_OWLTO_DEV_HOST=127.0.0.1:47330 TEST_RUNNER_OWLTO_DEV_CODE=ABCD-EFGH xcodebuild -project apps/owlto-ios/Owlto.xcodeproj -scheme Owlto -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:OwltoUITests test
```

## Copy

All user-facing text, including accessibility labels, is English in code with
Simplified Chinese in `Owlto/Localizable.xcstrings`; reuse the desktop's wording
(`apps/owlto-client/src/renderer/src/**/i18n*.ts`) where the same idea appears.
After adding strings, build and check that every key the compiler extracted
(`*.stringsdata` in DerivedData) has a `zh-Hans` entry.
