import { access, stat } from 'node:fs/promises'
import { normalize, relative, sep } from 'node:path'
import { BUNDLED_NODE_VERSION, getBundledNodeVersion } from '../node-runtime.js'
import { loadPluginManifestAsync, resolvePluginComponentPathAsync } from './manifest-loader.js'
import type {
  LoadedPluginManifest,
  NormalizedPluginManifest,
  PluginComponentPaths,
  PluginDiagnostic
} from './plugin-types.js'

export type PluginValidationComponent = {
  key: keyof PluginComponentPaths
  path: string
  resolvedPath: string | null
  exists: boolean
  active: boolean
}

export type PluginValidationResult = {
  ok: boolean
  pluginRoot: string
  manifestPath: string | null
  manifest: NormalizedPluginManifest | null
  diagnostics: PluginDiagnostic[]
  components: PluginValidationComponent[]
}

const ACTIVE_COMPONENTS = new Set<keyof PluginComponentPaths>([
  'skills',
  'mcpServers',
  'hooks',
  'bin'
])
const INACTIVE_COMPONENT_MESSAGES: Partial<Record<keyof PluginComponentPaths, string>> = {
  apps: 'App connector metadata is preserved for future support, but app connectors are not started or used in this Owls version',
  agents:
    'Agent metadata is preserved for future support, but plugin-provided agents are not started or used in this Owls version'
}
function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !path.includes(`..${sep}`))
}

function isExecutableMode(mode: number): boolean {
  return process.platform === 'win32' || (mode & 0o111) !== 0
}

function componentEntries(
  manifest: NormalizedPluginManifest
): Array<[keyof PluginComponentPaths, string]> {
  const entries: Array<[keyof PluginComponentPaths, string | undefined]> = [
    ['skills', manifest.skills],
    ['mcpServers', manifest.mcpServers],
    ['apps', manifest.apps],
    ['hooks', manifest.hooks],
    ['agents', manifest.agents],
    ['bin', manifest.bin]
  ]
  return entries.filter(
    (entry): entry is [keyof PluginComponentPaths, string] => typeof entry[1] === 'string'
  )
}

async function addComponentDiagnosticsAsync(
  loaded: LoadedPluginManifest,
  components: PluginValidationComponent[]
): Promise<PluginDiagnostic[]> {
  const diagnostics: PluginDiagnostic[] = []

  for (const [key, componentPath] of componentEntries(loaded.manifest)) {
    let resolvedPath: string | null = null
    let exists = false

    try {
      resolvedPath = await resolvePluginComponentPathAsync(loaded.pluginRoot, componentPath)
      await access(resolvedPath)
      exists = true
      const componentStat = await stat(resolvedPath)
      const expectsDirectory = key === 'skills' || key === 'bin'
      const expectsFile = key === 'mcpServers' || key === 'hooks'
      if (expectsDirectory && !componentStat.isDirectory()) {
        diagnostics.push({
          level: 'error',
          message: `${key}: Declared ${key} component must be a directory`,
          path: componentPath
        })
      } else if (expectsFile && !componentStat.isFile()) {
        diagnostics.push({
          level: 'error',
          message: `${key}: Fixed ${key} component must be a file`,
          path: componentPath,
          fatal: false
        })
      }
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        diagnostics.push({
          level: 'error',
          message: `${key}: Declared component path does not exist`,
          path: componentPath
        })
      }
      // Path safety errors are already reported by loadPluginManifestAsync().
    }

    const active = ACTIVE_COMPONENTS.has(key)
    if (!active) {
      diagnostics.push({
        level: 'warning',
        message: `${key}: ${INACTIVE_COMPONENT_MESSAGES[key] ?? 'Component metadata is preserved but inactive in this Owls version'}`,
        path: componentPath
      })
    }

    components.push({
      key,
      path: componentPath,
      resolvedPath,
      exists,
      active
    })
  }

  return diagnostics
}

