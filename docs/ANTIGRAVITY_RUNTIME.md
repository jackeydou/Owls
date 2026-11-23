# Owlto Antigravity Runtime

## Scope

Owlto can run workers with the user's installed Google Antigravity CLI (`agy`)
next to the [Codex](CODEX_APP_SERVER.md), [Claude Code](CLAUDE_CODE_RUNTIME.md),
and [Cursor](CURSOR_RUNTIME.md) runtimes. Like Cursor, Antigravity runs workers
only: its Agent Client Protocol (ACP) server has no way to take the Router's
in-process tools.

Antigravity ships its own ACP server (`agy acp`, ACP version 1 over stdio), so
Owlto drives it with the same runtime as Cursor (`AcpAgentService`). Only the
agent definition differs.

## Entries and ownership

- Agent definition (discovery, connection probe, launch arguments, modes,
  thinking level): `apps/owlto-client/src/main/antigravity/agent.ts`.
- Model list parsing, sign-in detection, and mode mapping:
  `src/main/antigravity/normalize.ts`.
- Shared ACP runtime: `src/main/acp/` (see [Cursor](CURSOR_RUNTIME.md#entries-and-ownership)).

Paths after the first entry are relative to `apps/owlto-client/`.

Antigravity owns its model requests, native tools, context, authentication, MCP
servers (`~/.gemini/config/mcp_config.json`), and conversation storage. Owlto
owns project selection, worker sessions, normalized items, settings, and
approval routing.

## Local executable and connection

Discovery checks a user-selected executable, then `~/.local/bin` (where the
installer puts `agy`), the inherited `PATH`, and Homebrew locations.

The CLI has no account status command. Connecting runs `agy --version`, then
`agy models`, which needs a signed-in session: a model list means signed in, and
a failure that mentions authentication or signing in means signed out. Model
lines may be JSON, `id - Name`, `id  Name`, or a bare id; anything else is
skipped and leaves only the CLI default to pick. Signing in stays in the CLI:
users run `agy` (or `agy acp --login` over SSH) and reconnect. Owlto never
stores a Gemini API key.

## Task flow

Each turn starts its own `agy acp` process in the session's folder and sends:

1. `initialize` with no file system or terminal capabilities, so Antigravity
   runs its own tools. Owlto does not call `authenticate`: the CLI uses the
   account it is signed in with.
2. `session/load` with the saved conversation ID, or `session/new`.
3. `session/set_mode` when the session is not already in the mode below.
4. The session's model and thinking level, when chosen, through
   `session/set_config_option` for the `model` and `thought_level` options (or
   the draft `session/set_model` when the agent offers only that). A value the
   session does not list is left at the agent's default.
5. `session/prompt`. ACP `usage` in the result is recorded as worker tokens.

| Owlto permission | Antigravity |
| --- | --- |
| Read only | `plan` mode; edit approvals are refused outright |
| `workspace-write` (not offered in Settings) | `default` mode; reads and edits inside the task folder are approved, everything else asks |
| Full access | `accept-edits` mode; every approval is granted once |

Settings offers Read only and Full access, as for Cursor. Thinking levels are
`low`, `medium`, `high`, `extra`, and `max`.

Worker reports, stopping, and unknown agent requests work as for Cursor.
Antigravity can take a prompt during a running turn to steer it, but Owlto
still queues follow-ups for the next turn until that path is verified.

## Tests and limits

`tests/admin/antigravity-runtime.test.mjs` drives `AcpAgentService` with
`antigravityAgent` against `tests/fixtures/antigravity/mock-agy.cjs`. The mock
follows the ACP schema and Antigravity's documented options. The `agy models`
output format, the exact mode IDs, and the config option IDs come from public
documentation and need checking against a real signed-in CLI.
