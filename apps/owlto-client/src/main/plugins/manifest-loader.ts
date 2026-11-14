import { access, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { loadOwltoAgentPluginHookDeclarationsAsync } from './hooks/hook-config-loader.js'
import { loadPluginMcpConfigurationAsync } from './mcp-config-loader.js'
import type {
  LoadedPluginManifest,
  NormalizedPluginManifest,
  PluginAuth,
  PluginAuthCommand,
  PluginCommand,
  PluginComponentPaths,
  PluginDiagnostic,
  PluginNativePackageRequirement,
  PluginRuntimePackageRequirement
} from './plugin-types.js'
import { AGENT_PLUGIN_SCHEMA_V1, OWLTO_PLUGIN_EXTENSION_NAMESPACE } from './plugin-types.js'

const MANIFEST_PATH = 'plugin.json'
const FIXED_SKILLS_PATH = './skills'
const FIXED_MCP_PATH = './mcp.json'
const FIXED_OWLTO_HOOKS_PATH = './com.owlto.app/hooks/hooks.json'
const PORTABLE_MANIFEST_FIELDS = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string => typeof entry === 'string')
  return strings.length ? strings : undefined
}

function optionalStringRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

async function fixedPathIfPresentAsync(
  pluginRoot: string,
  path: string
): Promise<string | undefined> {
  try {
    await stat(resolve(pluginRoot, path))
    return path
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function validatePortableManifest(raw: Record<string, unknown>): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = []
  for (const field of Object.keys(raw)) {
    if (!PORTABLE_MANIFEST_FIELDS.has(field)) {
      diagnostics.push({
        level: 'warning',
        message: `Unknown Agent Plugins manifest field is ignored: ${field}`,
        path: field
      })
    }
  }

  if (raw.$schema !== AGENT_PLUGIN_SCHEMA_V1) {
    diagnostics.push({
      level: 'error',
      message: `Plugin manifest must target ${AGENT_PLUGIN_SCHEMA_V1}`,
      path: '$schema'
    })
  }

  const name = optionalString(raw.name)
  if (!name) {
    diagnostics.push({ level: 'error', message: 'Plugin name is required', path: 'name' })
  } else if (
    name.length > 64 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name) ||
    name.includes('--') ||
    name.includes('..')
  ) {
    diagnostics.push({
      level: 'error',
      message:
        'Plugin name must be 1-64 lowercase letters, digits, hyphens, or periods, without consecutive hyphens or periods',
      path: 'name'
    })
  }

  for (const field of ['version', 'description', 'homepage', 'repository', 'license'] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') {
      diagnostics.push({
        level: 'error',
        message: `${field} must be a string`,
        path: field
      })
    }
  }

  if (raw.keywords !== undefined) {
    if (!Array.isArray(raw.keywords) || raw.keywords.some((entry) => typeof entry !== 'string')) {
      diagnostics.push({
        level: 'error',
        message: 'keywords must be an array of strings',
        path: 'keywords'
      })
    }
  }

  if (raw.author !== undefined) {
    if (!isRecord(raw.author)) {
      diagnostics.push({ level: 'error', message: 'author must be an object', path: 'author' })
    } else {
      for (const [field, value] of Object.entries(raw.author)) {
        if (!['name', 'email', 'url'].includes(field) || typeof value !== 'string') {
          diagnostics.push({
            level: 'error',
            message: `author.${field} is not a supported string field`,
            path: `author.${field}`
          })
        }
      }
    }
  }

  if (raw.extensions !== undefined && !isRecord(raw.extensions)) {
    diagnostics.push({
      level: 'warning',
      message: 'Non-object extensions field is ignored',
      path: 'extensions'
    })
  }
  return diagnostics
}

function owltoExtensionFromManifest(
  raw: Record<string, unknown>,
  diagnostics: PluginDiagnostic[]
): Record<string, unknown> {
  if (!isRecord(raw.extensions)) return {}
  const namespace = OWLTO_PLUGIN_EXTENSION_NAMESPACE
  const extension = raw.extensions[namespace]
  if (extension === undefined) return {}
  if (!isRecord(extension)) {
    diagnostics.push({
      level: 'error',
      message: `${namespace} extension must be an object`,
      path: `extensions.${namespace}`
    })
    return {}
  }
  return extension
}

