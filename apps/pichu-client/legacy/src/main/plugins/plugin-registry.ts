import { readFileSync } from 'node:fs'
import {
  appendFile,
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PLUGIN_ADMIN_LOCAL_DEV_MARKETPLACE_NAME } from '../../shared/plugin-admin.js'
import { getDataRoot } from '../pichu-paths.js'
import { loadPluginManifestAsync, resolvePluginComponentPathAsync } from './manifest-loader.js'
import {
  listAvailablePluginEntries,
  listPluginMarketplaces,
  resolveMarketplaceSource
} from './marketplace-loader.js'
import { disposePluginMcpRuntimeAsync, stopPluginMcpServersAsync } from './mcp-runtime.js'
import {
  PluginAuthCancelledError,
  PluginAuthError,
  type PluginAuthLoginResult,
  type PluginAuthRunOptions,
  runPluginAuthLoginAsync
} from './plugin-auth-runner.js'
import { isPluginHiddenFromUsers } from './plugin-exposure.js'
import { computePluginSourceSha256, isIgnoredPluginSourcePath } from './plugin-source-digest.js'
import type {
  AutoPluginUpgradeResult,
  DefaultPluginInstallResult,
  InstalledPlugin,
  LoadedPluginManifest,
  PluginAuditAction,
  PluginAuditEvent,
  PluginDiagnostic,
  PluginHookDeclaration,
  PluginMarketplaceEntry,
  PluginMarketplaceRefreshResult,
  PluginMarketplaceStatus,
  PluginMcpServer,
  PluginSkillSource,
  PluginValidationStatus
} from './plugin-types.js'
import { AGENT_PLUGIN_SCHEMA_V1 } from './plugin-types.js'
import { type PluginValidationResult, validatePluginPackageAsync } from './plugin-validator.js'

type RegistryFile = {
  plugins: InstalledPlugin[]
  autoInstalledPlugins: string[]
}

export type EnabledPluginHookDeclaration = {
  pluginId: string
  pluginName: string
  pluginVersion: string
  marketplaceName?: string
  pluginRoot: string
  hookDeclarations: PluginHookDeclaration[]
}

let registryCache: RegistryFile | null = null
let registryWriteQueue: Promise<void> = Promise.resolve()

function pluginDataRoot(): string {
  return join(getDataRoot(), 'plugins')
}

function cacheRoot(): string {
  return join(pluginDataRoot(), 'cache')
}

function logsRoot(): string {
  return join(pluginDataRoot(), 'logs')
}

function runtimeDataRoot(): string {
  return join(pluginDataRoot(), 'data')
}

export function pluginRuntimeDataPath(plugin: Pick<InstalledPlugin, 'name'>): string {
  return join(runtimeDataRoot(), plugin.name.replace(/[^a-zA-Z0-9._-]/g, '_'))
}

export type EnabledPluginMcpServer = {
  source?: 'plugin' | 'custom'
  pluginId: string
  pluginName: string
  pluginVersion: string
  pluginRoot: string
  pluginDataRoot: string
  serverName: string
  server: PluginMcpServer
}

