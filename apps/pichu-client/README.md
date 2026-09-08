# Owls

Owls desktop client for AI-assisted workflows.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

`pnpm run dev` is equivalent.

Without `--pichu-dev-name`, the app shows a default project/worktree name while keeping
the Electron profile scoped to the current worktree.

To keep dev app history across changing worktrees, give the dev app a readable name:

```bash
$ pnpm dev --pichu-dev-name "Search QA"
```

On macOS, development launches use the Owls-specific bundle identifier
`us.pichuapp.pichu.dev` instead of Electron's default `com.github.Electron` identifier.

The named dev profile keeps its Electron profile stable across worktrees. By default,
dev app data comes from `~/.pichu`, so existing sessions remain visible. To isolate data
for a task, pass a fixed data root:

```bash
$ pnpm dev --pichu-dev-name "Search QA" --pichu-data-root ~/.pichu-dev/pichu-client-search-qa
```

Passing `--pichu-data-root` overrides the data root for that launch only. Later launches
with the same `--pichu-dev-name` return to the persisted profile data root unless the
flag is passed again.

### Build

```bash
# For windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For local macOS testing without notarization
$ pnpm build:mac:local

# For local macOS testing and install to /Applications/Owls Local.app
$ pnpm build:mac:local:install

# For Linux
$ pnpm build:linux
```
