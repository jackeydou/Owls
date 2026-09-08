# RFC: Local JSON-RPC Unix Socket Control Plane

## Status

Draft technical design for adding a local Unix domain socket control plane to
Owls Client.

## Abstract

Owls Client can expose a local, same-machine control plane from the Electron
main process by listening on a Unix domain socket at startup. External local
processes, such as CLI tools, helper daemons, automation scripts, or second
app instances, can call allowlisted App capabilities through JSON-RPC 2.0 over
that socket.

This socket is an external process boundary. It does not replace in-process
TypeScript imports, and it does not replace the renderer-to-main preload IPC
bridge. Main-process modules should continue to share typed services and helper
functions directly. The Unix socket only provides a stable local RPC adapter for
callers outside the running App process.

## Motivation

External local processes currently have only a few coarse ways to trigger Owls
Client behavior:

- Deep links.
- Electron second-instance argv forwarding.
- Renderer-mediated IPC flows.
- Direct imports into internal packages, which only works for code running
  inside a compatible process and package context.

These paths are not a complete local automation interface. A Unix socket
control plane gives Owls a stable local integration point without opening a TCP
port or exposing generic internal APIs.

Useful callers include:

- A future `pichu` CLI that opens sessions, sends prompts, or focuses the app.
- Local helper processes that notify the App when work is ready.
- Test or automation scripts that need a narrow, stable App control surface.
- A secondary App launch that forwards structured requests to the primary
  instance.

## Goals

- Start a Unix domain socket from the Electron main process during App startup.
- Use JSON-RPC 2.0 as the request and response protocol.
- Use newline-delimited JSON framing over the stream transport.
- Route requests through an explicit allowlisted command registry.
- Validate every request payload at the socket boundary.
- Keep socket lifecycle tied to the App lifecycle.
- Keep failures isolated so local RPC startup problems do not prevent the App
  UI from launching.
- Close active socket connections and remove socket metadata during App quit.

## Non-Goals

- Do not replace normal in-process imports or service calls.
- Do not replace the preload IPC bridge used by the renderer.
- Do not expose arbitrary `ipcMain` forwarding.
- Do not expose generic shell, filesystem, database, plugin registry, or auth
  token access.
- Do not expose remote network access.
- Do not make plugin-provided daemons or arbitrary background code active by
  default.
- Do not support JSON-RPC batch requests in the first version.
- Do not stream full agent events in the first version.

## Current Baseline

Relevant existing implementation:

| Area | Current implementation | Notes |
| --- | --- | --- |
| Main startup | `apps/pichu-client/src/main/index.ts` | `app.whenReady()` initializes settings, IPC handlers, plugins, windows, auth, auto update, and shutdown handlers. |
| Data root | `apps/pichu-client/src/main/pichu-paths.ts` | `getDataRoot()` resolves the persisted data root through the bootstrap path flow. |
| Renderer IPC | `apps/pichu-client/src/preload/index.ts` | Exposes narrow `window.api.*` methods backed by `ipcMain` handlers. |
| Agent IPC | `apps/pichu-client/src/main/agent/index.ts` | Registers agent, settings, sessions, messages, artifacts, and tool approval IPC handlers. |
| Local daemon precedent | `apps/pichu-client/src/main/browser/daemon.ts` | Existing HTTP and WebSocket local bridge for the browser extension, currently disabled at startup. |

The local RPC control plane should follow the same ownership boundaries:

- Main process owns OS integration, persistence, agent orchestration, and local
  server lifecycle.
- Renderer continues to call through preload IPC.
- Shared business behavior should be extracted into typed services when both
  IPC and local RPC need the same capability.

## High-Level Architecture

Add a new main-process module group:

```text
apps/pichu-client/src/main/local-rpc/
  index.ts
  transport.ts
  unix-socket-transport.ts
  json-rpc.ts
  command-registry.ts
  errors.ts
  schemas.ts
  commands/
    app.ts
    agent.ts
    sessions.ts
    automation.ts
    settings.ts
```

Data flow:

