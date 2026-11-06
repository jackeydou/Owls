import { access, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import type { PluginDiagnostic } from '../plugin-types.js'
import {
  AGENT_HOOK_EVENT_NAMES,
  type AgentCommandHook,
  type AgentHookConfig,
  type AgentHookEventName,
  type AgentHookMatcherGroup,
  type PluginHookDeclaration,
  type PluginHookEventSummary,
  type PluginHookSource
} from './hook-types.js'

const OWLS_AGENT_PLUGIN_HOOK_CONFIG_PATH = './com.owls.app/hooks/hooks.json'
const LEGACY_AGENT_PLUGIN_HOOK_CONFIG_PATH = './com.pix.app/hooks/hooks.json'
const HOOK_EVENT_NAMES = new Set<string>(AGENT_HOOK_EVENT_NAMES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = normalize(parent)
  const normalizedChild = normalize(child)
  return (
    normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${sep}`)
  )
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function resolvePluginHookConfigPathAsync(
  pluginRoot: string,
  configPath: string
): Promise<string> {
  if (!configPath.startsWith('./')) {
    throw new Error(`Hook config path must start with "./": ${configPath}`)
  }
  if (isAbsolute(configPath)) {
    throw new Error(`Hook config path must be relative: ${configPath}`)
  }

  const resolved = resolve(pluginRoot, configPath)
  if (!isPathInside(pluginRoot, resolved)) {
    throw new Error(`Hook config path escapes plugin root: ${configPath}`)
  }

  if (await pathExists(resolved)) {
    const realRoot = await realpath(pluginRoot)
    const realResolved = await realpath(resolved)
    if (!isPathInside(realRoot, realResolved)) {
      throw new Error(`Hook config path follows symlink outside plugin root: ${configPath}`)
    }
  }

  return resolved
}

async function readHookConfigFileAsync(
  pluginRoot: string,
  configPath: string
): Promise<unknown | null> {
  const resolved = await resolvePluginHookConfigPathAsync(pluginRoot, configPath)
  if (!(await pathExists(resolved))) {
    throw new Error(`Hook config file does not exist: ${configPath}`)
  }

  const raw = await readFile(resolved, 'utf8')
  return JSON.parse(raw) as unknown
}

function pushDiagnostic(
  diagnostics: PluginDiagnostic[],
  level: PluginDiagnostic['level'],
  message: string,
  source: PluginHookSource
): void {
  diagnostics.push({
    level,
    message,
    path: 'path' in source ? source.path : undefined
  })
}

function validateMatcher(
  rawMatcher: unknown,
  diagnostics: PluginDiagnostic[],
  source: PluginHookSource
): { matcher?: string; valid: boolean } {
  if (rawMatcher === undefined) return { valid: true }
  if (typeof rawMatcher !== 'string') {
    pushDiagnostic(diagnostics, 'error', 'Hook matcher must be a string', source)
    return { valid: false }
  }

  const matcher = rawMatcher.trim()
  if (!matcher || matcher === '*') return { matcher: rawMatcher, valid: true }

  try {
    new RegExp(matcher)
    return { matcher: rawMatcher, valid: true }
  } catch (error) {
    pushDiagnostic(
      diagnostics,
      'warning',
      `Hook matcher is not a valid regex and will be skipped: ${
        error instanceof Error ? error.message : String(error)
      }`,
      source
    )
    return { matcher: rawMatcher, valid: false }
  }
}

function parseCommandHook(
  rawHook: unknown,
  diagnostics: PluginDiagnostic[],
  source: PluginHookSource
): AgentCommandHook | null {
  if (!isRecord(rawHook)) {
    pushDiagnostic(diagnostics, 'error', 'Hook handler must be an object', source)
    return null
  }

  if (rawHook.type !== 'command') {
    pushDiagnostic(diagnostics, 'error', 'Hook handler type must be "command"', source)
    return null
  }

  const command = optionalString(rawHook.command)
  if (!command) {
    pushDiagnostic(diagnostics, 'error', 'Hook command must be a non-empty string', source)
    return null
  }

  const hook: AgentCommandHook = {
    type: 'command',
    command
  }

  if (rawHook.timeout !== undefined) {
    if (
      typeof rawHook.timeout !== 'number' ||
      !Number.isFinite(rawHook.timeout) ||
      rawHook.timeout <= 0
    ) {
      pushDiagnostic(diagnostics, 'error', 'Hook timeout must be a positive number', source)
      return null
    }
    hook.timeout = rawHook.timeout
  }

  if (rawHook.statusMessage !== undefined) {
    const statusMessage = optionalString(rawHook.statusMessage)
    if (!statusMessage) {
      pushDiagnostic(diagnostics, 'error', 'Hook statusMessage must be a non-empty string', source)
      return null
    }
    hook.statusMessage = statusMessage
  }

  return hook
}

function parseMatcherGroup(
  rawGroup: unknown,
  diagnostics: PluginDiagnostic[],
  source: PluginHookSource
): AgentHookMatcherGroup | null {
  if (!isRecord(rawGroup)) {
    pushDiagnostic(diagnostics, 'error', 'Hook matcher group must be an object', source)
    return null
  }

  const matcher = validateMatcher(rawGroup.matcher, diagnostics, source)
  if (!matcher.valid) return null

  if (!Array.isArray(rawGroup.hooks)) {
    pushDiagnostic(diagnostics, 'error', 'Hook matcher group hooks must be an array', source)
    return null
  }

  const hooks = rawGroup.hooks
    .map((rawHook) => parseCommandHook(rawHook, diagnostics, source))
    .filter((hook): hook is AgentCommandHook => hook !== null)

  if (hooks.length === 0) return null

  return {
    matcher: matcher.matcher,
    hooks
  }
}

function eventSummary(
  event: AgentHookEventName,
  groups: AgentHookMatcherGroup[]
): PluginHookEventSummary {
  return {
    event,
    matcherGroupCount: groups.length,
    commandCount: groups.reduce((count, group) => count + group.hooks.length, 0)
  }
}

function parseHookConfig(
  rawConfig: unknown,
  diagnostics: PluginDiagnostic[],
  source: PluginHookSource
): PluginHookDeclaration | null {
  if (!isRecord(rawConfig)) {
    pushDiagnostic(diagnostics, 'error', 'Hook config must be a JSON object', source)
    return null
  }

  const config: AgentHookConfig = {}
  const managedDir = optionalString(rawConfig.managed_dir)
  if (managedDir) config.managed_dir = managedDir
  const windowsManagedDir = optionalString(rawConfig.windows_managed_dir)
  if (windowsManagedDir) config.windows_managed_dir = windowsManagedDir
  const requirements = optionalString(rawConfig.requirements)
  if (requirements) config.requirements = requirements

  const rawHooks = rawConfig.hooks
  if (rawHooks === undefined) {
    return {
      source,
      config,
      events: [],
      matcherGroupCount: 0,
      commandCount: 0
    }
  }

  if (!isRecord(rawHooks)) {
    pushDiagnostic(diagnostics, 'error', 'Hook config hooks must be an object', source)
    return null
  }

  const hooks: AgentHookConfig['hooks'] = {}
  const events: PluginHookEventSummary[] = []

  for (const [eventName, rawGroups] of Object.entries(rawHooks)) {
    if (!HOOK_EVENT_NAMES.has(eventName)) {
      pushDiagnostic(diagnostics, 'error', `Unsupported agent hook event: ${eventName}`, source)
      continue
    }

    if (!Array.isArray(rawGroups)) {
      pushDiagnostic(diagnostics, 'error', `Hook event ${eventName} must be an array`, source)
      continue
    }

    const groups = rawGroups
      .map((rawGroup) => parseMatcherGroup(rawGroup, diagnostics, source))
      .filter((group): group is AgentHookMatcherGroup => group !== null)

    if (groups.length === 0) continue
    const event = eventName as AgentHookEventName
    hooks[event] = groups
    events.push(eventSummary(event, groups))
  }

  events.sort(
    (left, right) =>
      AGENT_HOOK_EVENT_NAMES.indexOf(left.event) - AGENT_HOOK_EVENT_NAMES.indexOf(right.event)
  )

  config.hooks = hooks
  return {
    source,
    config,
    events,
    matcherGroupCount: events.reduce((count, event) => count + event.matcherGroupCount, 0),
    commandCount: events.reduce((count, event) => count + event.commandCount, 0)
  }
}

function normalizeConfigValues(rawConfig: unknown): unknown[] {
  return Array.isArray(rawConfig) ? rawConfig : [rawConfig]
}

async function loadHookConfigPathAsync(
  pluginRoot: string,
  configPath: string,
  sourceType: 'path' | 'default-path',
  sourceIndex: number,
  diagnostics: PluginDiagnostic[]
): Promise<PluginHookDeclaration[]> {
  const source: PluginHookSource = {
    type: sourceType,
    path: configPath,
    index: sourceIndex
  }

  try {
    const rawConfig = await readHookConfigFileAsync(pluginRoot, configPath)
    return normalizeConfigValues(rawConfig)
      .map((config, index) =>
        parseHookConfig(config, diagnostics, {
          ...source,
          index
        })
      )
      .filter((declaration): declaration is PluginHookDeclaration => declaration !== null)
  } catch (error) {
    pushDiagnostic(
      diagnostics,
      'error',
      error instanceof Error ? error.message : String(error),
      source
    )
    return []
  }
}

export async function loadOwlsAgentPluginHookDeclarationsAsync(
  pluginRoot: string,
  diagnostics: PluginDiagnostic[]
): Promise<PluginHookDeclaration[]> {
  const configPath = (await pathExists(resolve(pluginRoot, OWLS_AGENT_PLUGIN_HOOK_CONFIG_PATH)))
    ? OWLS_AGENT_PLUGIN_HOOK_CONFIG_PATH
    : LEGACY_AGENT_PLUGIN_HOOK_CONFIG_PATH
  if (!(await pathExists(resolve(pluginRoot, configPath)))) return []
  return await loadHookConfigPathAsync(pluginRoot, configPath, 'path', 0, diagnostics)
}