async function readJsonObjectAsync(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) {
    throw new Error('Manifest must be a JSON object')
  }
  return parsed
}

function getComponentPath(raw: Record<string, unknown>, key: string): string | undefined {
  return optionalString(raw[key])
}

function normalizeRuntime(raw: unknown): NormalizedPluginManifest['runtime'] {
  if (!isRecord(raw)) return undefined
  const node = optionalString(raw.node)
  return node ? { node } : undefined
}

function normalizeRuntimeComponentRequirement(
  raw: unknown,
  path: string,
  diagnostics: PluginDiagnostic[]
): NonNullable<NormalizedPluginManifest['runtimeRequirements']>['node'] | undefined {
  if (raw === undefined) return undefined
  if (typeof raw === 'string' && raw.trim()) {
    return { version: raw.trim() }
  }
  if (!isRecord(raw)) {
    diagnostics.push({
      level: 'error',
      message: `${path} must be a string or object`
    })
    return undefined
  }
  const version = optionalString(raw.version)
  if (!version) {
    diagnostics.push({
      level: 'error',
      message: `${path}.version is required`
    })
    return undefined
  }
  const reason = optionalString(raw.reason)
  return {
    version,
    ...(reason ? { reason } : {})
  }
}

function normalizeRuntimePackageRequirement(
  raw: unknown,
  path: string,
  diagnostics: PluginDiagnostic[]
): PluginRuntimePackageRequirement | null {
  if (!isRecord(raw)) {
    diagnostics.push({
      level: 'error',
      message: `${path} must be an object`
    })
    return null
  }

  const name = optionalString(raw.name)
  const version = optionalString(raw.version)
  if (!name) {
    diagnostics.push({
      level: 'error',
      message: `${path}.name is required`
    })
  }
  if (!version) {
    diagnostics.push({
      level: 'error',
      message: `${path}.version is required`
    })
  }
  if (!name || !version) return null

  const reason = optionalString(raw.reason)
  return {
    name,
    version,
    ...(reason ? { reason } : {})
  }
}

function normalizeRuntimePackageRequirements(
  raw: unknown,
  path: string,
  diagnostics: PluginDiagnostic[]
): PluginRuntimePackageRequirement[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    diagnostics.push({
      level: 'error',
      message: `${path} must be an array`
    })
    return undefined
  }

  const requirements = raw
    .map((entry, index) =>
      normalizeRuntimePackageRequirement(entry, `${path}[${index}]`, diagnostics)
    )
    .filter((entry): entry is PluginRuntimePackageRequirement => entry !== null)
  return requirements.length ? requirements : undefined
}

function normalizeNativePackageRequirement(
  raw: unknown,
  path: string,
  diagnostics: PluginDiagnostic[]
): PluginNativePackageRequirement | null {
  const base = normalizeRuntimePackageRequirement(raw, path, diagnostics)
  if (!base || !isRecord(raw)) return base

  const commands = optionalStringArray(raw.commands)
  if (raw.commands !== undefined && !commands) {
    diagnostics.push({
      level: 'error',
      message: `${path}.commands must be an array of non-empty strings`
    })
  }

  return {
    ...base,
    ...(commands ? { commands } : {})
  }
}

function normalizeNativePackageRequirements(
  raw: unknown,
  path: string,
  diagnostics: PluginDiagnostic[]
): PluginNativePackageRequirement[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    diagnostics.push({
      level: 'error',
      message: `${path} must be an array`
    })
    return undefined
  }

  const requirements = raw
    .map((entry, index) =>
      normalizeNativePackageRequirement(entry, `${path}[${index}]`, diagnostics)
    )
    .filter((entry): entry is PluginNativePackageRequirement => entry !== null)
  return requirements.length ? requirements : undefined
}