```text
External local process
  -> Unix domain socket
  -> NDJSON-framed JSON-RPC 2.0 message
  -> local RPC transport
  -> json-rpc parser and serializer
  -> command-registry method lookup and params validation
  -> typed main-process service
  -> JSON-RPC response
```

Responsibilities:

- `transport.ts` defines a transport interface that is independent of Unix
  socket path details.
- `unix-socket-transport.ts` owns `node:net` Unix socket server creation,
  connection tracking, stale socket handling, backpressure, and close handling.
- `json-rpc.ts` owns protocol validation, request normalization, response
  serialization, line framing, frame size limits, and JSON-RPC error mapping.
- `command-registry.ts` owns method registration, allowlist lookup, payload
  validation, method-level readiness checks, and handler dispatch.
- `commands/*` owns App-specific method definitions.
- Existing App modules own the actual business behavior.

The socket handler must not call `ipcMain` handlers directly. `ipcMain` handlers
are renderer-boundary adapters. When local RPC and IPC need the same behavior,
that behavior should live in a typed service or command helper that both
adapters can call.

### Transport Abstraction

The first implementation targets Unix domain sockets on macOS and Linux, but
the JSON-RPC protocol and command registry should not depend on Unix-specific
paths, `chmod`, or stale socket file cleanup. Introduce a small transport
interface at the local RPC boundary:

```ts
type LocalRpcTransportMetadata = {
  transport: 'unix' | 'windows-named-pipe'
  endpoint: string
  pid: number
  startedAt: string
}

type LocalRpcConnection = {
  id: string
  remoteLabel: string
  write: (frame: string) => Promise<void>
  close: () => void
  onFrame: (listener: (frame: string) => void) => () => void
  onClose: (listener: () => void) => () => void
}

type LocalRpcTransport = {
  start: (handlers: {
    onConnection: (connection: LocalRpcConnection) => void
    onError: (error: Error) => void
  }) => Promise<LocalRpcTransportMetadata>
  stop: () => Promise<void>
  diagnostics: () => {
    enabled: boolean
    endpoint: string | null
    clientCount: number
    lastError?: string
  }
}
```

The rest of local RPC should depend only on `LocalRpcTransport`. The Unix
implementation can still use `node:net`, Unix socket paths, parent directory
permissions, and stale socket unlinking internally.

This keeps future Windows support contained to a new transport implementation:

```text
macOS/Linux:
  {getDataRoot()}/run/pichu.sock

Windows:
  \\.\pipe\pichu-{stable-user-or-install-id}
```

Node's `net.createServer()` supports both Unix sockets and Windows named pipes,
so JSON-RPC parsing, NDJSON framing, method schemas, command dispatch, request
timeouts, and most client code can be reused. Windows work should focus on pipe
name discovery, same-user access restrictions, ACL behavior, and platform test
coverage.

## Socket Startup

### Socket Path

The socket path must not come from `process.env` or `import.meta.env`. Runtime
configuration should follow the existing data-root policy.

Recommended path:

```text
{getDataRoot()}/run/pichu.sock
```

Example:

```text
/Users/alice/.pichu/run/pichu.sock
```

The server should also write a metadata file next to the socket so external
clients can discover the endpoint:

```text
{getDataRoot()}/run/local-rpc.json
```

Example metadata:

```json
{
  "version": 1,
  "transport": "unix",
  "endpoint": "/Users/alice/.pichu/run/pichu.sock",
  "protocol": "jsonrpc-2.0",
  "framing": "ndjson",
  "pid": 12345,
  "startedAt": "2026-05-29T17:00:00.000Z"
}
```

The metadata file is informational, but it is also the discovery contract for
external clients. It must be written with `0600` permissions where supported,
and local RPC startup must fail closed if the file cannot be written or secured.
It must not contain auth tokens, API keys, or other secrets.

### Startup Timing

Start local RPC from `app.whenReady()` after core main-process services are
initialized and IPC handlers are registered:

1. Initialize settings and database-backed stores.
2. Initialize device id, auth protocol handling, menu, cron, and
   protocol handlers.
