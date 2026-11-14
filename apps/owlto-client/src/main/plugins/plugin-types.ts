export type PluginInterfaceMetadata = {
  displayName?: string
  shortDescription?: string
  longDescription?: string
  developerName?: string
  category?: string
  capabilities?: string[]
  defaultPrompt?: string[]
  brandColor?: string
  icon?: string
  composerIcon?: string
  logo?: string
  screenshots?: string[]
  websiteURL?: string
  privacyPolicyURL?: string
  termsOfServiceURL?: string
}

export type AgentHookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PermissionRequest'
  | 'PostToolUse'
  | 'Stop'

export type AgentCommandHook = {
  type: 'command'
  command: string
  timeout?: number
  statusMessage?: string
}

export type AgentHookMatcherGroup = {
  matcher?: string
  hooks: AgentCommandHook[]
}

export type AgentHookConfig = {
  hooks?: Partial<Record<AgentHookEventName, AgentHookMatcherGroup[]>>
  managed_dir?: string
  windows_managed_dir?: string
  requirements?: string
}

export type PluginHookSource =
  | {
      type: 'path' | 'default-path'
      path: string
      index: number
    }
  | {
      type: 'inline'
      index: number
    }

export type PluginHookEventSummary = {
  event: AgentHookEventName
  matcherGroupCount: number
  commandCount: number
}

export type PluginHookDeclaration = {
  source: PluginHookSource
  config: AgentHookConfig
  events: PluginHookEventSummary[]
  matcherGroupCount: number
  commandCount: number
}

export type PluginComponentPaths = {
  skills?: string
  mcpServers?: string
  apps?: string
  hooks?: string
  agents?: string
  bin?: string
}

export const AGENT_PLUGIN_SCHEMA_V1 = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
export const AGENT_PLUGIN_MCP_SCHEMA_V1 = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'
export const OWLTO_PLUGIN_EXTENSION_NAMESPACE = 'com.owlto.app'

