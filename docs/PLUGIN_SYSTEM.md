# RFC: Owlto Agent Plugin System

## Status

Proposed replacement contract for the partially implemented Owlto plugin system.

Owlto adopts the vendor-neutral [Agent Plugins Specification
1.0.0](https://agent-plugins.org/specification) as its portable package format.
The specification is currently a Working Draft, so Owlto must pin recognized
canonical schema identifiers and treat upgrades as explicit compatibility work.

This document supersedes the earlier `.open-plugin/plugin.json` package format.
It does not adopt Pi CLI Extensions, Pi Packages, Pi resource discovery, or the
Pi Coding Agent extension runtime.

## Decision Summary

1. A Owlto plugin is an Agent Plugin directory with a root `plugin.json`.
2. Owlto supports both portable Agent Plugins 1.0 component types: Agent Skills
   under `skills/` and MCP servers declared in root `mcp.json`.
3. Owlto validates against bundled, locally recognized Agent Plugins schemas. It
   never downloads a schema while loading a plugin.
4. Owlto retains ownership of local installation, catalog discovery, enablement,
   updates,
   trust, permissions, sandboxing, authentication, diagnostics, and UI.
5. Owlto-specific metadata and files use the stable `com.owlto.app` client
   extension namespace.
6. Owlto client extensions are Agent Plugins namespaced data. They are not Pi CLI
   Extensions and do not execute through Pi Coding Agent.
7. MCP tools enter the same Owlto tool registry, final approval gate, hooks,
   audit, and Seatbelt policy as built-in tools.
8. Owlto supports MCP `stdio` and `streamable-http`. Legacy `sse` is rejected as
   an isolated unsupported server entry.
9. The legacy `.open-plugin/plugin.json` manifest is removed after first-party
   plugins are converted. Owlto does not maintain two canonical package formats.

## Source of Truth

The external specifications own their portable contracts:

- [Agent Plugins Specification](https://agent-plugins.org/specification) owns
  package structure, manifest validation, component discovery, client
  extensions, MCP configuration, plugin variables, failure boundaries, and
  versioning.
- [Agent Skills](https://agentskills.io/) owns `SKILL.md` format and skill
  directory contents.
- [Model Context Protocol](https://modelcontextprotocol.io/specification/latest)
  owns MCP framing, initialization, capabilities, authorization, and lifecycle.

This RFC owns Owlto installation, policy, runtime mapping, security, persistence,
and user experience. If this document conflicts with a portable normative
requirement, the recognized Agent Plugins specification version wins for the
portable component. Owlto-only behavior must stay outside the portable core.

## Goals

- Load portable Agent Plugin packages without rearranging their skills or MCP
  configuration.
- Preserve Owlto's reviewed local installation and bundled catalog experience.
- Add first-class, lifecycle-managed MCP support.
- Route every model-visible MCP tool through Owlto approval and audit.
- Sandbox local MCP servers and isolate independent server failures.
- Preserve persistent plugin data across plugin updates.
- Give authors actionable validation and compatibility diagnostics.
- Keep Owlto hooks and other product-specific behavior in a namespaced extension.

## Non-Goals

- Do not support Pi CLI Extensions or Pi Packages.
- Do not load arbitrary JavaScript or TypeScript extension modules from a
  plugin.
- Do not add portable fields to root `plugin.json` beyond the Agent Plugins
  schema.
- Do not treat static MCP `env` or `headers` as a secret mechanism.
- Do not expose generic shell, filesystem, database, Keychain, or IPC access to
  plugins.
- Do not promise legacy HTTP+SSE support in the first release.
- Do not fetch remote plugin catalogs or install plugins from Git repositories,
  URLs, or remote archives.
- Do not define installation sources or Marketplace policy as part of the
  portable plugin manifest.
- Do not introduce Owlto runtime configuration through environment variables.

## Terminology

| Term | Definition |
| --- | --- |
| Agent Plugin | A portable directory conforming to a recognized Agent Plugins schema. |
| Plugin root | The filesystem-resolved directory containing root `plugin.json`. |
| Portable component | A skill or MCP server discovered at its Agent Plugins fixed location. |
| Owlto client extension | Owlto-owned data under `extensions.com.owlto.app` or files under `com.owlto.app/`. |
| Plugin cache | Rebuildable installed package contents for one resolved plugin version. |
| Plugin data | Persistent writable state for one installed plugin instance. |
| MCP manager | Owlto host service that validates, starts, connects, monitors, and stops MCP servers. |
| MCP tool adapter | The typed boundary that maps an MCP tool into a Owlto `AgentTool`. |

## Portable Package Layout

```text
my-plugin/
  plugin.json
  skills/
    review-pr/
      SKILL.md
      scripts/
      references/
      assets/
  mcp.json
  bin/
    review-server
  com.owlto.app/
    hooks/
      hooks.json
```

Rules:

- `plugin.json` is required and must be a regular file at the plugin root.
- `skills/` and `mcp.json` are optional fixed component locations.
- Skills are only the immediate child directories of `skills/` containing a
  regular `SKILL.md`. Owlto does not recursively discover nested skills.
- Owlto-specific files live under `com.owlto.app/`.
- Every discovered, read, or executed package path must remain inside the
  filesystem-resolved plugin root after symlink, junction, and reparse-point
  resolution.
- A missing optional component location is valid absence.

## Portable Manifest

Minimal root `plugin.json`:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "repo-reviewer"
}
```

Full Owlto-compatible example:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "repo-reviewer",
  "version": "1.0.0",
  "description": "Review repository changes with team rules.",
  "author": {
    "name": "Platform Team",
    "url": "https://example.com"
  },
  "homepage": "https://example.com/repo-reviewer",
  "repository": "https://example.com/repo-reviewer.git",
  "license": "MIT",
  "keywords": ["review", "repository"],
  "extensions": {
    "com.owlto.app": {
      "displayName": "Repository Reviewer",
      "category": "Engineering"
    }
  }
}
```

The root manifest is closed. Portable fields are limited to `$schema`, `name`,
`version`, `description`, `author`, `homepage`, `repository`, `license`,
`keywords`, and `extensions` for Agent Plugins 1.0. Owlto must not place `skills`,
`mcpServers`, `hooks`, `permissions`, `commands`, `scripts`, `bin`, `auth`, or UI
objects at the portable top level.

Manifest behavior:

- `$schema` and `name` are required.
- Owlto initially recognizes exactly the Agent Plugins 1.0 canonical plugin
  schema identifier.
- Plugin names follow the specification's lowercase name constraints.
- Unknown top-level fields are reported and ignored when the rest of the
  manifest is valid.
- A non-object `extensions` value is reported and ignored.
- Other schema violations reject the plugin before component discovery.
- Owlto ignores unimplemented client extension namespaces without validating
  their values.

Owlto bundles an audited copy of each recognized schema. Runtime loading selects
the local schema by exact canonical identifier and never fetches it from the
network.

## Owlto Client Extension

Portable Agent Plugins deliberately leave client-specific behavior undefined.
Owlto uses the reverse-domain namespace `com.owlto.app`.

Manifest data under `extensions.com.owlto.app` may provide presentation and
compatibility metadata validated by a versioned Owlto schema. Executable behavior
must not be embedded as code in the manifest.

Files under `com.owlto.app/` may contain Owlto-owned declarative contracts:

```text
com.owlto.app/
  hooks/
    hooks.json
  interface.json
  auth.json
```

Initial behavior:

- `hooks/hooks.json` follows `docs/CODEX_AGENT_HOOKS.md`.
- `interface.json` may contain Owlto Marketplace and renderer presentation
  metadata that does not belong in the portable manifest.
- `auth.json` may declare a Owlto-managed authentication flow, but never contains
  credentials.

Each Owlto extension document has its own closed schema, diagnostics, and failure
boundary. An invalid Owlto extension disables only that Owlto-specific capability
unless it makes the package unsafe to load. Portable skills and MCP servers
remain governed by their own validation results.

## Skills

Owlto discovers portable skills from `skills/<skill-name>/SKILL.md` and validates
them against the Agent Skills contract supported by the app.

Rules:

- Skip one invalid skill and continue loading valid siblings.
- Resolve skill references and assets within the skill and plugin boundaries.
- Sort discovered skills deterministically before displaying them or adding
  them to model context.
- A plugin must be installed and enabled before its skills become active.
- A skill does not gain shell, filesystem, network, Keychain, or native access
  merely because its plugin is trusted.
- Skill scripts run only through an explicit Owlto tool or MCP boundary; skill
  prose cannot directly execute a bundled file.

## MCP Configuration

Plugin-owned MCP configuration lives only at root `mcp.json`. It is not inline
in `plugin.json` or discovered from another portable path. Users may also add
standalone MCP servers in Settings > Customize; those records are persisted by
Owlto and do not modify an installed plugin.

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "local-review": {
      "type": "stdio",
      "command": "./bin/review-server",
      "args": ["--data", "${PLUGIN_DATA}/review"],
      "env": {
        "CONFIG": "${PLUGIN_ROOT}/config/review.json"
      },
      "cwd": "${PLUGIN_ROOT}"
    },
    "remote-review": {
      "type": "streamable-http",
      "url": "https://review.example.com/mcp",
      "headers": {
        "X-Client": "owlto"
      }
    }
  }
}
```

Top-level rules:

- `$schema` and `mcpServers` are required and no other top-level fields are
  allowed.
- The MCP schema version must match the Agent Plugins version selected by
  `plugin.json`.
- A top-level parse, schema, or version failure disables MCP for that plugin but
  does not disable valid skills or Owlto client extensions.
- Each server entry is validated independently. An invalid entry disables only
  that server.

### Supported Transports

Owlto supports:

- `stdio` with one executable `command` token and separate `args`.
- `streamable-http` with an absolute endpoint URL and optional literal headers.

Standalone user configuration exposes the same two transports as `stdio` and
Remote. Owlto discovers Remote authentication requirements through the MCP
handshake. If the server requires OAuth, Owlto performs the protocol flow and
stores the resulting credentials securely; users do not select an auth mode in
the server configuration.

Owlto does not initially support the deprecated `sse` transport. It reports that
entry as unsupported and continues loading other entries and components.

Owlto uses the transport declared by `type` for the initial connection. It does
not silently fall back to a different transport.

### Stdio Runtime

For a stdio server, Owlto must:

1. Resolve a bare executable using the platform search policy, or resolve a
   `./` command inside the plugin root.
2. Treat `command` as one token and never pass it through a shell command
   parser.
3. Pass `args` as an argument vector.
4. Default `cwd` to the plugin root.
5. Create a dedicated writable plugin-data directory before launch.
6. Expand `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` once, non-recursively, only in
   `args`, `env` values, and `cwd`.
7. Set protocol-required `PLUGIN_ROOT` and `PLUGIN_DATA` child-process variables
   last so plugin configuration cannot override them.
8. Reject a `cwd` or package-relative executable that escapes its permitted
   root after filesystem resolution.
9. Launch the server through the Owlto MCP process manager under a base Seatbelt
   profile.
10. Complete MCP initialize and capability negotiation before exposing tools,
    resources, or prompts.

`PLUGIN_ROOT` and `PLUGIN_DATA` are output metadata required by the Agent
Plugins subprocess contract. Owlto does not read them as application runtime
configuration, accept user overrides for them, or use environment variables to
select Owlto data roots or settings.

### Streamable HTTP Runtime

For a Streamable HTTP server, Owlto must:

- Require an absolute HTTP or HTTPS URL without user information or fragments.
- Require HTTPS for non-loopback hosts.
- Validate literal headers and reject case-insensitive duplicate names.
- Never expand placeholders or environment variables in URLs or headers.
- Never forward configured headers to a different origin across redirects
  without explicit user authorization.
- Follow MCP Streamable HTTP initialization, session, and lifecycle behavior.
- Keep client-generated protocol and authorization headers authoritative over
  package-provided literal headers.

## MCP Authentication

Agent Plugins 1.0 intentionally defines no portable OAuth or credential
reference fields. Owlto owns remote MCP authentication:

- Discover and perform supported MCP authorization flows through a Owlto-owned
  service.
- Store tokens and credentials in Keychain, never in `plugin.json`, `mcp.json`,
  static headers, logs, SQLite messages, or prompts.
- Bind credentials to the installed plugin identity, server name, and endpoint
  origin.
- Ask before forwarding authorization across an origin change.
- Treat authentication failure as a server connection failure rather than an
  invalid plugin package.
- Expose login, reconnect, disconnect, and credential-removal actions through
  narrow typed IPC.

Local stdio server secrets must also come from a Owlto-owned credential bridge,
not portable `env` values. The bridge requires a separate typed design before a
plugin can request secrets.

## MCP Capability Mapping

After initialization, the MCP manager records the server's negotiated
capabilities.

### Tools

MCP tools are adapted into the Owlto tool registry with deterministic identities:

```text
mcp__<plugin-name>__<server-name>__<tool-name>
```

The model-facing schema is derived from the MCP tool input schema, validated at
registration, and revalidated immediately before invocation.

Every MCP tool call follows the normal Owlto lifecycle:

```text
model tool call
  -> Owlto PreToolUse hooks
  -> allowed input update
  -> final schema validation
  -> Owlto risk and permission classification
  -> user approval or remembered policy
  -> MCP call
  -> normalized result and audit
  -> Owlto PostToolUse hooks
  -> model-facing result
```

An MCP server cannot mark its own tool trusted or bypass the final host gate.
Tool-list changes trigger deterministic registry reconciliation and collision
diagnostics.

### Resources and Prompts

Owlto may expose MCP resources and prompts through typed host capabilities after
capability negotiation. They are not automatically inserted into model context.

- Resource reads require explicit invocation and size/content limits.
- Prompt templates are namespaced by plugin and server.
- Binary and large results use Owlto attachment or artifact storage rather than
  unbounded IPC payloads.
- Resource and prompt errors remain isolated to the originating server.

## Security Model

Installing a plugin permits Owlto to inspect its declarative package. Enabling a
plugin permits its validated skills and configured servers to become available.
Neither action grants unrestricted machine access.

Before first activation, Owlto shows:

- Plugin source, resolved version, and integrity.
- Portable skills and MCP servers.
- Local executables and remote endpoint origins.
- Requested filesystem, network, and native capabilities inferred by Owlto.
- Owlto-specific hooks or authentication behavior.

Local MCP servers receive a base Seatbelt profile. A tool-call approval can add
a one-time grant bound to finalized input, but permanent denies remain stronger.
Because an MCP process may perform work outside an individual tool call, tool
approval alone is not a sandbox; server startup, filesystem, network, and child
process capabilities require host policy.

Remote servers never receive filesystem or native host access. Their network
origin, redirects, credentials, request limits, and returned content remain
subject to Owlto policy.

## MCP Lifecycle and Failure Isolation

The MCP manager owns these states:

```text
disabled -> starting -> connecting -> ready
                      -> auth-required
                      -> failed
ready -> reconnecting -> ready | failed
ready | failed -> stopping -> stopped
```

Requirements:

- Start servers lazily when an enabled plugin's MCP capabilities are needed,
  unless a product flow explicitly requires eager readiness.
- Cancel startup and outstanding calls when the plugin is disabled or removed.
- Stop child processes, transports, listeners, timers, and pending dialogs on
  app shutdown.
- Bound restart attempts and use backoff; never create an infinite crash loop.
- Redact credentials, headers, prompt content, and private payloads from logs.
- Preserve independent failure boundaries: one failed server does not disable
  sibling servers, skills, or Owlto client extensions.
- Surface validation, launch, authentication, handshake, capability, runtime,
  and shutdown failures separately.

## Installation and Distribution

Agent Plugins does not prescribe installation or catalog behavior. Owlto keeps a
local-only product-owned installation pipeline:

```text
Bundled or runtime-local catalog
  -> resolved source and integrity
  -> immutable plugin cache
  -> Agent Plugins validation
  -> installed and enabled state
  -> persistent plugin data
  -> active skills and MCP servers
```

Supported plugin sources are bundled directories, active-runtime directories,
and explicit local developer uploads. Owlto does not fetch remote plugin
marketplaces, clone plugin repositories, or download plugin archives. Source
resolution and integrity remain separate from root `plugin.json`.

Local developer ZIP uploads are treated as untrusted input. Owlto streams each
regular file into a fresh temporary extraction root and rejects absolute or
escaping paths, backslashes, symbolic links, and other special files. An upload
is also rejected when the ZIP exceeds 256 MiB, contains more than 20,000
entries, contains a file larger than 256 MiB, expands beyond 1 GiB in total, or
contains an entry with a compression ratio above 200:1. Both declared and
actual streamed sizes are checked.

Recommended data layout:

```text
{dataRoot}/plugins/
  cache/<source-id>/<plugin-name>/<resolved-version>/
  data/<installed-plugin-id>/
  logs/<installed-plugin-id>/
  tmp/
```

The cache is rebuildable. Plugin data persists across updates and may be
removed on explicit uninstall. Runtime paths derive from Owlto settings and
bootstrap paths, not environment variables.

## Renderer and IPC

The plugin UI should show:

- Agent Plugins schema and plugin version.
- Source, resolved revision, and integrity.
- Installed, enabled, update, and trust state.
- Skills and their validation diagnostics.
- MCP servers, transport, endpoint or executable, status, capabilities, and
  failure reason.
- Authentication and reconnect state.
- Owlto client-extension features and diagnostics.

Renderer APIs remain narrow. They may install, enable, disable, remove, inspect,
connect, disconnect, authenticate, and retry named plugins or servers. They must
not expose generic process spawning, raw MCP transport, arbitrary filesystem,
database, Keychain, or registry primitives.

All event subscriptions return unsubscribe functions. Disable, uninstall, and
window teardown cancel relevant pending UI operations.

## Legacy Owlto Plugin Migration

The previous package format used `.open-plugin/plugin.json` and Owlto-specific
top-level component declarations. It is not an Agent Plugins package.

Migration policy:

1. Convert every bundled Owlto plugin to root `plugin.json`, fixed `skills/`, and
   root `mcp.json` where executable capabilities are required.
2. Move hooks and presentation/auth metadata into `com.owlto.app`.
3. Replace manifest-declared scripts and CLI tools with MCP servers or
   explicitly Owlto-owned host capabilities.
4. Update local catalog entries to resolve Agent Plugin directories without
   duplicating the portable manifest.
5. Revalidate installed packages by source and identity. An unconverted legacy
   package is marked incompatible and is not executed.
6. Preserve its plugin-data directory until explicit uninstall or a reviewed
   migration consumes it.
7. Remove the legacy loader, schema, validator branches, and documentation after
   first-party conversion. Do not retain permanent dual-manifest support.

## Implementation Plan

### Phase 0: Contract and Inventory

- Bundle and verify Agent Plugins 1.0 plugin and MCP schemas.
- Define the `com.owlto.app` manifest and file schemas.
- Inventory bundled plugins and map skills, hooks, scripts, CLI tools, auth, and
  UI metadata to the new package model.
- Record current install, enable, skill, hook, and local catalog behavior in tests.

### Phase 1: Portable Loader

- Load only root `plugin.json`.
- Enforce filesystem-resolved package boundaries.
- Implement Agent Plugins manifest validation and failure semantics.
- Discover and validate immediate `skills/` children.
- Parse Owlto client-extension data while ignoring unknown namespaces.
- Convert bundled plugins and update local catalog resolution.

### Phase 2: MCP Runtime

- Implement closed `mcp.json` validation with independent server validation.
- Implement stdio and Streamable HTTP transports.
- Add plugin data directories, variable expansion, path containment, process
  cleanup, health, bounded restart, and diagnostics.
- Implement MCP initialization and capability negotiation.
- Add Owlto-managed authorization and Keychain storage for remote MCP servers.

### Phase 3: Agent and UI Integration

- Adapt MCP tools into the central Owlto tool registry.
- Route MCP tools through hooks, schema validation, approval, audit, and result
  normalization.
- Add plugin and MCP management UI with localized copy.
- Add resources and prompts through typed Owlto APIs where product flows require
  them.
- Remove the legacy plugin loader and inactive MCP metadata paths.

### Phase 4: Conformance and Hardening

- Run the Agent Plugins 1.0 conformance checklist against Owlto.
- Test packaged-app executable resolution and Seatbelt behavior.
- Test local-plugin and remote-MCP partial-failure, authentication, restart,
  disable, uninstall, and update flows.
- Verify no Pi CLI Extension or Pi Package discovery remains.

## Verification Strategy

### Portable Package

- Required and optional manifest fields.
- Unknown-field and non-object-extension non-fatal behavior.
- Fatal manifest rejection before discovery.
- Exact schema identifier selection without network retrieval.
- Name constraints and version matching.
- Symlink, junction, reparse-point, and path traversal containment.
- Immediate-child skill discovery and per-skill failure isolation.
- Unknown client extension namespaces are ignored without validation.

### MCP Configuration

- Top-level failure disables only MCP for the plugin.
- Invalid entries disable only themselves.
- Unsupported `sse` entries do not block siblings.
- Stdio command token handling, argument vectors, default cwd, plugin variables,
  and reserved-variable protection.
- Streamable HTTP URL, HTTPS, literal header, duplicate header, redirect, and
  origin enforcement.
- Plugin and MCP schema versions match.

### Runtime and Security

- Initialization, capability negotiation, list changes, calls, cancellation,
  shutdown, and bounded restart.
- Every MCP tool crosses the final Owlto gate exactly once.
- Mutated inputs are revalidated before the MCP call.
- Approval and Seatbelt correlation mismatches fail closed.
- Local MCP processes cannot escape their base sandbox or permitted roots.
- Remote authentication remains in Keychain and secrets are absent from logs,
  manifests, SQLite transcripts, and renderer payloads.
- One failed or compromised component cannot obtain generic Electron-main
  capabilities.

### Product Behavior

- Install, update, enable, disable, uninstall, and plugin-data retention.
- Local catalog source and integrity handling.
- Skill list and invocation.
- Hook execution through `com.owlto.app`.
- MCP status, authentication, reconnect, diagnostics, and tool rendering.
- Existing SQLite messages, search, approvals, artifacts, and human-input flows
  remain unchanged.

## Release Gate

Owlto may claim Agent Plugins 1.0 support only after it satisfies all applicable
normative requirements for both skills and MCP servers. Until then, the UI must
label the feature preview and report unsupported components honestly.

Production activation is blocked unless:

- Bundled plugins use the new format.
- Legacy manifests cannot execute.
- Skills and MCP failure boundaries pass tests.
- Stdio and Streamable HTTP lifecycle tests pass in a packaged build.
- Every MCP tool is covered by approval, audit, and the final gate.
- Local MCP servers run under an enforceable base sandbox.
- Remote credentials are stored and redacted correctly.
- Disabling or uninstalling a plugin reliably stops all of its servers.

## Open Questions

- Should Owlto publish its `com.owlto.app` client-extension schemas for other
  clients to inspect, even though only Owlto executes them?
- Which MCP resources and prompts should be user-visible in the first release?
- Should legacy HTTP+SSE ever be supported, or remain intentionally absent?
- Which local MCP server capabilities require install-time trust in addition to
  per-tool approval?

These questions do not change the central decisions: Owlto uses the Agent Plugins
portable package format, retains its own product and security runtime, supports
MCP as a first-class component, and does not support Pi CLI Extensions.