async function replacePluginCacheDirectory(
  sourcePath: string,
  destination: string
): Promise<{
  installedManifest: LoadedPluginManifest
  validation: PluginValidationResult
}> {
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  try {
    await cp(sourcePath, destination, {
      recursive: true,
      dereference: false,
      filter: (src) => !isIgnoredPluginSourcePath(sourcePath, src)
    })
    return {
      installedManifest: await loadPluginManifestAsync(destination),
      validation: await validatePluginPackageAsync(destination)
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}

function legacyInternalRegistryPath(): string {
  return join(getDataRoot(), 'internal-plugins', 'installed.json')
}

function auditLogPath(): string {
  return join(logsRoot(), 'plugin-events.jsonl')
}

function registryPath(): string {
  return join(pluginDataRoot(), 'installed.json')
}

async function ensurePluginDirsAsync(): Promise<void> {
  await mkdir(pluginDataRoot(), { recursive: true })
  await mkdir(cacheRoot(), { recursive: true })
  await mkdir(logsRoot(), { recursive: true })
}

function validationStatus(
  diagnostics: PluginDiagnostic[],
  checkedAt = new Date().toISOString()
): PluginValidationStatus {
  return {
    ok: diagnostics.every(
      (diagnostic) => diagnostic.level !== 'error' || diagnostic.fatal === false
    ),
    checkedAt,
    errorCount: diagnostics.filter((diagnostic) => diagnostic.level === 'error').length,
    warningCount: diagnostics.filter((diagnostic) => diagnostic.level === 'warning').length
  }
}

function hasRunnableAuth(plugin: InstalledPlugin): boolean {
  const auth = plugin.manifest.auth
  if (!auth) return false

  const commandNames = new Set(plugin.manifest.commands.map((command) => command.name))
  return commandNames.has(auth.login.command) && commandNames.has(auth.status.command)
}

function pluginCommandShimRoot(plugin: InstalledPlugin): string {
  return join(plugin.cachePath, '.tmp', 'command-shims')
}

function pluginCommandShimTmpRoot(plugin: InstalledPlugin): string {
  return join(plugin.cachePath, '.tmp')
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

async function removeFileOrDirectoryAsync(path: string): Promise<void> {
  const pathStat = await lstat(path)
  if (pathStat.isSymbolicLink()) {
    await unlink(path)
    return
  }
  await rm(path, { recursive: pathStat.isDirectory(), force: true })
}

async function ensurePluginCommandShimRootAsync(plugin: InstalledPlugin): Promise<string> {
  const tmpRoot = pluginCommandShimTmpRoot(plugin)
  try {
    const tmpStat = await lstat(tmpRoot)
    if (tmpStat.isSymbolicLink() || !tmpStat.isDirectory()) {
      await removeFileOrDirectoryAsync(tmpRoot)
    }
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
  }
  await mkdir(tmpRoot, { recursive: true })

  const shimRoot = pluginCommandShimRoot(plugin)
  try {
    await removeFileOrDirectoryAsync(shimRoot)
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
  }
  await mkdir(shimRoot, { recursive: true })
  return shimRoot
}

async function preparePluginCommandShimsAsync(plugin: InstalledPlugin): Promise<string | null> {
  if (plugin.manifest.commands.length === 0) return null
  if (process.platform === 'win32') return null

  const shimRoot = await ensurePluginCommandShimRootAsync(plugin)
  for (const command of [...plugin.manifest.commands].sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const entryPath = await resolvePluginComponentPathAsync(plugin.cachePath, command.entry)
    const shimPath = join(shimRoot, command.name)
    await writeFile(shimPath, `#!/bin/sh\nexec ${shellQuote(entryPath)} "$@"\n`, 'utf8')
    await chmod(shimPath, 0o755)
  }

  return shimRoot
}

function sourceMetadata(
  entry: PluginMarketplaceEntry,
  resolved: {
    path: string
    resolvedSourceSha256?: string
  }
): InstalledPlugin['sourceMetadata'] {
  return {
    installedFrom: 'marketplace',
    marketplaceName: entry.marketplaceName,
    marketplacePath: entry.marketplacePath,
    marketplaceRoot: entry.marketplaceRoot,
    source: entry.source,
    resolvedSourcePath: resolved.path,
    resolvedSourceSha256: resolved.resolvedSourceSha256,
    resolvedAt: new Date().toISOString()
  }
}

function fallbackSourceMetadata(plugin: InstalledPlugin): InstalledPlugin['sourceMetadata'] {
  if (plugin.sourceMetadata?.installedFrom === 'developer-upload') {
    return plugin.sourceMetadata
  }
  return {
    installedFrom: 'marketplace',
    marketplaceName: plugin.marketplaceName,
    marketplacePath: '',
    marketplaceRoot: '',
    source: plugin.source,
    resolvedSourcePath: plugin.cachePath
  }
}

function normalizeInstalledPlugin(plugin: InstalledPlugin): InstalledPlugin {
  const compatible = plugin.manifest?.schema === AGENT_PLUGIN_SCHEMA_V1
  const incompatibilityMessage = `Installed package must be reinstalled as Agent Plugins 1.0 (${AGENT_PLUGIN_SCHEMA_V1})`
  const diagnostics = [
    ...(plugin.diagnostics ?? []),
    ...(!compatible &&
    !(plugin.diagnostics ?? []).some((entry) => entry.message === incompatibilityMessage)
      ? [{ level: 'error' as const, message: incompatibilityMessage }]
      : [])
  ]
  const now = new Date().toISOString()
  const name = plugin.name.trim()
  const legacyDeveloperUpload =
    plugin.marketplaceName === PLUGIN_ADMIN_LOCAL_DEV_MARKETPLACE_NAME ||
    plugin.sourceMetadata?.installedFrom === 'developer-upload'
  const sourceMetadata: InstalledPlugin['sourceMetadata'] = legacyDeveloperUpload
    ? plugin.sourceMetadata?.installedFrom === 'developer-upload'
      ? plugin.sourceMetadata
      : {
          installedFrom: 'developer-upload',
          resolvedSourcePath: plugin.cachePath,
          resolvedAt: plugin.updatedAt
        }
    : (plugin.sourceMetadata ?? fallbackSourceMetadata(plugin))
  return {
    id: name,
    name,
    version: plugin.version,
    installedVersion: plugin.installedVersion ?? plugin.version,
    enabled: plugin.enabled,
    installedAt: plugin.installedAt,
    updatedAt: plugin.updatedAt,
    marketplaceName: legacyDeveloperUpload ? '' : plugin.marketplaceName,
    source: plugin.source,
    sourceMetadata,
    cachePath: plugin.cachePath,
    manifestPath: plugin.manifestPath,
    manifest: plugin.manifest,
    diagnostics,
    validationStatus:
      compatible && plugin.validationStatus
        ? plugin.validationStatus
        : validationStatus(diagnostics),
    marketplaceStatus: plugin.marketplaceStatus ?? {
      available: true,
      checkedAt: now,
      availableVersion: plugin.version
    }
  }
}

function normalizeRegistry(raw: unknown): RegistryFile {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('plugins' in raw) ||
    !Array.isArray((raw as { plugins?: unknown }).plugins)
  ) {
    return { plugins: [], autoInstalledPlugins: [] }
  }

  const rawAutoInstalledPlugins = (raw as { autoInstalledPlugins?: unknown }).autoInstalledPlugins
  const autoInstalledPlugins = Array.isArray(rawAutoInstalledPlugins)
    ? rawAutoInstalledPlugins.filter(
        (pluginId): pluginId is string => typeof pluginId === 'string' && Boolean(pluginId.trim())
      )
    : []

  return {
    plugins: (raw as RegistryFile).plugins.map(normalizeInstalledPlugin),
    autoInstalledPlugins: [...new Set(autoInstalledPlugins)]
  }
}

async function mergeLegacyInternalRegistry(registry: RegistryFile): Promise<RegistryFile> {
  try {
    const raw = JSON.parse(await readFile(legacyInternalRegistryPath(), 'utf8')) as unknown
    const legacy = normalizeRegistry(raw)
    if (legacy.plugins.length === 0) return registry

    const pluginsByName = new Map(registry.plugins.map((plugin) => [plugin.name, plugin]))
    for (const plugin of legacy.plugins) {
      pluginsByName.set(plugin.name, normalizeInstalledPlugin(plugin))
    }
    return {
      ...registry,
      plugins: [...pluginsByName.values()].sort((left, right) =>
        left.name.localeCompare(right.name)
      ),
      autoInstalledPlugins: [
        ...new Set([...registry.autoInstalledPlugins, ...legacy.autoInstalledPlugins])
      ]
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return registry
    }
    throw error
  }
}

async function readRegistryAsync(): Promise<RegistryFile> {
  if (registryCache) {
    return registryCache
  }
  await ensurePluginDirsAsync()
  try {
    const raw = JSON.parse(await readFile(registryPath(), 'utf8')) as unknown
    let registry = normalizeRegistry(raw)
    registry = await mergeLegacyInternalRegistry(registry)
    registryCache = registry
    return registryCache
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      registryCache = await mergeLegacyInternalRegistry({ plugins: [], autoInstalledPlugins: [] })
      return registryCache
    }
    throw error
  }
}

function readRegistrySync(): RegistryFile {
  if (registryCache) {
    return registryCache
  }
  try {
    const raw = JSON.parse(readFileSync(registryPath(), 'utf8')) as unknown
    registryCache = normalizeRegistry(raw)
    return registryCache
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      registryCache = { plugins: [], autoInstalledPlugins: [] }
      return registryCache
    }
    throw error
  }
}