export type PluginMcpStdioServer = {
  type: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export type PluginMcpHttpServer = {
  type: 'streamable-http'
  url: string
  headers?: Record<string, string>
}

export type PluginMcpServer = PluginMcpStdioServer | PluginMcpHttpServer

export type PluginMcpConfiguration = {
  schema: typeof AGENT_PLUGIN_MCP_SCHEMA_V1
  servers: Record<string, PluginMcpServer>
}

export type PluginLegacyRuntimeRequirements = {
  node?: string
}

export type PluginRuntimeComponentRequirement = {
  version: string
  reason?: string
}

export type PluginRuntimePackageRequirement = {
  name: string
  version: string
  reason?: string
}

export type PluginNativePackageRequirement = PluginRuntimePackageRequirement & {
  commands?: string[]
}

export type PluginRuntimeRequirements = {
  node?: PluginRuntimeComponentRequirement
  python?: PluginRuntimeComponentRequirement
  nodePackages?: PluginRuntimePackageRequirement[]
  pythonPackages?: PluginRuntimePackageRequirement[]
  nativePackages?: PluginNativePackageRequirement[]
  capabilities?: string[]
}

export type PluginPermissions = {
  filesystem?: Array<'read' | 'write'>
  shell?: 'allow' | 'prompt' | 'deny'
  network?: 'allow' | 'prompt' | 'deny'
}

export type PluginCommand = {
  name: string
  entry: string
  description?: string
}

export type PluginMarketplaceSkillSummary = {
  name: string
  qualifiedName?: string
  description: string
  filePath: string
  baseDir: string
  sourceKind: 'plugin'
  sourceLabel: string
  sourceRoot: string
  pluginId?: string
  pluginName: string
  pluginVersion?: string
  pluginRoot: string
  pluginScripts?: PluginCommand[]
  pluginCommands?: PluginCommand[]
}

export type PluginAuthCommand = {
  command: string
  args: string[]
  description?: string
}

export type PluginAuth = {
  login: PluginAuthCommand
  status: PluginAuthCommand
}

export type PluginAuthor = {
  name?: string
  email?: string
  url?: string
}

export type NormalizedPluginManifest = {
  schema: typeof AGENT_PLUGIN_SCHEMA_V1
  schemaVersion?: string
  name: string
  version: string
  description: string
  author?: PluginAuthor
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
  skills?: string
  mcpServers?: string
  apps?: string
  hooks?: string
  agents?: string
  bin?: string
  runtime?: PluginLegacyRuntimeRequirements
  runtimeRequirements?: PluginRuntimeRequirements
  permissions?: PluginPermissions
  auth?: PluginAuth
  scripts: PluginCommand[]
  commands: PluginCommand[]
  hookDeclarations: PluginHookDeclaration[]
  mcp?: PluginMcpConfiguration
  interface?: PluginInterfaceMetadata
  raw: Record<string, unknown>
}

export type PluginDiagnostic = {
  level: 'warning' | 'error'
  message: string
  path?: string
  /** False when the specification isolates the failure to one component or entry. */
  fatal?: boolean
}

export type PluginValidationStatus = {
  ok: boolean
  checkedAt: string
  errorCount: number
  warningCount: number
}

export type LoadedPluginManifest = {
  manifest: NormalizedPluginManifest
  pluginRoot: string
  manifestPath: string
  diagnostics: PluginDiagnostic[]
}

export type PluginMarketplaceSource = {
  type: 'local'
  path: string
}

export type PluginMarketplaceEntry = {
  name: string
  source: PluginMarketplaceSource
  scope: PluginMarketplaceScope
  interface?: PluginInterfaceMetadata
  iconUrl?: string
  description?: string
  keywords?: string[]
  version?: string
  auth?: PluginAuth
  skills?: PluginMarketplaceSkillSummary[]
  resolvedSourcePath?: string
  policy?: {
    installation?: 'AVAILABLE' | 'INSTALLED_BY_DEFAULT' | 'NOT_AVAILABLE'
    authentication?: 'ON_INSTALL' | 'ON_FIRST_USE'
  }
  category?: string
  marketplaceName: string
  marketplacePath: string
  marketplaceRoot: string
}

export type PluginMarketplaceScope = 'public' | 'internal'

export type PluginMarketplace = {
  name: string
  displayName: string
  scope: PluginMarketplaceScope
  path: string
  root: string
  plugins: PluginMarketplaceEntry[]
  diagnostics: PluginDiagnostic[]
}

export type PluginMarketplaceStatus = {
  available: boolean
  checkedAt: string
  availableVersion?: string
  message?: string
}

export type InstalledPluginSourceMetadata =
  | {
      installedFrom: 'marketplace'
      marketplaceName: string
      marketplacePath: string
      marketplaceRoot: string
      source: PluginMarketplaceSource
      resolvedSourcePath?: string
      resolvedSourceSha256?: string
      resolvedAt?: string
    }
  | {
      installedFrom: 'developer-upload'
      resolvedSourcePath: string
      resolvedZipSha256?: string
      resolvedAt?: string
      marketplaceName?: string
      marketplacePath?: string
      marketplaceRoot?: string
      source?: PluginMarketplaceSource
    }

export type InstalledPlugin = {
  id: string
  name: string
  version: string
  installedVersion: string
  enabled: boolean
  installedAt: string
  updatedAt: string
  marketplaceName: string
  source: PluginMarketplaceSource
  sourceMetadata: InstalledPluginSourceMetadata
  cachePath: string
  manifestPath: string
  manifest: NormalizedPluginManifest
  diagnostics: PluginDiagnostic[]
  validationStatus: PluginValidationStatus
  marketplaceStatus?: PluginMarketplaceStatus
}

export type PluginAuditAction =
  | 'install'
  | 'default-install'
  | 'auto-upgrade'
  | 'enable'
  | 'disable'
  | 'uninstall'
  | 'upgrade'
  | 'reinstall'
  | 'clear-installed'
  | 'marketplace-refresh'
  | 'validate'
  | 'validation-error'
  | 'command'
  | 'auth'
  | 'hook'

export type PluginAuditEvent = {
  id: string
  timestamp: string
  action: PluginAuditAction
  pluginId?: string
  pluginName?: string
  marketplaceName?: string
  level: 'info' | 'warning' | 'error'
  message: string
  details?: Record<string, unknown>
}

export type PluginMarketplaceRefreshResult = {
  refreshedAt: string
  marketplaces: PluginMarketplace[]
  available: PluginMarketplaceEntry[]
  installed: InstalledPlugin[]
}

export type DefaultPluginInstallResult = {
  installed: InstalledPlugin[]
  skipped: Array<{
    marketplaceName: string
    pluginName: string
    reason: 'already-installed' | 'already-auto-installed'
  }>
  failed: Array<{
    marketplaceName: string
    pluginName: string
    error: string
  }>
}

export type AutoPluginUpgradeResult = {
  upgraded: InstalledPlugin[]
  skipped: Array<{
    marketplaceName: string
    pluginName: string
    reason:
      | 'not-in-marketplace'
      | 'not-available'
      | 'up-to-date'
      | 'downgrade-available'
      | 'developer-upload'
  }>
  failed: Array<{
    marketplaceName: string
    pluginName: string
    error: string
  }>
}

export type PluginSkillSource = {
  pluginId: string
  pluginName: string
  pluginVersion: string
  pluginRoot: string
  rootPath: string
  label: string
  scripts: PluginCommand[]
  commands: PluginCommand[]
  hasRuntimeRequirements: boolean
}
