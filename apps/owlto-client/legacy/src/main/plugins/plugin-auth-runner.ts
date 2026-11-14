import { spawn } from 'node:child_process'
import { delimiter } from 'node:path'
import { findBundledNodeBinPath } from '../node-runtime.js'
import { resolvePluginComponentPathAsync } from './manifest-loader.js'
import type { InstalledPlugin, PluginAuthCommand } from './plugin-types.js'

const AUTH_COMMAND_TIMEOUT_MS = 5 * 60 * 1000
const AUTH_STATUS_TIMEOUT_MS = 10_000
const AUTH_COMMAND_FORCE_KILL_GRACE_MS = 2_000
const AUTH_COMMAND_FORCE_RESOLVE_GRACE_MS = 1_000
const AUTH_OUTPUT_LIMIT = 16 * 1024

export type PluginAuthCommandPhase = 'status' | 'login'

export type PluginAuthCommandResult = {
  phase: PluginAuthCommandPhase
  command: string
  args: string[]
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  cancelled: boolean
  stdout: string
  stderr: string
}

export type PluginAuthLoginResult =
  | { skipped: true; status: PluginAuthCommandResult }
  | { skipped: false; login: PluginAuthCommandResult; status: PluginAuthCommandResult | null }

export class PluginAuthError extends Error {
  readonly phase: PluginAuthCommandPhase
  readonly result: PluginAuthCommandResult

  constructor(
    plugin: InstalledPlugin,
    phase: PluginAuthCommandPhase,
    result: PluginAuthCommandResult
  ) {
    super(
      `Plugin auth ${phase} failed for ${plugin.name}: ${
        result.timedOut ? 'timed out' : `exit code ${result.exitCode ?? 'unknown'}`
      }`
    )
    this.name = 'PluginAuthError'
    this.phase = phase
    this.result = result
  }
}

export class PluginAuthCancelledError extends Error {
  readonly phase: PluginAuthCommandPhase
  readonly result: PluginAuthCommandResult

  constructor(
    plugin: InstalledPlugin,
    phase: PluginAuthCommandPhase,
    result: PluginAuthCommandResult
  ) {
    super(`Plugin auth ${phase} cancelled for ${plugin.name}`)
    this.name = 'PluginAuthCancelledError'
    this.phase = phase
    this.result = result
  }
}

export type PluginAuthRunOptions = {
  timeoutMs?: number
  forceKillGraceMs?: number
  forceResolveGraceMs?: number
  signal?: AbortSignal
  onCommandStart?: (phase: PluginAuthCommandPhase) => void
}

function appendLimited(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8')
  return next.length > AUTH_OUTPUT_LIMIT ? next.slice(-AUTH_OUTPUT_LIMIT) : next
}

function buildAuthEnv(
  plugin: InstalledPlugin,
  pluginDataPath: string,
  binPath: string | null
): NodeJS.ProcessEnv {
  const nodeBinPath = findBundledNodeBinPath()
  return {
    ...process.env,
    AGENT_PLUGIN_ROOT: plugin.cachePath,
    AGENT_PLUGIN_DATA: pluginDataPath,
    PATH: [nodeBinPath, binPath, process.env.PATH].filter(Boolean).join(delimiter)
  }
}