function normalizeRuntimeRequirements(
  raw: unknown,
  diagnostics: PluginDiagnostic[]
): NormalizedPluginManifest['runtimeRequirements'] {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    diagnostics.push({
      level: 'error',
      message: 'runtimeRequirements must be an object'
    })
    return undefined
  }

  const capabilities = optionalStringArray(raw.capabilities)
  if (raw.capabilities !== undefined && !capabilities) {
    diagnostics.push({
      level: 'error',
      message: 'runtimeRequirements.capabilities must be an array of non-empty strings'
    })
  }

  const requirements: NormalizedPluginManifest['runtimeRequirements'] = {
    node: normalizeRuntimeComponentRequirement(raw.node, 'runtimeRequirements.node', diagnostics),
    python: normalizeRuntimeComponentRequirement(
      raw.python,
      'runtimeRequirements.python',
      diagnostics
    ),
    nodePackages: normalizeRuntimePackageRequirements(
      raw.nodePackages,
      'runtimeRequirements.nodePackages',
      diagnostics
    ),
    pythonPackages: normalizeRuntimePackageRequirements(
      raw.pythonPackages,
      'runtimeRequirements.pythonPackages',
      diagnostics
    ),
    nativePackages: normalizeNativePackageRequirements(
      raw.nativePackages,
      'runtimeRequirements.nativePackages',
      diagnostics
    ),
    capabilities
  }

  return Object.values(requirements).some((value) => value !== undefined) ? requirements : undefined
}

function normalizePermissions(raw: unknown): NormalizedPluginManifest['permissions'] {
  if (!isRecord(raw)) return undefined
  const filesystem = Array.isArray(raw.filesystem)
    ? raw.filesystem.filter(
        (entry): entry is 'read' | 'write' => entry === 'read' || entry === 'write'
      )
    : undefined
  const shell =
    raw.shell === 'allow' || raw.shell === 'prompt' || raw.shell === 'deny' ? raw.shell : undefined
  const network =
    raw.network === 'allow' || raw.network === 'prompt' || raw.network === 'deny'
      ? raw.network
      : undefined

  return filesystem?.length || shell || network
    ? {
        filesystem,
        shell,
        network
      }
    : undefined
}

function normalizeCommandEntry(
  name: string | undefined,
  raw: unknown,
  diagnostics: PluginDiagnostic[],
  kind = 'command'
): PluginCommand | null {
  const commandName = name?.trim()
  if (!commandName || !/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(commandName)) {
    diagnostics.push({
      level: 'error',
      message: `Plugin ${kind} name must start with a letter and contain only letters, numbers, ".", "_", or "-"`
    })
    return null
  }

  if (typeof raw === 'string') {
    return { name: commandName, entry: raw.trim() }
  }

  if (!isRecord(raw)) {
    diagnostics.push({
      level: 'error',
      message: `Plugin ${kind} must be a string or object: ${commandName}`
    })
    return null
  }

  const entry = optionalString(raw.entry)
  if (!entry) {
    diagnostics.push({
      level: 'error',
      message: `Plugin ${kind} entry is required: ${commandName}`
    })
    return null
  }

  return {
    name: commandName,
    entry,
    description: optionalString(raw.description)
  }
}

function normalizeManifestEntries(
  raw: unknown,
  diagnostics: PluginDiagnostic[],
  kind: 'script' | 'command'
): PluginCommand[] {
  const entries: PluginCommand[] = []
  const seen = new Set<string>()

  if (Array.isArray(raw)) {
    for (const rawEntry of raw) {
      const name = isRecord(rawEntry) ? optionalString(rawEntry.name) : undefined
      const entry = normalizeCommandEntry(name, rawEntry, diagnostics, kind)
      if (!entry) continue
      if (seen.has(entry.name)) {
        diagnostics.push({ level: 'error', message: `Duplicate plugin ${kind}: ${entry.name}` })
        continue
      }
      seen.add(entry.name)
      entries.push(entry)
    }
    return entries
  }

  const entryRecord = optionalStringRecord(raw)
  if (!entryRecord) return entries

  for (const [name, rawEntry] of Object.entries(entryRecord)) {
    const entry = normalizeCommandEntry(name, rawEntry, diagnostics, kind)
    if (!entry) continue
    if (seen.has(entry.name)) {
      diagnostics.push({ level: 'error', message: `Duplicate plugin ${kind}: ${entry.name}` })
      continue
    }
    seen.add(entry.name)
    entries.push(entry)
  }

  return entries
}

function normalizeCommands(
  raw: unknown,
  diagnostics: PluginDiagnostic[]
): NormalizedPluginManifest['commands'] {
  return normalizeManifestEntries(raw, diagnostics, 'command')
}

function normalizeScripts(
  raw: unknown,
  diagnostics: PluginDiagnostic[]
): NormalizedPluginManifest['scripts'] {
  return normalizeManifestEntries(raw, diagnostics, 'script')
}

