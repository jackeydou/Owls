# Owls Codex App Server Runtime

## Scope

The active application is Codex-first. It uses the user's installed Codex,
a new IPC contract, a new renderer, and a fresh SQLite database. It does not
migrate or adapt Pi sessions, messages, model credentials, or approvals.

The earlier orchestrator RFC is a broader design reference. Its legacy-data
migration proposal does not apply to this implementation.

## Entries and ownership

- Main: `apps/owls-client/src/main/app/desktop.ts`.
- Native client: `src/main/codex/client.ts`.
- Session orchestration: `src/main/codex/service.ts`.
- Persistence: `src/main/app/store.ts` and `schema.ts`.
- Protocol validation and normalization: `src/main/codex/protocol.ts`.
- Shared UI/IPC contracts: `src/shared/app.ts`.
- Preload: `src/preload/owls.ts`.
- Renderer: `src/renderer/src/app/`.

Paths after the first entry are relative to `apps/owls-client/`.

Codex owns its model requests, native tools, context, authentication, and native
thread storage. Owls owns project selection, worker sessions, normalized item history,
settings, and live request routing. No Pi events are synthesized.

## Local account connection

Automatic discovery checks the inherited executable search path and common
local installation directories. A user-selected executable takes priority.

The main process starts `codex app-server --listen stdio://`, completes the
initialize/initialized handshake, and calls `account/read` and `model/list`.
Only account type, email, plan, and model metadata reach the renderer.
Authentication files and tokens are not copied or parsed by Owls.

**Use local Codex sign-in** reconnects the native process and reads the current
native account. Reconnecting is blocked while tasks are active. The optional
ChatGPT login button calls `account/login/start` and opens the official URL;
Codex owns the callback, token storage, and refresh.

Settings and executable choices are persisted through the Codex store and
existing data-root path flow, without runtime environment-variable overrides.

## Task flow

1. Open a trusted project folder.
2. Choose the model, native reasoning effort, and permission mode.
3. Create a local task and submit a message with a unique command ID.
4. Start a native thread or resume the task's saved thread.
5. Start the turn and project native messages, commands, plans, and patches.
6. Display native approvals and questions, then route responses to their
   owning process and request ID.
7. Persist item completion, turn outcome, diff, and token usage.

Native model and reasoning choices come from the live catalog. Reasoning effort
is an opaque native value validated against the selected model, not the old
Pi thinking-level enum.

Router worker threads start with one dynamic tool, `owls_report`, through which
the worker reports to the Router. Dynamic tools need the experimental API, so the
handshake declares `experimentalApi: true`; Codex stores the tool with the thread,
and `item/tool/call` requests for it are answered by the Router's worker pool.

The initial flow allows one active turn per task. Other tasks can run
independently. Stop records cancellation even if the native turn ID has not
arrived yet.

## Permissions

Read only and workspace access select Codex's corresponding sandbox modes.
Full access selects native danger-full-access while keeping on-request
approvals routed to the user. Native rules can resolve some actions without
creating an approval request.

Owls does not claim to intercept every native tool or enforce the previous
Pi tool gate. Unknown native control requests are rejected.

Approval responses are not considered resolved until native acknowledgement.
Process disconnect or app restart invalidates live callbacks; old Allow
buttons are never rebound to a new process.

## Persistence and recovery

The database is `owls.db` under the existing configured data root.
`migrations/` contains its independent forward-only schema.
Existing Pi data is not imported. This change does not erase the user's
native Codex account or native sessions.

Task snapshots and settings survive restart. In-flight work becomes interrupted;
the next message resumes the native thread. A missing native thread produces
an actionable error instead of rebuilding a thread from UI messages.

Command IDs prevent repeated delivery of the same accepted message. A request
timeout reports an unknown result; Owls does not automatically replay it.
Text updates are batched, while requests and terminal state are saved immediately.

## Verification

```bash
pnpm --filter owls-client typecheck
pnpm --filter owls-client test:codex
pnpm --filter owls-client test:desktop
pnpm --filter owls-client test:ui
```

The transport tests use a process fixture. The Electron smoke test exercises
the real native SQLite binding, migrations, service, and fixture process:
account status, streaming, duplicate delivery, approvals, interruption, and
restart persistence.

The UI test loads the production renderer, sandboxed preload, IPC, and SQLite
in Electron. It covers messages, tools and diff, approvals, questions, account
reconnection, theme/language persistence, and reload. It also checks that the
renderer cannot access generic Electron IPC or set an executable through the
ordinary settings payload. App errors use stable codes with English and
Simplified Chinese UI messages; native Codex errors retain redacted details.

After building:

```bash
pnpm --filter owls-client verify:codex
pnpm --filter owls-client verify:codex --prompt
pnpm --filter owls-client verify:codex --tools
```

Live tests use the local account. Prompt/tool tests create an isolated temporary
workspace and remove it when finished. Logs report pass/fail and counts, not
tokens or account credentials. Tool verification checks an actual file write
and native command/file-change events.

The packaged app must also be checked for its preload, `migrations` resources,
native database binding, local executable discovery, and the settings/task UI.

After a macOS package build, run the same UI flow against its actual ASAR,
preload, and packaged migrations without opening the user's real data root:

```bash
pnpm --filter owls-client exec electron tests/admin/ui-smoke.cjs \
  --packaged-app dist/mac-arm64/Owls.app
```

## Upstream contract

[Codex App Server](https://developers.openai.com/codex/app-server/) is the
upstream protocol reference. The installed CLI's generated types and live
behavior are used to validate the adapter. A successful build alone does not
prove compatibility with a native CLI version.
