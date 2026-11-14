# RFC: Owlto Plugins (Superseded)

This RFC described the removed `.open-plugin/plugin.json` system and is retained only as a stable link target.

The current design and implementation contract are in [PLUGIN_SYSTEM.md](./PLUGIN_SYSTEM.md):

- Agent Plugins 1.0 root `plugin.json`
- fixed `skills/` discovery
- root `mcp.json` with stdio and Streamable HTTP support
- Owlto-only metadata under `extensions.com.owlto.app`
- Owlto hooks under `com.owlto.app/hooks/hooks.json`
- no Pi CLI Extensions or Pi Packages compatibility