function normalizeAuthCommand(
  raw: unknown,
  key: 'login' | 'status',
  diagnostics: PluginDiagnostic[]
): PluginAuthCommand | null {
  if (!isRecord(raw)) {
    diagnostics.push({
      level: 'error',
      message: `Plugin auth.${key} must be an object`
    })
    return null
  }

  const command = optionalString(raw.command)
  if (!command) {
    diagnostics.push({
      level: 'error',
      message: `Plugin auth.${key}.command is required`
    })
    return null
  }

  const args = Array.isArray(raw.args)
    ? raw.args.filter((entry): entry is string => typeof entry === 'string')
    : []

  if (Array.isArray(raw.args) && args.length !== raw.args.length) {
    diagnostics.push({
      level: 'error',
      message: `Plugin auth.${key}.args must contain only strings`
    })
  }

  return {
    command,
    args,
    description: optionalString(raw.description)
  }
}

function normalizeAuth(raw: unknown, diagnostics: PluginDiagnostic[]): PluginAuth | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    diagnostics.push({
      level: 'error',
      message: 'Plugin auth must be an object'
    })
    return undefined
  }

  const login = normalizeAuthCommand(raw.login, 'login', diagnostics)
  const status = normalizeAuthCommand(raw.status, 'status', diagnostics)
  if (!login || !status) return undefined

  return {
    login,
    status
  }
}

function normalizeInterface(raw: unknown): NormalizedPluginManifest['interface'] {
  if (!isRecord(raw)) return undefined
  return {
    displayName: optionalString(raw.displayName),
    shortDescription: optionalString(raw.shortDescription),
    longDescription: optionalString(raw.longDescription),
    developerName: optionalString(raw.developerName),
    category: optionalString(raw.category),
    capabilities: optionalStringArray(raw.capabilities),
    defaultPrompt: optionalStringArray(raw.defaultPrompt),
    brandColor: optionalString(raw.brandColor),
    icon: optionalString(raw.icon),
    composerIcon: optionalString(raw.composerIcon),
    logo: optionalString(raw.logo),
    screenshots: optionalStringArray(raw.screenshots),
    websiteURL: optionalString(raw.websiteURL),
    privacyPolicyURL: optionalString(raw.privacyPolicyURL),
    termsOfServiceURL: optionalString(raw.termsOfServiceURL)
  }
}