3. Register existing main-process IPC handlers.
4. Install or upgrade default plugins.
5. Start the local RPC socket.
6. Create the authenticated main window or auth window.
7. Initialize auto update and other non-blocking startup tasks.

Starting after core IPC registration keeps the command registry close to the
same readiness boundary as the renderer API. Local RPC startup failure should
be logged and surfaced through diagnostics, but it should not prevent the App
from opening.

### Directory And Permissions

Before listening:

- Create `{getDataRoot()}/run` with mode `0700` where supported.
- Ensure the parent directory is not world-writable.
- After `server.listen(socketPath)` succeeds, `chmod` the socket file to
  `0600`.
- Write `{getDataRoot()}/run/local-rpc.json` and `chmod` it to `0600`.
- If any permission or metadata write step fails, close the local RPC server,
  remove owned socket/metadata files, and disable local RPC for this App run.
  The App UI should continue starting.

Unix socket permissions are platform-dependent, so the parent directory must be
the primary access boundary.

### Stale Socket Handling

Unix socket files can be left behind after crashes. Startup should handle this
deterministically:

1. If the socket path does not exist, call `server.listen(socketPath)`.
2. If the path exists, attempt a short client connection to that path.
3. If the connection succeeds, another server is active. Do not unlink the
   socket. Log that local RPC is already served and skip starting a duplicate.
4. If the connection fails with `ECONNREFUSED`, `ENOENT`, or `ENOTSOCK`, treat
   the file as stale, unlink it, and listen again.
5. For other errors, disable local RPC for this App run and log the actionable
   error.

This does not replace Electron's existing single-instance lock. It only prevents
stale socket files from blocking a healthy App start.

### Startup Failure Policy

Local RPC is an auxiliary control plane. Failures should not crash the App.

| Failure | Behavior |
| --- | --- |
| `EADDRINUSE` or active socket detected | Skip local RPC startup and log a warning. |
| `EACCES` | Skip local RPC startup and log a permission error. |
| Socket path too long | Skip local RPC startup and log the path-length problem. |
| Metadata write failure | Keep socket server running, log a warning, and expose diagnostics. |
| Unexpected listen error | Skip local RPC startup and keep the UI running. |

## JSON-RPC Protocol

### Protocol Version

The socket accepts JSON-RPC 2.0 requests.

Request:

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "app.status",
  "params": {}
}
```

Success response:

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "result": {
    "ready": true
  }
}
```

Error response:

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": {
      "field": "sessionId"
    }
  }
}
```

Notification:

```json
{
  "jsonrpc": "2.0",
  "method": "app.ping",
  "params": {}
}
```

Notifications have no `id` and receive no response. The first version should
prefer ordinary requests over notifications for operational commands so callers
can reliably observe success or failure.

### Framing

Unix sockets are byte streams, not message streams. The transport uses
newline-delimited JSON framing:

- UTF-8 text.
- One JSON-RPC message per line.
- `\n` terminates each frame.
- Empty lines are ignored.
- Each frame has a maximum byte size. Recommended initial value: `1 MiB`.

Example stream:

```text
{"jsonrpc":"2.0","id":"1","method":"app.status","params":{}}\n
{"jsonrpc":"2.0","id":"2","method":"agent.status","params":{}}\n
```

If a frame exceeds the maximum size, the server should return a request-too-large
error when possible and then close that client connection.

### Batch Requests

JSON-RPC batch requests are not supported in the first version. If the server
receives an array at the top level, it should return:

```json
{
  "jsonrpc": "2.0",
  "id": null,
  "error": {
    "code": -32600,
    "message": "Batch requests are not supported"
  }
}
```

This avoids early complexity around concurrent batch ordering, partial failure,
and cancellation.

### Method Naming

Methods use dot-separated namespaces:

```text
rpc.discover
rpc.diagnostics
app.status
app.focus
app.version
session.list
session.open
session.new
session.continue
session.status
session.messages
agent.status
agent.newSession
agent.prompt
agent.cancel
plugin.list
automation.list
automation.runNow
settings.get
```

Sensitive methods should remain disabled or require a later approval-backed
design:

```text
app.quit
auth.logout
settings.set
plugin.enable
plugin.disable
toolApproval.resolve
```

`plugin.install` and `plugin.uninstall` require authentication but do not
require a separate approval step in the current implementation.

## App-Side Event Handling Design

### Command Registry

The App should register socket-callable capabilities explicitly:

```ts
type LocalRpcContext = {
  isAppReady: () => boolean
  focusApp: () => void
  getCurrentSessionId: () => string | null
}

