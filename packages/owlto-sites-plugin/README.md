# Owlto Sites Plugin

Source package for the bundled `sites` Owlto plugin.

The plugin package lives in `plugin/`. Treat it as the source of truth.

In development, Owlto rewrites the bundled `sites` marketplace entry to this
source package directly, so `pnpm dev` uses the files under `plugin/`.

In packaged builds, `apps/owlto-client/scripts/electron-builder-config.cjs`
copies this same `plugin/` directory into the app artifact at
`plugins/plugins/sites`.

Edit `plugin/` only. Do not create or maintain a generated copy under
`apps/owlto-client/resources/plugins/plugins/sites`.
