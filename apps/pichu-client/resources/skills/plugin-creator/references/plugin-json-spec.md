# Agent Plugin sample

`plugin.json` lives at the package root:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "plugin-name",
  "version": "1.2.0",
  "description": "Brief plugin description",
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://example.com"
  },
  "homepage": "https://example.com/plugin",
  "repository": "https://github.com/author/plugin",
  "license": "MIT",
  "keywords": ["keyword1", "keyword2"],
  "extensions": {
    "com.pichu.app": {
      "interface": {
        "displayName": "Plugin Display Name",
        "shortDescription": "Short description",
        "longDescription": "Long description",
        "developerName": "Owls",
        "category": "Productivity",
        "websiteURL": "https://example.com/",
        "defaultPrompt": ["Use this plugin to complete the task."],
        "composerIcon": "./assets/icon.png",
        "logo": "./assets/logo.png"
      }
    }
  }
}
```

Portable components use fixed locations:

- skills: `skills/`
- MCP configuration: `mcp.json`
- Owls hooks: `com.pichu.app/hooks/hooks.json`

Do not declare those paths in `plugin.json`.

## MCP sample

`mcp.json` lives at the package root:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "local": {
      "type": "stdio",
      "command": "./bin/server",
      "args": ["--data", "${PLUGIN_DATA}/state"],
      "cwd": "${PLUGIN_ROOT}"
    },
    "remote": {
      "type": "streamable-http",
      "url": "https://example.com/mcp"
    }
  }
}
```

Owls injects `PLUGIN_ROOT` and `PLUGIN_DATA`. A plugin must not override them in `env`.

## Marketplace entry

```json
{
  "name": "plugin-name",
  "source": {
    "source": "local",
    "path": "./plugins/plugins/plugin-name"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```