async function markAutoInstalledPlugin(id: string): Promise<void> {
  const registry = await readRegistryAsync()
  if (registry.autoInstalledPlugins.includes(id)) return
  await writeRegistryAsync({
    ...registry,
    autoInstalledPlugins: [...registry.autoInstalledPlugins, id]
  })
}

function writeRegistryAsync(registry: RegistryFile): Promise<void> {
  registryCache = registry
  const write = registryWriteQueue
    .catch(() => {})
    .then(async () => {
      await ensurePluginDirsAsync()
      const destination = registryPath()
      const tempPath = join(dirname(destination), `.${Date.now()}.${process.pid}.tmp`)
      await writeFile(tempPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
      await rename(tempPath, destination)
    })
  registryWriteQueue = write.catch(() => {})
  return write
}

function pluginId(pluginName: string): string {
  return pluginName
}

function findInstalledByName(
  registry: RegistryFile,
  pluginName: string
): InstalledPlugin | undefined {
  return registry.plugins.find((plugin) => plugin.name === pluginName)
}

function versionDirName(version: string): string {
  return version.replace(/[^a-zA-Z0-9._-]/g, '_') || 'local'
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split(/[.-]/)
  const bParts = b.split(/[.-]/)
  const length = Math.max(aParts.length, bParts.length)

  for (let index = 0; index < length; index += 1) {
    const aPart = aParts[index] ?? '0'
    const bPart = bParts[index] ?? '0'
    const aNumber = Number(aPart)
    const bNumber = Number(bPart)
    const bothNumeric = Number.isInteger(aNumber) && Number.isInteger(bNumber)
    const comparison = bothNumeric ? aNumber - bNumber : aPart.localeCompare(bPart)
    if (comparison !== 0) return comparison > 0 ? 1 : -1
  }

  return 0
}

function marketplaceDiagnostic(message: string): PluginDiagnostic {
  return {
    level: 'warning',
    message: `Marketplace refresh: ${message}`
  }
}

function withoutMarketplaceDiagnostics(diagnostics: PluginDiagnostic[]): PluginDiagnostic[] {
  return diagnostics.filter((diagnostic) => !diagnostic.message.startsWith('Marketplace refresh:'))
}

async function appendAuditEventAsync(
  event: Omit<PluginAuditEvent, 'id' | 'timestamp'>
): Promise<void> {
  await ensurePluginDirsAsync()
  const timestamp = new Date().toISOString()
  const id = `${timestamp}:${event.action}:${event.pluginId ?? event.pluginName ?? 'plugin'}`
  await appendFile(auditLogPath(), `${JSON.stringify({ id, timestamp, ...event })}\n`, 'utf8')
}

export async function recordPluginHookAuditAsync(
  event: Omit<PluginAuditEvent, 'id' | 'timestamp' | 'action'>
): Promise<void> {
  await appendAuditEventAsync({
    ...event,
    action: 'hook'
  })
}

async function auditPluginActionAsync(
  action: PluginAuditAction,
  plugin: Pick<InstalledPlugin, 'id' | 'name' | 'marketplaceName'>,
  message: string,
  details?: Record<string, unknown>
): Promise<void> {
  await appendAuditEventAsync({
    action,
    pluginId: plugin.id,
    pluginName: plugin.name,
    marketplaceName: plugin.marketplaceName,
    level: action === 'validation-error' ? 'error' : 'info',
    message,
    details
  })
}

function pluginAuthDetails(result: PluginAuthLoginResult | null): Record<string, unknown> {
  if (!result) {
    return { skipped: true }
  }

  if (result.skipped) {
    return {
      skipped: true,
      statusExitCode: result.status.exitCode,
      statusTimedOut: result.status.timedOut,
      statusCancelled: result.status.cancelled
    }
  }

  return {
    skipped: false,
    statusExitCode: result.status?.exitCode ?? null,
    statusTimedOut: result.status?.timedOut ?? null,
    statusCancelled: result.status?.cancelled ?? null,
    loginExitCode: result.login.exitCode,
    loginTimedOut: result.login.timedOut,
    loginCancelled: result.login.cancelled
  }
}

function pluginAuthFailureDiagnostic(error: unknown): PluginDiagnostic {
  return {
    level: 'warning',
    message: `Plugin auth failed: ${error instanceof Error ? error.message : String(error)}`
  }
}

function withPluginDiagnostic(
  plugin: InstalledPlugin,
  diagnostic: PluginDiagnostic,
  checkedAt = new Date().toISOString()
): InstalledPlugin {
  const diagnostics = [...plugin.diagnostics, diagnostic]
  return {
    ...plugin,
    diagnostics,
    validationStatus: validationStatus(diagnostics, checkedAt)
  }
}

async function runAndAuditPluginAuthAsync(
  plugin: InstalledPlugin,
  reason: 'install',
  options?: PluginAuthRunOptions
): Promise<PluginAuthLoginResult | null> {
  const pluginDataPath = pluginRuntimeDataPath(plugin)
  await mkdir(pluginDataPath, { recursive: true })

  try {
    const result = await runPluginAuthLoginAsync(plugin, pluginDataPath, options)
    await auditPluginActionAsync('auth', plugin, 'Plugin auth completed', {
      reason,
      ...pluginAuthDetails(result)
    })
    return result
  } catch (error) {
    await auditPluginActionAsync('auth', plugin, 'Plugin auth failed', {
      reason,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof PluginAuthError
        ? {
            phase: error.phase,
            exitCode: error.result.exitCode,
            timedOut: error.result.timedOut
          }
        : {}),
      ...(error instanceof PluginAuthCancelledError
        ? {
            phase: error.phase,
            cancelled: error.result.cancelled
          }
        : {})
    })
    throw error
  }
}