async function addCommandDiagnosticsAsync(
  loaded: LoadedPluginManifest
): Promise<PluginDiagnostic[]> {
  const diagnostics: PluginDiagnostic[] = []
  let binPath: string | null = null
  if (loaded.manifest.bin) {
    try {
      binPath = await resolvePluginComponentPathAsync(loaded.pluginRoot, loaded.manifest.bin)
    } catch {
      // Component path safety diagnostics are added elsewhere.
    }
  }

  for (const script of loaded.manifest.scripts) {
    let entryPath: string
    try {
      entryPath = await resolvePluginComponentPathAsync(loaded.pluginRoot, script.entry)
    } catch (error) {
      diagnostics.push({
        level: 'error',
        message: `${script.name}: ${error instanceof Error ? error.message : String(error)}`,
        path: script.entry
      })
      continue
    }

    try {
      const entryStat = await stat(entryPath)
      if (!entryStat.isFile()) {
        diagnostics.push({
          level: 'error',
          message: `${script.name}: Declared script entry must be a file`,
          path: script.entry
        })
      }
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        diagnostics.push({
          level: 'error',
          message: `${script.name}: Declared script entry does not exist`,
          path: script.entry
        })
      } else {
        throw error
      }
    }
  }

  for (const command of loaded.manifest.commands) {
    let entryPath: string
    try {
      entryPath = await resolvePluginComponentPathAsync(loaded.pluginRoot, command.entry)
    } catch (error) {
      diagnostics.push({
        level: 'error',
        message: `${command.name}: ${error instanceof Error ? error.message : String(error)}`,
        path: command.entry
      })
      continue
    }

    if (!binPath) {
      diagnostics.push({
        level: 'error',
        message: `${command.name}: Plugin commands require bin`,
        path: command.entry
      })
      continue
    }

    if (!isPathInside(binPath, entryPath)) {
      diagnostics.push({
        level: 'error',
        message: `${command.name}: Command entry must be inside bin`,
        path: command.entry
      })
      continue
    }

    try {
      const entryStat = await stat(entryPath)
      if (!entryStat.isFile()) {
        diagnostics.push({
          level: 'error',
          message: `${command.name}: Declared command entry must be a file`,
          path: command.entry
        })
      } else if (!isExecutableMode(entryStat.mode)) {
        diagnostics.push({
          level: 'error',
          message: `${command.name}: Declared command entry must be executable`,
          path: command.entry
        })
      }
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        diagnostics.push({
          level: 'error',
          message: `${command.name}: Declared command entry does not exist`,
          path: command.entry
        })
      } else {
        throw error
      }
    }
  }

  if (loaded.manifest.bin && loaded.manifest.commands.length === 0) {
    diagnostics.push({
      level: 'warning',
      message: 'bin is active only for manifest-declared commands',
      path: loaded.manifest.bin
    })
  }

  return diagnostics
}

function addAuthDiagnostics(manifest: NormalizedPluginManifest): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = []
  const auth = manifest.auth
  if (!auth) return diagnostics

  const commandNames = new Set(manifest.commands.map((command) => command.name))
  const authCommands = [
    ['auth.login', auth.login.command],
    ['auth.status', auth.status.command]
  ] as const

  for (const [label, commandName] of authCommands) {
    if (!commandNames.has(commandName)) {
      diagnostics.push({
        level: 'error',
        message: `${label}.command must reference a manifest-declared command: ${commandName}`
      })
    }
  }

  return diagnostics
}

function validateNodeRequirement(
  nodeRequirement: string | undefined,
  diagnostics: PluginDiagnostic[]
): void {
  if (!nodeRequirement) return
  const normalizedRequirement = nodeRequirement.trim().replace(/^v/i, '')
  const exactMatch = normalizedRequirement.match(/^(\d+)(?:\.\d+){0,2}$/)
  const minimumMatch = normalizedRequirement.match(/^>=\s*(\d+)(?:\.\d+){0,2}$/)
  const majorText = exactMatch?.[1] ?? minimumMatch?.[1]
  if (!majorText) {
    diagnostics.push({
      level: 'warning',
      message: `Unsupported Node runtime requirement expression: ${nodeRequirement}`
    })
    return
  }

  const minimumMajor = Number(majorText)
  const currentVersion = currentNodeRuntimeVersion()
  const currentMajor = Number(currentVersion.split('.')[0])
  if (Number.isFinite(minimumMajor) && currentMajor < minimumMajor) {
    diagnostics.push({
      level: 'error',
      message: `Plugin requires Node ${nodeRequirement}, current runtime is ${currentVersion}`
    })
  }
}

function currentNodeRuntimeVersion(): string {
  try {
    return getBundledNodeVersion()
  } catch {
    return BUNDLED_NODE_VERSION
  }
}

function addRuntimeDiagnostics(manifest: NormalizedPluginManifest): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = []
  validateNodeRequirement(manifest.runtime?.node, diagnostics)

  return diagnostics
}

export async function validatePluginPackageAsync(
  pluginRoot: string
): Promise<PluginValidationResult> {
  const normalizedRoot = normalize(pluginRoot)
  const components: PluginValidationComponent[] = []

  try {
    const loaded = await loadPluginManifestAsync(normalizedRoot)
    const diagnostics = [
      ...loaded.diagnostics,
      ...(await addComponentDiagnosticsAsync(loaded, components)),
      ...(await addCommandDiagnosticsAsync(loaded)),
      ...addAuthDiagnostics(loaded.manifest),
      ...addRuntimeDiagnostics(loaded.manifest)
    ]

    return {
      ok: diagnostics.every(
        (diagnostic) => diagnostic.level !== 'error' || diagnostic.fatal === false
      ),
      pluginRoot: loaded.pluginRoot,
      manifestPath: loaded.manifestPath,
      manifest: loaded.manifest,
      diagnostics,
      components
    }
  } catch (error) {
    return {
      ok: false,
      pluginRoot: normalizedRoot,
      manifestPath: null,
      manifest: null,
      diagnostics: [
        {
          level: 'error',
          message: error instanceof Error ? error.message : String(error)
        }
      ],
      components
    }
  }
}
