# Owlto Cursor Runtime

## Scope

Owlto can run workers with the user's installed Cursor CLI next to the
[Codex runtime](CODEX_APP_SERVER.md) and the
[Claude Code runtime](CLAUDE_CODE_RUNTIME.md). Cursor runs workers only. The
Router engine stays on Claude Code, Codex, or the Owlto engine, because Cursor's
Agent Client Protocol (ACP) mode has no way to take the Router's in-process tools.

## Entries and ownership

- Host routing: `apps/owlto-client/src/main/app/host.ts` (one `AgentRuntime` per
  provider, `src/main/app/agent-runtime.ts`).
- Cursor's agent definition (discovery names, connection probe, launch
  arguments, modes, and its `cursor/*` extension methods): `src/main/cursor/agent.ts`.
- Account, model, question, and plan parsing: `src/main/cursor/normalize.ts`.
- The shared ACP runtime, also used by [Antigravity](ANTIGRAVITY_RUNTIME.md):
  discovery `src/main/acp/discovery.ts`, transport `src/main/acp/connection.ts`,
  session orchestration `src/main/acp/service.ts` (`AcpAgentService`), and update,
  tool, and approval normalization `src/main/acp/normalize.ts`.

Paths after the first entry are relative to `apps/owlto-client/`.

Cursor owns its model requests, native tools, context, authentication, MCP
servers (`.cursor/mcp.json`), and native chat storage. Owlto owns project
selection, worker sessions, normalized items, settings, and approval routing.

## Local executable

Discovery checks a user-selected executable, then `~/.local/bin`, the inherited
`PATH`, and Homebrew locations, trying `cursor-agent` before the generic `agent`
name in each folder. Launcher links are kept as found because the installer's
updater replaces their versioned targets.

Connecting runs `--version`, `status --format json` (plain `status` as a
fallback), and `models` for the model catalog. Lines that are not `id - Name`
are skipped, so an unexpected catalog format leaves only the CLI default to pick.
Sign-in stays in the CLI: users run `cursor-agent login` and reconnect. Owlto
never stores a Cursor API key.

## Task flow

Each turn starts its own `agent [--model <id>] acp` process in the session's
folder. Cursor staff recommend `--model` over ACP model switching, which has
been unreliable. The turn then sends:

1. `initialize` with no file system or terminal capabilities, so Cursor runs its
   own tools.
2. `authenticate` with `cursor_login` when the agent offers it.
3. `session/load` with the saved chat ID, or `session/new`. Updates replayed
   while a session loads are ignored. A chat Cursor no longer has starts over.
4. `session/set_mode` when the session is not already in the mode below.
5. `session/prompt`, which resolves with the stop reason when the turn ends.

The process is stopped when the turn ends. ACP cannot add a message to a running
turn, so the Router's follow-ups queue for the next turn.

| Owlto permission | Cursor |
| --- | --- |
| Read only | `ask` mode; edit approvals are refused outright |
| `workspace-write` (not offered in Settings; only when the Router asks for it or caps a worker at it) | `agent` mode; reads and edits inside the task folder are approved, everything else asks |
| Full access | `agent` mode; every approval is granted once |

Settings offers Cursor only Read only and Full access, its native `ask` and
`agent` modes: Cursor's own Auto-review classifier does not run over ACP, so
there is no reviewer behind an "Approve for me" level. A saved Cursor setting of
`workspace-write` loads as Full access.

`session/request_permission` either answers from the policy above or becomes an
approval card. `cursor/ask_question` becomes a question card; answers map back to
option IDs, and typed text that matches no option is sent as the reason for
skipping. `cursor/create_plan` becomes an approval card. `cursor/update_todos`
and `plan` updates become the turn's plan item. Unknown agent requests are
answered with JSON-RPC "method not found".

## Worker reports

Workers report through the Owlto `report` MCP tool. When the agent advertises
`agentCapabilities.mcpCapabilities.http`, `session/new` and `session/load` pass
one HTTP MCP server named `owlto`: a Streamable HTTP endpoint that Owlto serves on
127.0.0.1 with an unguessable per-session path (`WorkerReportServer`). Cursor
builds since mid-2026 accept editor-provided servers without the file-based MCP
approval step; older builds may ignore them, which falls back as below.

ACP has no output schema. Without the HTTP capability, worker turns prepend the
worker instructions and the report JSON Schema to the prompt (or send them as
`systemPrompt` when the agent advertises that capability). Whenever the tool was
not called, `parseReport` accepts a trailing JSON object, fenced or not, in the
final assistant message.

## Stopping

Stopping sends `session/cancel`, answers pending approvals as cancelled, and
stops the process if the turn has not ended 15 seconds later.

## Tests and limits

`tests/admin/cursor-runtime.test.mjs` drives `AcpAgentService` with `cursorAgent` against
`tests/fixtures/cursor/mock-cursor-agent.cjs`, a scripted ACP agent. The mock
follows the ACP schema and Cursor's documented extension methods; the
`status` and `models` output formats are best guesses and need checking against
a real signed-in CLI.