function buildMarketplaceEntryIndex(
  entries: PluginMarketplaceEntry[]
): Map<string, PluginMarketplaceEntry> {
  const index = new Map<string, PluginMarketplaceEntry>()
  for (const entry of entries) {
    index.set(entry.name, entry)
  }
  return index
}

function marketplaceEntryForPlugin(
  entries: Map<string, PluginMarketplaceEntry>,
  plugin: InstalledPlugin
): PluginMarketplaceEntry | undefined {
  return entries.get(plugin.name)
}

function marketplaceSourceChanged(
  plugin: InstalledPlugin,
  source: { resolvedSourceSha256?: string }
): boolean {
  if (!source.resolvedSourceSha256) return false
  if (plugin.sourceMetadata.installedFrom !== 'marketplace') return false
  return plugin.sourceMetadata.resolvedSourceSha256 !== source.resolvedSourceSha256
}

async function localMarketplaceCacheChanged(
  plugin: InstalledPlugin,
  source: { resolvedSourceSha256?: string }
): Promise<boolean> {
  if (!source.resolvedSourceSha256) return false
  if (plugin.sourceMetadata.installedFrom !== 'marketplace') return false
  if (plugin.sourceMetadata.source.type !== 'local') return false

  try {
    return (await computePluginSourceSha256(plugin.cachePath)) !== source.resolvedSourceSha256
  } catch {
    return true
  }
}

async function marketplaceSourceOrCacheChanged(
  plugin: InstalledPlugin,
  source: { resolvedSourceSha256?: string }
): Promise<boolean> {
  if (marketplaceSourceChanged(plugin, source)) return true
  return localMarketplaceCacheChanged(plugin, source)
}

async function marketplaceEntryVersion(entry: PluginMarketplaceEntry): Promise<string> {
  if (entry.version) return entry.version
  const source = await resolveMarketplaceSource(entry)
  const sourceManifest = await loadPluginManifestAsync(source.path)
  return sourceManifest.manifest.version
}

async function marketplaceStatusForPlugin(
  plugin: InstalledPlugin,
  entries: Map<string, PluginMarketplaceEntry>,
  checkedAt: string
): Promise<{ status: PluginMarketplaceStatus; diagnostics: PluginDiagnostic[] }> {
  if (plugin.sourceMetadata.installedFrom === 'developer-upload') {
    const entry = marketplaceEntryForPlugin(entries, plugin)
    if (!entry) {
      return {
        status: {
          available: false,
          checkedAt,
          message:
            'Developer build installed locally; reinstall from Plugins to use the online catalog'
        },
        diagnostics: []
      }
    }

    try {
      const availableVersion = await marketplaceEntryVersion(entry)
      const comparison = compareVersions(availableVersion, plugin.installedVersion)
      return {
        status: {
          available: true,
          checkedAt,
          availableVersion,
          message:
            comparison > 0
              ? 'Online catalog version is newer than the local developer build'
              : undefined
        },
        diagnostics: []
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        status: {
          available: false,
          checkedAt,
          message
        },
        diagnostics: [marketplaceDiagnostic(message)]
      }
    }
  }

  const entry = marketplaceEntryForPlugin(entries, plugin)
  if (!entry) {
    const message = 'Installed plugin no longer appears in its marketplace'
    return {
      status: {
        available: false,
        checkedAt,
        message
      },
      diagnostics: [marketplaceDiagnostic(message)]
    }
  }

  try {
    const availableVersion = await marketplaceEntryVersion(entry)
    const comparison = compareVersions(availableVersion, plugin.installedVersion)
    const message =
      comparison < 0
        ? `Marketplace version ${availableVersion} is older than installed ${plugin.installedVersion}`
        : undefined
    return {
      status: {
        available: true,
        checkedAt,
        availableVersion,
        message
      },
      diagnostics: message ? [marketplaceDiagnostic(message)] : []
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: {
        available: false,
        checkedAt,
        message
      },
      diagnostics: [marketplaceDiagnostic(message)]
    }
  }
}

export async function listInstalledPluginsAsync(): Promise<InstalledPlugin[]> {
  return (await readRegistryAsync()).plugins.filter((plugin) => !isPluginHiddenFromUsers(plugin))
}