function normalizeAuthor(raw: unknown): NormalizedPluginManifest['author'] {
  if (typeof raw === 'string') return { name: raw }
  if (!isRecord(raw)) return undefined
  return {
    name: optionalString(raw.name),
    email: optionalString(raw.email),
    url: optionalString(raw.url)
  }
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = normalize(parent)
  const normalizedChild = normalize(child)
  return (
    normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${sep}`)
  )
}

export async function resolvePluginComponentPathAsync(
  pluginRoot: string,
  componentPath: string
): Promise<string> {
  if (!componentPath.startsWith('./')) {
    throw new Error(`Component path must start with "./": ${componentPath}`)
  }
  if (isAbsolute(componentPath)) {
    throw new Error(`Component path must be relative: ${componentPath}`)
  }

  const resolved = resolve(pluginRoot, componentPath)
  if (!isPathInside(pluginRoot, resolved)) {
    throw new Error(`Component path escapes plugin root: ${componentPath}`)
  }

  let resolvedExists = false
  try {
    await access(resolved)
    resolvedExists = true
  } catch (error) {
    if (
      !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
    ) {
      throw error
    }
  }

  if (resolvedExists) {
    const realRoot = await realpath(pluginRoot)
    const realResolved = await realpath(resolved)
    if (!isPathInside(realRoot, realResolved)) {
      throw new Error(`Component path follows symlink outside plugin root: ${componentPath}`)
    }
  }

  return resolved
}

async function validateComponentPathsAsync(
  pluginRoot: string,
  componentPaths: PluginComponentPaths
): Promise<PluginDiagnostic[]> {
  const diagnostics: PluginDiagnostic[] = []
  for (const [key, componentPath] of Object.entries(componentPaths)) {
    if (!componentPath) continue
    try {
      await resolvePluginComponentPathAsync(pluginRoot, componentPath)
    } catch (error) {
      diagnostics.push({
        level: 'error',
        message: `${key}: ${error instanceof Error ? error.message : String(error)}`,
        path: componentPath
      })
    }
  }
  return diagnostics
}

async function normalizeManifestAsync(
  pluginRoot: string,
  raw: Record<string, unknown>
): Promise<{ manifest: NormalizedPluginManifest; diagnostics: PluginDiagnostic[] }> {
  const diagnostics = validatePortableManifest(raw)
  const owltoExtension = owltoExtensionFromManifest(raw, diagnostics)
  const name = optionalString(raw.name) ?? basename(pluginRoot)
  const version = optionalString(raw.version) ?? 'local'
  const description = optionalString(raw.description) ?? ''
  const skills = await fixedPathIfPresentAsync(pluginRoot, FIXED_SKILLS_PATH)
  const mcpServers = await fixedPathIfPresentAsync(pluginRoot, FIXED_MCP_PATH)
  const hooks = await fixedPathIfPresentAsync(pluginRoot, FIXED_OWLTO_HOOKS_PATH)
  const componentPaths: PluginComponentPaths = {
    skills,
    mcpServers,
    hooks,
    apps: getComponentPath(owltoExtension, 'apps'),
    agents: getComponentPath(owltoExtension, 'agents'),
    bin: getComponentPath(owltoExtension, 'bin')
  }
  const scripts = normalizeScripts(owltoExtension.scripts, diagnostics)
  const commands = normalizeCommands(owltoExtension.commands, diagnostics)
  const auth = normalizeAuth(owltoExtension.auth, diagnostics)
  const hookDeclarations = await loadOwltoAgentPluginHookDeclarationsAsync(pluginRoot, diagnostics)
  const mcpResult = await loadPluginMcpConfigurationAsync(
    pluginRoot,
    typeof raw.$schema === 'string' ? raw.$schema : ''
  )
  diagnostics.push(...mcpResult.diagnostics)

  if (!description) {
    diagnostics.push({
      level: 'warning',
      message: 'Plugin description is recommended'
    })
  }
  diagnostics.push(...(await validateComponentPathsAsync(pluginRoot, componentPaths)))

  return {
    manifest: {
      schema: AGENT_PLUGIN_SCHEMA_V1,
      schemaVersion: '1.0.0',
      name,
      version,
      description,
      author: normalizeAuthor(raw.author),
      homepage: optionalString(raw.homepage),
      repository: optionalString(raw.repository),
      license: optionalString(raw.license),
      keywords: optionalStringArray(raw.keywords),
      ...componentPaths,
      runtime: normalizeRuntime(owltoExtension.runtime),
      runtimeRequirements: normalizeRuntimeRequirements(
        owltoExtension.runtimeRequirements,
        diagnostics
      ),
      permissions: normalizePermissions(owltoExtension.permissions),
      auth,
      scripts,
      commands,
      hookDeclarations,
      mcp: mcpResult.configuration,
      interface: normalizeInterface(owltoExtension.interface),
      raw
    },
    diagnostics
  }
}

export async function findPluginManifestPathAsync(pluginRoot: string): Promise<{
  manifestPath: string
} | null> {
  const manifestPath = join(pluginRoot, MANIFEST_PATH)
  try {
    if ((await stat(manifestPath)).isFile()) {
      return { manifestPath }
    }
  } catch {
    return null
  }
  return null
}

export async function loadPluginManifestAsync(pluginRoot: string): Promise<LoadedPluginManifest> {
  const discovered = await findPluginManifestPathAsync(pluginRoot)
  if (!discovered) {
    throw new Error(`No plugin manifest found in ${pluginRoot}`)
  }

  const raw = await readJsonObjectAsync(discovered.manifestPath)
  const normalizedRoot = normalize(pluginRoot)
  const { manifest, diagnostics } = await normalizeManifestAsync(normalizedRoot, raw)

  return {
    manifest,
    pluginRoot: normalizedRoot,
    manifestPath: discovered.manifestPath,
    diagnostics
  }
}

export function relativeFromPluginRoot(pluginRoot: string, targetPath: string): string {
  return `./${relative(pluginRoot, targetPath).split(sep).join('/')}`
}

export function manifestDir(manifestPath: string): string {
  return dirname(manifestPath)
}
