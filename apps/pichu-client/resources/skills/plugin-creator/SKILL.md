---
name: plugin-creator
description: Create Agent Plugins 1.0 packages for Owls with fixed skills, optional MCP servers, Owls hooks, assets, scripts, and bundled marketplace metadata.
---

# Plugin Creator

Create Owls plugins as Agent Plugins 1.0 packages. Do not create Pi CLI extensions or legacy `.open-plugin` manifests.

## Quick start

From the repository root:

```bash
python3 apps/pichu-client/resources/skills/plugin-creator/scripts/create_basic_plugin.py my-plugin \
  --with-skills --with-mcp --with-hooks --with-assets --with-marketplace
```

The script normalizes the plugin name to lower-case hyphen-case and creates the package under `apps/pichu-client/resources/plugins/plugins/<plugin-name>` by default. Use `--path <parent-directory>` to choose a different parent and `--force` only when overwriting is intentional.

## Package contract

Every package has this layout:

```text
my-plugin/
  plugin.json
  skills/                         # optional, discovered automatically
  mcp.json                        # optional, discovered automatically
  com.pichu.app/hooks/
    hooks.json                    # optional Owls extension
  scripts/                        # optional Owls extension assets
  assets/                         # optional presentation assets
```

`plugin.json` must declare the Agent Plugins 1.0 schema. Portable identity fields stay at the root. Owls-only metadata belongs under `extensions.com.pichu.app`. Do not add `skills`, `mcpServers`, or `hooks` path fields: Owls uses the fixed locations above.

`mcp.json` must declare the Agent Plugins MCP 1.0 schema. Owls supports `stdio` and `streamable-http`. Use `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` only where the MCP schema permits them; plugin code must not override those reserved values.

See `references/plugin-json-spec.md` for the canonical examples.

## Marketplace workflow

Pass `--with-marketplace` to create or update `apps/pichu-client/resources/plugins/marketplace.json`. New entries default to:

- `policy.installation: "AVAILABLE"`
- `policy.authentication: "ON_INSTALL"`
- `category: "Productivity"`

Keep marketplace policy outside `plugin.json`. Preserve marketplace order and existing `interface.displayName`. Add `policy.products` only when the user explicitly requests product gating.

## Required behavior

- Keep the folder name and `plugin.json` name identical.
- Keep root `plugin.json` present.
- Never generate `.open-plugin`, Pi CLI extension entrypoints, or `.mcp.json`.
- Keep placeholders until a human or follow-up task supplies real metadata.
- Run Owls plugin validation after editing the scaffold.