export function isInstalledPluginEnabled(pluginName: string): boolean {
  const plugin = findInstalledByName(readRegistrySync(), pluginName)
  return Boolean(plugin?.enabled && plugin.manifest.schema === AGENT_PLUGIN_SCHEMA_V1)
}

export async function refreshPluginMarketplaces(): Promise<PluginMarketplaceRefreshResult> {
  const refreshedAt = new Date().toISOString()
  const marketplaces = await listPluginMarketplaces()
  const available = await listAvailablePluginEntries()
  const entries = buildMarketplaceEntryIndex(available)
  const registry = await readRegistryAsync()
  const installed = await Promise.all(
    registry.plugins.map(async (plugin) => {
      const { status, diagnostics } = await marketplaceStatusForPlugin(plugin, entries, refreshedAt)
      return {
        ...plugin,
        marketplaceStatus: status,
        diagnostics: [...withoutMarketplaceDiagnostics(plugin.diagnostics), ...diagnostics],
        updatedAt: refreshedAt
      }
    })
  )
  await writeRegistryAsync({ ...registry, plugins: installed })
  const visibleInstalled = installed.filter((plugin) => !isPluginHiddenFromUsers(plugin))

  await appendAuditEventAsync({
    action: 'marketplace-refresh',
    level: visibleInstalled.some((plugin) => plugin.marketplaceStatus?.available === false)
      ? 'warning'
      : 'info',
    message: 'Refreshed plugin marketplaces',
    details: {
      marketplaces: marketplaces.length,
      available: available.length,
      staleInstalled: visibleInstalled.filter(
        (plugin) => plugin.marketplaceStatus?.available === false
      ).length
    }
  })

  return {
    refreshedAt,
    marketplaces,
    available,
    installed: visibleInstalled
  }
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<InstalledPlugin> {
  const plugin = await installedPluginEntry(id)
  const registry = await readRegistryAsync()
  if (!enabled) await stopPluginMcpServersAsync(plugin.id)
  plugin.enabled = enabled
  plugin.updatedAt = new Date().toISOString()
  await writeRegistryAsync(registry)
  await auditPluginActionAsync(
    enabled ? 'enable' : 'disable',
    plugin,
    `${enabled ? 'Enabled' : 'Disabled'} plugin`
  )
  return plugin
}

export async function uninstallPlugin(id: string): Promise<{ uninstalled: boolean }> {
  const registry = await readRegistryAsync()
  const plugin = findInstalledByName(registry, id)
  if (!plugin) {
    return { uninstalled: false }
  }
  await stopPluginMcpServersAsync(plugin.id)
  await rm(join(cacheRoot(), plugin.name), {
    recursive: true,
    force: true
  })
  await writeRegistryAsync({
    ...registry,
    plugins: registry.plugins.filter((entry) => entry.id !== plugin.id)
  })
  await auditPluginActionAsync('uninstall', plugin, 'Uninstalled plugin')
  return { uninstalled: true }
}

export async function clearInstalledPlugins(): Promise<{ cleared: boolean; removedCount: number }> {
  const registry = await readRegistryAsync()
  const removedCount = registry.plugins.length
  await disposePluginMcpRuntimeAsync()
  await rm(cacheRoot(), { recursive: true, force: true })
  await rm(runtimeDataRoot(), { recursive: true, force: true })
  await rm(logsRoot(), { recursive: true, force: true })
  await writeRegistryAsync({ ...registry, plugins: [] })
  await appendAuditEventAsync({
    action: 'clear-installed',
    level: 'warning',
    message: 'Cleared installed plugins, plugin cache, and plugin runtime data',
    details: { removedCount }
  })

  return { cleared: true, removedCount }
}

async function availableEntry(params: {
  marketplaceName: string
  pluginName: string
}): Promise<PluginMarketplaceEntry> {
  const entry = (await listAvailablePluginEntries()).find(
    (candidate) => candidate.name === params.pluginName
  )
  if (!entry) {
    throw new Error(`Marketplace plugin not found: ${params.pluginName}`)
  }
  if (entry.policy?.installation === 'NOT_AVAILABLE') {
    throw new Error(`Plugin is not available for installation: ${params.pluginName}`)
  }
  return entry
}

async function installFromEntry(
  entry: PluginMarketplaceEntry,
  options: {
    action: 'install' | 'upgrade' | 'reinstall' | 'replace'
    existing?: InstalledPlugin
  }
): Promise<InstalledPlugin> {
  const existing = options.existing
  const replacing =
    options.action === 'replace' || Boolean(existing && options.action === 'install')

  const source = await resolveMarketplaceSource(entry)
  const sourcePath = source.path
  const sourceManifest = await loadPluginManifestAsync(sourcePath)
  const version = sourceManifest.manifest.version || 'local'
  if (existing && !replacing) {
    const comparison = compareVersions(version, existing.installedVersion)
    if (comparison < 0) {
      throw new Error(
        `Plugin downgrade is not supported: ${existing.name} ${existing.installedVersion} -> ${version}`
      )
    }
    if (options.action === 'upgrade' && comparison <= 0) {
      throw new Error(`No plugin upgrade available for ${existing.name}`)
    }
    if (options.action === 'reinstall' && comparison > 0) {
      throw new Error(`A newer plugin version is available; use upgrade for ${existing.name}`)
    }
  }

  const pluginName = sourceManifest.manifest.name
  const destination = join(cacheRoot(), pluginName, versionDirName(version))

  if (existing) await stopPluginMcpServersAsync(existing.id)

  const { installedManifest, validation } = await replacePluginCacheDirectory(
    sourcePath,
    destination
  )
  const now = new Date().toISOString()
  const id = pluginName
  const diagnostics = validation.diagnostics.length
    ? validation.diagnostics
    : installedManifest.diagnostics
  let installed: InstalledPlugin = {
    id,
    name: pluginName,
    version: installedManifest.manifest.version,
    installedVersion: installedManifest.manifest.version,
    enabled: existing?.enabled ?? true,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    marketplaceName: entry.marketplaceName,
    source: entry.source,
    sourceMetadata: sourceMetadata(entry, source),
    cachePath: destination,
    manifestPath: installedManifest.manifestPath,
    manifest: installedManifest.manifest,
    diagnostics,
    validationStatus: validationStatus(diagnostics, now)
  }

  if (hasRunnableAuth(installed)) {
    try {
      await runAndAuditPluginAuthAsync(installed, 'install')
    } catch (error) {
      installed = withPluginDiagnostic(installed, pluginAuthFailureDiagnostic(error), now)
    }
  }

  const registry = await readRegistryAsync()
  await writeRegistryAsync({
    ...registry,
    plugins: [installed, ...registry.plugins.filter((plugin) => plugin.name !== pluginName)]
  })

  if (existing && existing.cachePath !== installed.cachePath) {
    await rm(existing.cachePath, { recursive: true, force: true })
  }

  const auditAction = options.action === 'replace' ? 'install' : options.action
  const message =
    options.action === 'upgrade'
      ? `Upgraded plugin from ${existing?.installedVersion} to ${installed.version}`
      : options.action === 'reinstall'
        ? `Reinstalled plugin ${installed.version}`
        : replacing && existing
          ? `Replaced installed plugin with ${installed.version}`
          : 'Installed plugin'
  await auditPluginActionAsync(auditAction, installed, message, {
    version: installed.version,
    validationStatus: installed.validationStatus
  })
  return installed
}

export async function installPluginFromDeveloperUpload(params: {
  sourcePath: string
  packageSha256?: string
  signal?: AbortSignal
  onAuthLoginStart?: (plugin: InstalledPlugin) => void
}): Promise<InstalledPlugin> {
  const sourcePath = params.sourcePath
  const sourceManifest = await loadPluginManifestAsync(sourcePath)
  const version = sourceManifest.manifest.version || 'local'
  const pluginName = sourceManifest.manifest.name
  const registry = await readRegistryAsync()
  const existing = findInstalledByName(registry, pluginName)
  const destination = join(cacheRoot(), pluginName, versionDirName(version))

  const { installedManifest, validation } = await replacePluginCacheDirectory(
    sourcePath,
    destination
  )
  const now = new Date().toISOString()
  const diagnostics = validation.diagnostics.length
    ? validation.diagnostics
    : installedManifest.diagnostics
  let installed: InstalledPlugin = {
    id: pluginName,
    name: pluginName,
    version: installedManifest.manifest.version,
    installedVersion: installedManifest.manifest.version,
    enabled: existing?.enabled ?? true,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    marketplaceName: existing?.marketplaceName ?? '',
    source: { type: 'local', path: sourcePath },
    sourceMetadata: {
      installedFrom: 'developer-upload',
      resolvedSourcePath: sourcePath,
      resolvedZipSha256: params.packageSha256,
      resolvedAt: now
    },
    cachePath: destination,
    manifestPath: installedManifest.manifestPath,
    manifest: installedManifest.manifest,
    diagnostics,
    validationStatus: validationStatus(diagnostics, now)
  }

  if (hasRunnableAuth(installed)) {
    try {
      await runAndAuditPluginAuthAsync(installed, 'install', {
        signal: params.signal,
        onCommandStart: (phase) => {
          if (phase !== 'login') return
          try {
            params.onAuthLoginStart?.(installed)
          } catch (error) {
            console.error('[plugins] Failed to notify plugin auth login start:', error)
          }
        }
      })
    } catch (error) {
      installed = withPluginDiagnostic(installed, pluginAuthFailureDiagnostic(error), now)
    }
  }

  await writeRegistryAsync({
    ...registry,
    plugins: [installed, ...registry.plugins.filter((plugin) => plugin.name !== pluginName)]
  })

  if (existing && existing.cachePath !== installed.cachePath) {
    await rm(existing.cachePath, { recursive: true, force: true })
  }

  await auditPluginActionAsync('install', installed, 'Installed developer plugin build', {
    version: installed.version,
    validationStatus: installed.validationStatus
  })
  return installed
}

export async function installPlugin(params: {
  marketplaceName: string
  pluginName: string
}): Promise<InstalledPlugin> {
  const entry = await availableEntry(params)
  const registry = await readRegistryAsync()
  const existing = findInstalledByName(registry, entry.name)
  return installFromEntry(entry, {
    action: existing ? 'replace' : 'install',
    existing
  })
}

export async function installDefaultMarketplacePlugins(): Promise<DefaultPluginInstallResult> {
  const available = await listAvailablePluginEntries()
  const defaultEntries = available.filter(
    (entry) => entry.policy?.installation === 'INSTALLED_BY_DEFAULT'
  )
  const registry = await readRegistryAsync()
  const installedIds = new Set(registry.plugins.map((plugin) => plugin.id))
  const autoInstalledIds = new Set(registry.autoInstalledPlugins)
  const result: DefaultPluginInstallResult = {
    installed: [],
    skipped: [],
    failed: []
  }

  for (const entry of defaultEntries) {
    const id = pluginId(entry.name)
    if (installedIds.has(id) || autoInstalledIds.has(id)) {
      if (installedIds.has(id) && !autoInstalledIds.has(id)) {
        autoInstalledIds.add(id)
        await markAutoInstalledPlugin(id)
      }
      result.skipped.push({
        marketplaceName: entry.marketplaceName,
        pluginName: entry.name,
        reason: installedIds.has(id) ? 'already-installed' : 'already-auto-installed'
      })
      continue
    }

    try {
      const installed = await installFromEntry(entry, { action: 'install' })
      installedIds.add(installed.id)
      autoInstalledIds.add(installed.id)
      result.installed.push(installed)
      await markAutoInstalledPlugin(installed.id)
      await appendAuditEventAsync({
        action: 'default-install',
        pluginId: installed.id,
        pluginName: installed.name,
        marketplaceName: installed.marketplaceName,
        level: 'info',
        message: 'Installed default plugin on first launch',
        details: { version: installed.version }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.failed.push({
        marketplaceName: entry.marketplaceName,
        pluginName: entry.name,
        error: message
      })
      await appendAuditEventAsync({
        action: 'default-install',
        pluginName: entry.name,
        marketplaceName: entry.marketplaceName,
        level: 'error',
        message: 'Failed to install default plugin on first launch',
        details: { error: message }
      })
    }
  }

  return result
}

export async function autoUpgradeInstalledPlugins(): Promise<AutoPluginUpgradeResult> {
  const available = await listAvailablePluginEntries()
  const entries = buildMarketplaceEntryIndex(available)
  const registry = await readRegistryAsync()
  const autoInstalledIds = new Set(registry.autoInstalledPlugins)
  const result: AutoPluginUpgradeResult = {
    upgraded: [],
    skipped: [],
    failed: []
  }

  for (const plugin of registry.plugins) {
    const marketplaceName =
      plugin.sourceMetadata.installedFrom === 'marketplace'
        ? plugin.sourceMetadata.marketplaceName
        : plugin.marketplaceName
    const entry = marketplaceEntryForPlugin(entries, plugin)

    if (!entry) {
      result.skipped.push({
        marketplaceName,
        pluginName: plugin.name,
        reason: 'not-in-marketplace'
      })
      continue
    }

    const autoInstalledDefault =
      autoInstalledIds.has(plugin.id) && entry.policy?.installation === 'INSTALLED_BY_DEFAULT'
    if (plugin.sourceMetadata.installedFrom === 'developer-upload' && !autoInstalledDefault) {
      result.skipped.push({
        marketplaceName: plugin.marketplaceName,
        pluginName: plugin.name,
        reason: 'developer-upload'
      })
      continue
    }

    if (entry.policy?.installation === 'NOT_AVAILABLE') {
      result.skipped.push({
        marketplaceName,
        pluginName: plugin.name,
        reason: 'not-available'
      })
      continue
    }

    try {
      const availableVersion = await marketplaceEntryVersion(entry)
      const comparison = compareVersions(availableVersion, plugin.installedVersion)
      if (comparison < 0) {
        result.skipped.push({
          marketplaceName,
          pluginName: plugin.name,
          reason: 'downgrade-available'
        })
        continue
      }

      if (comparison === 0) {
        const source = await resolveMarketplaceSource(entry)
        if (!(await marketplaceSourceOrCacheChanged(plugin, source))) {
          result.skipped.push({
            marketplaceName,
            pluginName: plugin.name,
            reason: 'up-to-date'
          })
          continue
        }

        const reinstalled = await installFromEntry(entry, { action: 'reinstall', existing: plugin })
        result.upgraded.push(reinstalled)
        continue
      }

      const upgraded = await installFromEntry(entry, { action: 'upgrade', existing: plugin })
      result.upgraded.push(upgraded)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.failed.push({
        marketplaceName,
        pluginName: plugin.name,
        error: message
      })
      await appendAuditEventAsync({
        action: 'auto-upgrade',
        pluginId: plugin.id,
        pluginName: plugin.name,
        marketplaceName,
        level: 'error',
        message: 'Failed to auto-upgrade installed plugin',
        details: { error: message }
      })
    }
  }

  if (result.upgraded.length || result.failed.length) {
    await appendAuditEventAsync({
      action: 'auto-upgrade',
      level: result.failed.length ? 'warning' : 'info',
      message: 'Auto-upgraded installed plugins',
      details: {
        upgraded: result.upgraded.map((plugin) => plugin.id),
        skipped: result.skipped,
        failed: result.failed
      }
    })
  }

  return result
}

async function installedPluginEntry(id: string): Promise<InstalledPlugin> {
  const registry = await readRegistryAsync()
  const plugin =
    findInstalledByName(registry, id) ?? registry.plugins.find((entry) => entry.id === id)
  if (!plugin) {
    throw new Error(`Installed plugin not found: ${id}`)
  }
  return plugin
}

async function marketplaceEntryForInstalled(
  plugin: InstalledPlugin
): Promise<PluginMarketplaceEntry> {
  const entry = (await listAvailablePluginEntries()).find(
    (candidate) => candidate.name === plugin.name
  )
  if (!entry) {
    throw new Error(`Marketplace plugin not found: ${plugin.name}`)
  }
  if (entry.policy?.installation === 'NOT_AVAILABLE') {
    throw new Error(`Plugin is not available for installation: ${plugin.name}`)
  }
  return entry
}

export async function upgradePlugin(id: string): Promise<InstalledPlugin> {
  const plugin = await installedPluginEntry(id)
  return installFromEntry(await marketplaceEntryForInstalled(plugin), {
    action: 'upgrade',
    existing: plugin
  })
}

export async function reinstallPlugin(id: string): Promise<InstalledPlugin> {
  const plugin = await installedPluginEntry(id)
  const entry = await marketplaceEntryForInstalled(plugin)
  return installFromEntry(entry, {
    action: plugin.sourceMetadata.installedFrom === 'developer-upload' ? 'replace' : 'reinstall',
    existing: plugin
  })
}

export async function validateInstalledPlugins(): Promise<InstalledPlugin[]> {
  const registry = await readRegistryAsync()
  const refreshed = await Promise.all(
    registry.plugins.map(async (plugin) => {
      const checkedAt = new Date().toISOString()
      try {
        const validation = await validatePluginPackageAsync(plugin.cachePath)
        if (!validation.manifest || !validation.manifestPath) {
          throw new Error(validation.diagnostics.map((diagnostic) => diagnostic.message).join('; '))
        }
        const refreshedPlugin = {
          ...plugin,
          version: validation.manifest.version,
          installedVersion: plugin.installedVersion ?? validation.manifest.version,
          manifestPath: validation.manifestPath,
          manifest: validation.manifest,
          diagnostics: validation.diagnostics,
          validationStatus: validationStatus(validation.diagnostics, checkedAt),
          updatedAt: checkedAt
        }
        await auditPluginActionAsync('validate', refreshedPlugin, 'Validated installed plugin', {
          validationStatus: refreshedPlugin.validationStatus
        })
        return refreshedPlugin
      } catch (error) {
        const diagnostics = [
          ...plugin.diagnostics,
          {
            level: 'error' as const,
            message: error instanceof Error ? error.message : String(error)
          }
        ]
        const failedPlugin = {
          ...plugin,
          diagnostics,
          validationStatus: validationStatus(diagnostics, checkedAt),
          updatedAt: checkedAt
        }
        await auditPluginActionAsync('validation-error', failedPlugin, 'Plugin validation failed', {
          error: error instanceof Error ? error.message : String(error)
        })
        return failedPlugin
      }
    })
  )
  await writeRegistryAsync({ ...registry, plugins: refreshed })
  return refreshed
}

export async function listPluginAuditLogAsync(limit = 100): Promise<PluginAuditEvent[]> {
  await ensurePluginDirsAsync()
  try {
    return (await readFile(auditLogPath(), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as PluginAuditEvent)
      .reverse()
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

export async function getEnabledPluginSkillSourcesAsync(): Promise<PluginSkillSource[]> {
  const sources: PluginSkillSource[] = []
  for (const plugin of await listInstalledPluginsAsync()) {
    if (
      !plugin.enabled ||
      plugin.manifest.schema !== AGENT_PLUGIN_SCHEMA_V1 ||
      !plugin.manifest.skills
    ) {
      continue
    }
    try {
      const rootPath = await resolvePluginComponentPathAsync(
        plugin.cachePath,
        plugin.manifest.skills
      )
      sources.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginVersion: plugin.version,
        pluginRoot: plugin.cachePath,
        rootPath,
        label: `${plugin.name}@${plugin.version}`,
        scripts: plugin.manifest.scripts,
        commands: plugin.manifest.commands,
        hasRuntimeRequirements: Boolean(plugin.manifest.runtimeRequirements)
      })
    } catch {
      // Invalid installed plugin paths are surfaced through plugin diagnostics.
    }
  }
  return sources
}

export async function getEnabledPluginBinPathsAsync(): Promise<string[]> {
  const binPaths: string[] = []
  const seen = new Set<string>()

  for (const plugin of await listInstalledPluginsAsync()) {
    if (
      !plugin.enabled ||
      plugin.manifest.schema !== AGENT_PLUGIN_SCHEMA_V1 ||
      !plugin.manifest.bin ||
      plugin.manifest.permissions?.shell === 'deny'
    ) {
      continue
    }

    try {
      const binPath = await resolvePluginComponentPathAsync(plugin.cachePath, plugin.manifest.bin)
      const binStat = await stat(binPath)
      if (!binStat.isDirectory() || seen.has(binPath)) continue

      let commandShimPath: string | null = null
      try {
        commandShimPath = await preparePluginCommandShimsAsync(plugin)
      } catch {
        // A generated command-name shim is an alias convenience; the manifest bin path remains valid.
      }
      for (const path of [commandShimPath, binPath]) {
        if (!path || seen.has(path)) continue
        seen.add(path)
        binPaths.push(path)
      }
    } catch {
      // Invalid installed plugin paths are surfaced through plugin diagnostics.
    }
  }

  return binPaths
}

export async function getEnabledPluginMcpServersAsync(): Promise<EnabledPluginMcpServer[]> {
  const servers: EnabledPluginMcpServer[] = []
  for (const plugin of await listInstalledPluginsAsync()) {
    if (
      !plugin.enabled ||
      plugin.manifest.schema !== AGENT_PLUGIN_SCHEMA_V1 ||
      !plugin.manifest.mcp
    ) {
      continue
    }
    const pluginDataRoot = pluginRuntimeDataPath(plugin)
    for (const serverName of Object.keys(plugin.manifest.mcp.servers).sort((left, right) =>
      left.localeCompare(right)
    )) {
      servers.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginVersion: plugin.version,
        pluginRoot: plugin.cachePath,
        pluginDataRoot,
        serverName,
        server: plugin.manifest.mcp.servers[serverName]
      })
    }
  }
  return servers
}

export async function getEnabledPluginHookDeclarationsAsync(): Promise<
  EnabledPluginHookDeclaration[]
> {
  const hookDeclarations: EnabledPluginHookDeclaration[] = []

  for (const plugin of await listInstalledPluginsAsync()) {
    const declarations = plugin.manifest.hookDeclarations ?? []
    if (
      !plugin.enabled ||
      plugin.manifest.schema !== AGENT_PLUGIN_SCHEMA_V1 ||
      declarations.length === 0
    ) {
      continue
    }

    hookDeclarations.push({
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginVersion: plugin.version,
      marketplaceName: plugin.marketplaceName,
      pluginRoot: plugin.cachePath,
      hookDeclarations: declarations
    })
  }

  return hookDeclarations
}