type LocalRpcHandler<TParams, TResult> = {
  method: string
  description: string
  schema: {
    parse: (value: unknown) => TParams
  }
  run: (params: TParams, context: LocalRpcContext) => Promise<TResult> | TResult
}
```

The dispatch flow:

1. Parse one NDJSON frame.
2. Validate JSON-RPC envelope.
3. Reject notifications for methods that require acknowledgement.
4. Look up the method in the command registry.
5. Validate `params` with the method schema.
6. Check App readiness and method-level capability policy.
7. Run the handler.
8. Serialize either `result` or `error`.

Validation can use the repo's existing schema dependencies, such as `zod` or
`typebox`. The implementation should keep validation near the socket boundary
and return stable errors instead of raw exceptions.

### Service Extraction

Do not implement local RPC by routing into `ipcMain.handle` callbacks. IPC
handlers should remain renderer adapters.

When a socket method needs behavior that currently lives inside an IPC handler,
extract that behavior into a service or helper:

```text
Before:
renderer -> preload -> ipcMain handler -> inline behavior

After:
renderer -> preload -> ipcMain handler -> typed service
external process -> Unix socket -> local-rpc handler -> same typed service
```

This keeps:

- IPC payload shapes independent from local RPC payload shapes.
- Error mapping appropriate for each boundary.
- Unit tests focused on service behavior and protocol adapters separately.
- Main-process code type-safe and debuggable.

### Initial Method Set

The first implementation should expose low-risk, high-value methods only.

#### `rpc.discover`

Returns protocol and method metadata:

```json
{
  "protocolVersion": 1,
  "appName": "Owls",
  "methods": [
    "rpc.discover",
    "rpc.diagnostics",
    "app.status",
    "app.focus",
    "agent.status",
    "session.open",
    "session.new",
    "session.continue",
    "session.status",
    "session.messages",
    "plugin.list",
    "plugin.install",
    "plugin.uninstall"
  ]
}
```

#### `rpc.diagnostics`

Returns local RPC server state:

```json
{
  "enabled": true,
  "endpoint": "/Users/alice/.pichu/run/pichu.sock",
  "clientCount": 1,
  "pendingRequests": 0,
  "startedAt": "2026-05-29T17:00:00.000Z"
}
```

#### `app.status`

Returns App readiness and coarse state. This method should avoid secrets and
large payloads:

```json
{
  "ready": true,
  "authenticated": true,
  "rendererReady": true,
  "currentSessionId": "..."
}
```

#### `app.focus`

Focuses the existing main window or opens the auth window when unauthenticated.
If the renderer is not ready, the method can return accepted after scheduling
the focus behavior.

#### `agent.status`

Returns the same type of state as the existing agent status IPC path:

- Current session id.
- Running session ids.
- Waiting human-input session ids.
- Active run ids by session.
- Active run started timestamps by session.

#### `session.open`

Navigates the UI to a session and focuses the App. This method must first
require `authenticated: true`; unauthenticated calls return
`LOCAL_RPC_UNAUTHORIZED` and must not create or show the main window. If the
renderer is still loading, main process should store pending navigation and
flush it when the renderer reports ready.

#### `session.list`

Returns paginated session index entries, ordered the same way as the renderer's
default session index view.

Params:

- `page` (optional; defaults to `1`)
- `pageSize` (optional; defaults to `20`, capped at `100`)

Response:

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 42,
  "sessions": []
}
```

#### `session.new`

Creates a new agent session, persists the initial user prompt, and starts the
agent run asynchronously. The method returns immediately with:

