# Owls

A desktop workspace for your locally installed Codex.

Owls runs `codex app-server` on your computer. Codex owns the agent loop,
models, tools, permissions, and authentication. Owls adds a Router you talk to
in each project. It splits your request into workers that run in Codex or Claude
Code, and reports back. An overview map shows every project and worker, with
each worker's activity, file changes, and report one click away.

## Get started

Install and sign in to [Codex CLI](https://developers.openai.com/codex/cli)
on your computer. Then open **Settings → Local Codex → Use local Codex sign-in**.
Owls detects the executable, connects to app-server, and loads your account and
available models. You can also choose an executable or start Codex's official
ChatGPT sign-in flow from Settings.

Owls does not copy tokens into its database or expose credentials to the
renderer. Your native Codex configuration and sign-in remain owned by Codex.

Open a project folder and tell the Router what you need. Approval requests wait
above the input. Type `@` to send a message straight to one worker, and press
`⌘J` to switch between the conversation and the overview map.

Only open projects you trust. Codex can load project instructions, hooks,
plugins, and MCP servers using its native configuration.

## Runtime and data

The active application uses the Codex runtime, not the previous Pi runtime.
This is a clean break: Owls does not import or resume previous Pi conversations,
model settings, or tool approvals. New local state uses `owls-codex.db` under
the configured Owls data root. Native Codex sessions stay in Codex's own store.

Router conversations, workers, and settings survive app restarts. An interrupted
worker can continue through its native Codex thread. Live approval callbacks
expire when the owning process disconnects.

Owls can also run workers with your installed Claude Code CLI: connect it in
**Settings → Local Claude Code**, then choose the agent under **Worker defaults**.
See [Claude Code runtime](docs/CLAUDE_CODE_RUNTIME.md).

See [Codex runtime](docs/CODEX_APP_SERVER.md) for ownership, configuration,
storage, tests, and failure handling. The broader
[orchestrator proposal](docs/RFC_OWLS_AGENT_ORCHESTRATOR.md) records future
multi-provider design work.

## Development

Use Node.js 22 or newer and pnpm `10.30.2`, as declared in `packageManager`.

```bash
pnpm install
pnpm dev
```

For an isolated development profile:

```bash
pnpm dev --owls-dev-name "Codex Orchestrator" \
  --owls-data-root ~/.owls-dev/codex-orchestrator
```

Runtime settings are persisted; there are no Owls environment-variable overrides
for the agent executable, model, account, or data root.

```bash
pnpm --filter owls-client typecheck
pnpm --filter owls-client test:codex
pnpm --filter owls-client test:codex:desktop
pnpm --filter owls-client test:codex:ui
```

After a build, verify a real local installation. The first command only reads
account and model metadata. The other commands use the native account to run
small, isolated live tests.

```bash
pnpm --filter owls-client verify:codex
pnpm --filter owls-client verify:codex --prompt
pnpm --filter owls-client verify:codex --tools
```

Development changes target `main` through pull requests. Read
[CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for repository
guidance.

## Security

IPC input and native protocol messages are validated. The renderer has no Node
access or generic shell/IPC capability. Native tools are governed by Codex's
permissions and sandbox; Owls displays the approval requests Codex exposes.

Please report security issues privately. Do not include credentials, private
project data, or authentication files in public issues.

## License

Owls is licensed under the
[GNU Affero General Public License v3.0](LICENSE). Codex is separately installed
and governed by its own license and service terms.
