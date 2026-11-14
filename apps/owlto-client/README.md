# Owlto Client

Electron desktop workspace powered by a locally installed Codex app-server.

The production entries are `src/main/app/desktop.ts`,
`src/preload/owlto.ts`, and `src/renderer/src/app/App.tsx`.
The previous Pi entry is not loaded.

From the repository root:

```bash
pnpm install
pnpm dev --owlto-dev-name "Codex Orchestrator" \
  --owlto-data-root ~/.owlto-dev/codex-orchestrator
```

Use Settings to connect your local Codex sign-in. No Owlto model API key is needed.

See the root [README](../../README.md) and
[Codex runtime guide](../../docs/CODEX_APP_SERVER.md) for configuration and tests.
