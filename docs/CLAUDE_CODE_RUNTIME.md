# Owls Claude Code Runtime

## Scope

Owls can run tasks with the user's installed Claude Code CLI next to the
[Codex runtime](CODEX_APP_SERVER.md). Each task chooses its agent when it is
created and never switches afterward. Both runtimes share projects, settings,
the task list, and `owls-codex.db`.

## Entries and ownership

- Host routing: `apps/pichu-client/src/main/codex/host.ts`.
- Discovery: `src/main/claude/discovery.ts`.
- Session orchestration: `src/main/claude/service.ts`.
- Event, tool, and permission normalization: `src/main/claude/normalize.ts`.

Paths after the first entry are relative to `apps/pichu-client/`.

Claude Code owns its model requests, native tools, context, compaction,
authentication, hooks, MCP servers, and native session storage. Owls owns
project selection, task views, normalized items, settings, and approval routing.

## Local executable, no bundled fallback

Owls drives the CLI through the official Agent SDK
(`@anthropic-ai/claude-agent-sdk/core`, pinned to the version paired with the
supported CLI) and always passes `pathToClaudeCodeExecutable`. The SDK's
platform CLI packages are listed in `ignoredOptionalDependencies` in
`pnpm-workspace.yaml`, so no bundled binary exists to fall back to. The SDK is
bundled into the main process because it is ESM-only.

Discovery checks a user-selected executable, then the inherited `PATH`,
`~/.local/bin`, `~/.claude/local`, and Homebrew locations. Launcher symlinks are
kept as found because the CLI's updater replaces their versioned targets.

Connecting runs `claude --version`, then starts the CLI without a prompt to read
the model catalog and account (`initializationResult`). No model request is
sent, but user-level session hooks may run. Sign-in stays in the CLI: users run
`claude` in a terminal and reconnect.

## Task flow

Each turn starts one SDK `query` with streaming input held open until the turn's
result, which is required for permission prompts and interrupt. Options load
`user`, `project`, and `local` settings and the `claude_code` system prompt
preset, matching the CLI. The native `session_id` is saved as the task's thread
ID and passed as `resume` on later turns.

| Owls permission | Claude Code |
| --- | --- |
| Read only | `default` mode with `Edit`, `NotebookEdit`, `Write` disallowed |
| Workspace access | `acceptEdits` |
| Full access | `auto` when the model reports auto-mode support, else `acceptEdits` |

Claude Code has no OS sandbox by default, so read-only relies on removed edit
tools and approval prompts. `bypassPermissions` is never used.

`canUseTool` prompts become approval cards; `AskUserQuestion` becomes a question
card whose answers return as `updatedInput.answers` keyed by question text.
Subagent messages (`parent_tool_use_id`) are not shown in the parent task.

## Recovery

A turn releases its task at its result, so follow-up messages never race the
previous process's shutdown. App restart marks in-flight tasks interrupted and
expires pending approvals; the next message resumes the native session. Stop
sends an SDK interrupt and aborts the process if the turn does not end.

## Verification

```bash
pnpm --filter pichu-client test:claude
pnpm --filter pichu-client test:codex:ui
pnpm --filter pichu-client verify:claude
pnpm --filter pichu-client verify:claude --prompt
pnpm --filter pichu-client verify:claude --tools
```

`test:claude` drives the service through a scripted SDK. The UI smoke covers the
agent picker, Claude approval cards, and settings. `verify:claude` uses the
local CLI and account; `--prompt` and `--tools` send small requests in a
temporary directory and check native resume, file changes, and commands.