async function runAuthCommand(
  plugin: InstalledPlugin,
  authCommand: PluginAuthCommand,
  phase: PluginAuthCommandPhase,
  pluginDataPath: string,
  binPath: string | null,
  options: PluginAuthRunOptions = {}
): Promise<PluginAuthCommandResult> {
  const declaredCommand = plugin.manifest.commands.find(
    (command) => command.name === authCommand.command
  )
  if (!declaredCommand) {
    throw new Error(`Plugin auth.${phase}.command is not declared: ${authCommand.command}`)
  }

  const entryPath = await resolvePluginComponentPathAsync(plugin.cachePath, declaredCommand.entry)
  if (options.signal?.aborted) {
    throw new PluginAuthCancelledError(plugin, phase, {
      phase,
      command: authCommand.command,
      args: authCommand.args,
      exitCode: null,
      signal: null,
      timedOut: false,
      cancelled: true,
      stdout: '',
      stderr: ''
    })
  }
  options.onCommandStart?.(phase)
  if (options.signal?.aborted) {
    throw new PluginAuthCancelledError(plugin, phase, {
      phase,
      command: authCommand.command,
      args: authCommand.args,
      exitCode: null,
      signal: null,
      timedOut: false,
      cancelled: true,
      stdout: '',
      stderr: ''
    })
  }
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let cancelled = false
    let terminating = false
    const timeoutMs = options.timeoutMs ?? AUTH_COMMAND_TIMEOUT_MS
    const forceKillGraceMs = options.forceKillGraceMs ?? AUTH_COMMAND_FORCE_KILL_GRACE_MS
    const forceResolveGraceMs = options.forceResolveGraceMs ?? AUTH_COMMAND_FORCE_RESOLVE_GRACE_MS
    const child = spawn(entryPath, authCommand.args, {
      cwd: plugin.cachePath,
      env: buildAuthEnv(plugin, pluginDataPath, binPath),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let timeout: NodeJS.Timeout | null = null
    let forceKillTimeout: NodeJS.Timeout | null = null
    let forceResolveTimeout: NodeJS.Timeout | null = null
    let abortHandler: (() => void) | null = null

    const clearTimers = () => {
      if (timeout) clearTimeout(timeout)
      if (forceKillTimeout) clearTimeout(forceKillTimeout)
      if (forceResolveTimeout) clearTimeout(forceResolveTimeout)
      if (abortHandler) options.signal?.removeEventListener('abort', abortHandler)
      abortHandler = null
    }

    const resolveResult = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      clearTimers()
      resolve({
        phase,
        command: authCommand.command,
        args: authCommand.args,
        exitCode,
        signal,
        timedOut,
        cancelled,
        stdout,
        stderr
      })
    }

    const terminateChild = () => {
      if (terminating) return
      terminating = true
      child.kill('SIGTERM')
      forceKillTimeout = setTimeout(() => {
        child.kill('SIGKILL')
        forceResolveTimeout = setTimeout(() => {
          resolveResult(null, 'SIGKILL')
        }, forceResolveGraceMs)
      }, forceKillGraceMs)
    }

    abortHandler = () => {
      if (settled) return
      cancelled = true
      terminateChild()
    }
    options.signal?.addEventListener('abort', abortHandler, { once: true })

    timeout = setTimeout(() => {
      timedOut = true
      terminateChild()
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimers()
      reject(error)
    })
    child.on('close', (exitCode, signal) => {
      resolveResult(exitCode, signal)
    })
  })
}

export async function runPluginAuthLoginAsync(
  plugin: InstalledPlugin,
  pluginDataPath: string,
  options?: PluginAuthRunOptions
): Promise<PluginAuthLoginResult | null> {
  const auth = plugin.manifest.auth
  if (!auth) return null

  const binPath = plugin.manifest.bin
    ? await resolvePluginComponentPathAsync(plugin.cachePath, plugin.manifest.bin)
    : null
  const status = await runAuthCommand(plugin, auth.status, 'status', pluginDataPath, binPath, {
    ...options,
    timeoutMs: Math.min(options?.timeoutMs ?? AUTH_STATUS_TIMEOUT_MS, AUTH_STATUS_TIMEOUT_MS)
  })
  if (status.cancelled) {
    throw new PluginAuthCancelledError(plugin, 'status', status)
  }
  if (status.timedOut) {
    throw new PluginAuthError(plugin, 'status', status)
  }
  if (status.exitCode === 0 && !status.timedOut) {
    return { skipped: true, status }
  }
  const login = await runAuthCommand(plugin, auth.login, 'login', pluginDataPath, binPath, options)
  if (login.cancelled) {
    throw new PluginAuthCancelledError(plugin, 'login', login)
  }
  if (login.exitCode !== 0 || login.timedOut) {
    throw new PluginAuthError(plugin, 'login', login)
  }
  return { skipped: false, login, status }
}
