# Legacy Pi runtime

This folder keeps the pre-pivot Owls app, built on its own Pi agent runtime,
for reference. Nothing here is built, type-checked, linted, or tested, and the
current app does not import it.

- `src/` mirrors the original `apps/pichu-client/src/` paths. It holds the old
  agent loop, tools, IPC handlers, stores, plugin runtime, local RPC, preload
  bridge (`window.api`), and renderer app.
- `tests/` holds the tests that covered this code, with the same layout as
  `apps/pichu-client/tests/`.

The code was written against `@earendil-works/pi-agent-core`, `pi-ai`, and
`pi-coding-agent` `0.84.1`. The current app depends on pi `1.x` for the Router
([RFC](../../../docs/RFC_OWLS_SUPER_AGENT.md)), so this code does not compile
against the installed packages. Imports into files that stayed in
`apps/pichu-client/src/` (such as `pichu-paths.ts` or `components/ui/*`) no
longer resolve from here.

The old database schema stays at `src/main/db/schema.ts` in this folder;
`drizzle.config.ts` and the root `drizzle/` migrations still point at it.

Do not add new code here. To bring a piece back, move it into
`apps/pichu-client/src/`, port it to the current runtime, and give it tests.