```json
{
  "accepted": true,
  "sessionId": "..."
}
```

Params:

- `prompt` (required)
- `cwd` (optional; defaults to the persisted working directory)
- `model` (optional)
- `thinkingLevel` (optional)

Callers should poll `session.status` for run progress.

#### `session.continue`

Continues an existing session with a new prompt using the same async submit
semantics as `session.new`:

```json
{
  "accepted": true,
  "sessionId": "..."
}
```

Params:

- `sessionId` (required)
- `prompt` (required)

#### `session.status`

Returns a focused status view for the current session or an explicit
`sessionId`:

```json
{
  "sessionId": "...",
  "status": "running",
  "activeRunId": "...",
  "activeRunStartedAt": "...",
  "waitingInputId": null
}
```

`status` is one of `idle`, `running`, or `waiting_for_user`.

#### `session.messages`

Returns all persisted message rows for a session, using the same message source
as the renderer `messages:list` IPC path.

Params:

- `sessionId` (required)

#### `plugin.list`

Returns available marketplace entries and installed plugins:

```json
{
  "available": [],
  "installed": []
}
```

This method is read-only and does not refresh marketplace status metadata.

#### `plugin.install`

Installs a marketplace plugin after authentication:

```json
{
  "marketplaceName": "bundled-public",
  "pluginName": "example-plugin"
}
```

Returns the installed plugin record.

#### `plugin.uninstall`

Uninstalls an installed plugin by name:

```json
{
  "pluginName": "example-plugin"
}
```

Returns `{ "uninstalled": true }`.

#### `agent.prompt`

This should be added only after the basic server and status methods are stable.

Recommended first-version semantics:

- Require explicit `sessionId`.
- Require non-empty `text`.
- Enforce a maximum prompt size.
- Return accepted once the prompt is submitted or queued.
- Do not wait for the full model response.
- If the session is already running, return conflict unless the method later
  grows an explicit `mode`.

Example request:

```json
{
  "jsonrpc": "2.0",
  "id": "prompt-1",
  "method": "agent.prompt",
  "params": {
    "sessionId": "session-id",
    "text": "Summarize the current workspace state."
  }
}
```

Example response:

```json
{
  "jsonrpc": "2.0",
  "id": "prompt-1",
  "result": {
    "accepted": true,
    "sessionId": "session-id",
    "runId": "run-id"
  }
}
```

## Error Mapping

Use standard JSON-RPC errors where applicable:

| Code | Meaning |
| --- | --- |
| `-32700` | Parse error |
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error |

Use application-specific errors in the JSON-RPC server error range:

| Code | Meaning |
| --- | --- |
| `-32001` | App not ready |
| `-32002` | Unauthorized |
| `-32003` | Conflict |
| `-32004` | Timeout |
| `-32005` | Request too large |
| `-32006` | Method disabled |
| `-32007` | Operation cancelled |

Error responses should preserve enough information for external clients to act,
but must not leak secrets, auth headers, cookies, tokens, full private paths,
large model payloads, or raw plugin output.

## Security Model

The first-version security boundary is same-machine, same-user local access:

- Listen only on a Unix domain socket.
- Do not open a TCP port.
- Store the socket under the App data root.
- Use a `0700` parent directory.
- Attempt `0600` socket file permissions.
- Write metadata with `0600` file permissions.
- Expose only allowlisted methods.
- Validate all params.
- Keep sensitive operations disabled unless a later approval-backed design adds
  them.

Even same-user local callers are not fully trusted. The socket must not expose:

- Generic shell execution.
- Generic filesystem access.
- Generic database reads or writes.
- Generic plugin registry mutation.
- Auth tokens or credentials.
- Arbitrary IPC channel forwarding.

Plugin interactions need extra care. The plugin system intentionally avoids
executing high-risk components by default. Local RPC must not become a bypass
that lets plugins invoke privileged App capabilities outside manifest,
permission, and approval boundaries.

## Connection Handling

### Multiple Clients

The server should support multiple concurrent clients. Recommended limits:

- Maximum active clients: 32.
- Maximum pending requests per client: 32.
- Maximum global pending requests: 128.
- Maximum frame size: 1 MiB.

When limits are exceeded, return a conflict or request-too-large error where
possible, then close the offending client connection if necessary.

### Request Timeout

Each request should have a timeout:

- Default: 60 seconds.
- Short status methods: 5 seconds.
- Prompt submission: 30 seconds for acceptance, not for full agent completion.

Long-running agent work should be represented by accepted run metadata, not by
holding the socket request open until the model finishes.

### Backpressure

`socket.write()` may return `false`. The transport should pause additional
writes for that connection until `drain` fires. If a client stops reading and
the pending response buffer exceeds a configured limit, close that connection
without affecting other clients or the App.

### Malformed Input

| Case | Behavior |
| --- | --- |
| Empty line | Ignore. |
| Invalid JSON | Return parse error if possible, then continue or close after repeated failures. |
| Top-level array | Return invalid request because batch is unsupported. |
| Missing `jsonrpc` or wrong version | Return invalid request. |
| Missing or non-string `method` | Return invalid request. |
| Unknown method | Return method not found. |
| Invalid params | Return invalid params. |
| Oversized frame | Return request too large if possible and close the connection. |

## Boundary Cases And Recovery

### App Not Ready

Some methods can run before the full UI is ready, while others cannot.

- `rpc.discover`, `rpc.diagnostics`, and `app.status` should be available as
  early as the socket is listening.
- `app.focus` can open the auth window or schedule focus behavior.
- Session and agent methods should return `App not ready` or `Unauthorized`
  until required state exists.

### Renderer Not Ready

Methods that trigger navigation or visible UI updates should use the existing
pending-navigation pattern:

- Main process accepts the request.
- Main process stores pending navigation or focus action.
- Renderer calls its ready IPC.
- Main process flushes the pending action.

The RPC response should report accepted scheduling instead of waiting for the
renderer to finish rendering.

### Existing Agent Run

If `agent.prompt` targets a session that is already running, the first version
should return conflict:

```json
{
  "jsonrpc": "2.0",
  "id": "prompt-1",
  "error": {
    "code": -32003,
    "message": "Session is already running"
  }
}
```

Future versions can add explicit modes such as `queue` or `steer`, but those
modes should be designed alongside existing follow-up behavior.

### Client Disconnect

If a client disconnects:

- Remove the connection from the active client set.
- Remove all subscriptions owned by that connection.
- Drop any unsent responses for that client.
- Do not shut down the server.

If a request has already entered a short handler, the handler may complete even
after the client disconnects. For long-running methods, the handler should
define whether disconnect cancels the operation. The first version should avoid
long-running socket-held operations.

### Server Error

If the local RPC server unexpectedly closes:

- Close active client sockets.
- Attempt one bounded restart if the App is not quitting.
- If restart fails, disable local RPC for the current App run and log
  diagnostics.
- Do not quit the App.

### App Crash

If the App crashes, a stale socket file may remain. The next startup's stale
socket handling should remove it if no active server responds. External clients
should handle `ECONNRESET`, `ECONNREFUSED`, and EOF by re-reading
`local-rpc.json` and reconnecting.

### Data Root Change

Changing data root restarts the App and changes the socket path.

Expected behavior:

- During shutdown, close the old socket and remove old metadata if possible.
- After restart, write new metadata under the new data root.
- External clients should not cache socket paths permanently. They should
  rediscover from metadata when a connection fails.

### Sleep And Wake

macOS sleep may leave connections idle for long periods. The server can keep
idle connections open, but each request should have a timeout. An optional idle
connection timeout, such as 30 minutes, can reduce stale clients.

### Permission Failure

If the socket directory cannot be created or permission checks fail:

- Disable local RPC for this App run.
- Keep the App UI available.
- Log a concise actionable error.
- Report disabled status through diagnostics where possible.

### Socket Path Length

Unix socket path length limits vary by platform and can be short. The default
data-root path is short enough for normal use, but a user-configured data root
could be too long.

