# Owls Client

Electron desktop workspace powered by a locally installed Codex app-server.

The production entries are `src/main/codex/desktop.ts`,
`src/preload/codex.ts`, and `src/renderer/src/codex/App.tsx`.
The previous Pi entry is not loaded.

From the repository root:

```bash
pnpm install
pnpm dev --owls-dev-name "Codex Orchestrator" \
  --owls-data-root ~/.owls-dev/codex-orchestrator
```

Use Settings to connect your local Codex sign-in. No Owls model API key is needed.

See the root [README](../../README.md) and
[Codex runtime guide](../../docs/CODEX_APP_SERVER.md) for configuration and tests.
