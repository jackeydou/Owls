# Owls Sites Plugin

Source package for the bundled `sites` Owls plugin.

The plugin package lives in `plugin/`. Treat it as the source of truth.

In development, Owls rewrites the bundled `sites` marketplace entry to this
source package directly, so `pnpm dev` uses the files under `plugin/`.

In packaged builds, `apps/pichu-client/scripts/electron-builder-config.cjs`
copies this same `plugin/` directory into the app artifact at
`plugins/plugins/sites`.

Edit `plugin/` only. Do not create or maintain a generated copy under
`apps/pichu-client/resources/plugins/plugins/sites`.