If the path is too long:

- Do not fall back to `/tmp` automatically.
- Disable local RPC for the current run.
- Log that the configured data root produces an unsupported socket path.

A `/tmp` fallback would require a separate secure discovery and permission
design, so it should not be added implicitly.

## Shutdown

App shutdown should close local RPC from the existing `before-quit` handler.

Recommended shutdown sequence:

1. Set `isShuttingDown = true`.
2. Stop accepting new connections with `server.close()`.
3. Optionally send a JSON-RPC notification to active clients:

   ```json
   {
     "jsonrpc": "2.0",
     "method": "server.shutdown",
     "params": {
       "reason": "app_quit"
     }
   }
   ```

4. Wait a short grace period, such as 500 ms.
5. Destroy any remaining client sockets.
6. Clear pending requests and subscriptions.
7. Remove the socket file if it still exists.
8. Remove `local-rpc.json` if it belongs to the current process.
9. Clear server references.

Cleanup failures should be logged as warnings and must not block App quit.
Startup stale-socket handling is responsible for repairing leftovers from
crashes or failed cleanup.

## Observability

Use a consistent log prefix:

```text
[local-rpc] server started
[local-rpc] client connected
[local-rpc] invalid request
[local-rpc] method failed
[local-rpc] server stopped
```

Logs should not include full prompt text, tokens, auth headers, cookies, or
large raw payloads. For method failures, log method name, request id, stable
error code, and sanitized message.

Useful diagnostics:

- Whether local RPC is enabled.
- Socket path.
- Start timestamp.
- Active client count.
- Pending request count.
- Last startup error.
- Last shutdown cleanup error.

## Testing Plan

Unit tests:

- JSON-RPC request parsing.
- Notification parsing.
- Invalid JSON mapping to parse error.
- Unsupported batch request mapping.
- Unknown method mapping.
- Invalid params mapping.
- Error redaction.

Socket transport tests:

- Partial frame across multiple chunks.
- Multiple frames in one chunk.
- Oversized frame.
- Client disconnect.
- Backpressure path where feasible.
- Server close removes socket metadata.

Lifecycle tests:

- Stale socket cleanup.
- Active socket detection.
- Startup failure does not throw through App startup.
- Shutdown closes active sockets.

Command tests:

- Allowlisted method succeeds.
- Disabled method fails with `Method disabled`.
- Schema validation rejects bad params.
- App-not-ready methods fail with stable errors.

For implementation changes touching the main process, run:

```bash
pnpm --filter pichu-client typecheck:node
```

If shared types or renderer diagnostics are added, also run:

```bash
pnpm --filter pichu-client typecheck:web
```

For docs-only changes to this RFC, `git diff --check` is sufficient.

## Rollout Plan

Phase 1:

- Add socket lifecycle, metadata, stale socket handling, and shutdown cleanup.
- Add JSON-RPC parsing and command registry.
- Expose:
  - `rpc.discover`
  - `rpc.diagnostics`
  - `app.status`
  - `app.focus`
  - `agent.status`
  - `session.open`

Phase 2:

- Add session automation methods:
  - `session.new`
  - `session.continue`
  - `session.status`
  - `session.messages`
- Add plugin management methods:
  - `plugin.list`
  - `plugin.install`
  - `plugin.uninstall`
- Add `agent.cancel`.
- Add a local CLI client that discovers `local-rpc.json` and sends JSON-RPC
  requests.

Phase 3:

- Add event subscriptions only if concrete callers need server push.
- Add approval-backed sensitive operations if product requirements justify
  them.
- Consider Windows named-pipe transport if Windows support requires parity.

## Open Questions

- Should local RPC be enabled in all builds, or should packaged release builds
  gate it behind a persisted setting?
- Should `agent.prompt` use existing follow-up behavior, or should socket calls
  always require explicit `queue` or `steer` modes?
- Which App diagnostics UI should surface local RPC startup failures?
- Should second-instance handling migrate from argv-only forwarding to this
  structured RPC path?
- What is the minimum CLI method set needed before exposing `agent.prompt`?
