import { AsyncLocalStorage } from 'node:async_hooks'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, parse as parsePath, resolve } from 'node:path'
import { SandboxManager, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import type { BashOperations } from '@earendil-works/pi-coding-agent'
import * as nodePty from 'node-pty'
import { type ParseEntry, parse } from 'shell-quote'
import type { ToolApprovalRequestForRenderer } from '../../shared/tool-approval.js'
import {
  type BackgroundTerminalStatus,
  markBackgroundTerminalOutputRead,
  pollBackgroundTerminalOutput,
  registerBackgroundTerminal,
  releaseRetainedBackgroundTerminal,
  terminateBackgroundTerminal
} from '../background-terminals.js'

const SANDBOX_TMPDIR = '/tmp/claude'
const BRACED_HOME_VARIABLE = '$' + '{HOME}'
const PRIVATE_HOME_PATHS = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.kube',
  '.azure',
  '.docker/config.json',
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.config/gh',
  '.config/gcloud',
  '.config/hub'
]
const PRIVATE_PICHU_READ_PATHS = [
  '.pichu/pichu.db*',
  '.pichu/config.toml',
  '.pichu/pichu-bootstrap.json*',
  '.pichu/logs',
  '.pichu/model-trajectories',
  '.pichu/attachments',
  '.pichu/workbench',
  '.pichu/admin-workbench',
  '.pichu/plugins/data',
  '.pichu/plugins/logs',
  '.pichu/runtimes/db',
  '.pichu/runtimes/logs',
  '.pichu/runtimes/tmp'
]
const approvedSandboxEscalations = new Map<string, PichuBashSandboxEscalation>()
const bashToolCallContext = new AsyncLocalStorage<string>()
const WINDOWS_GIT_BASH_PATHS = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
]

let sandboxSupportCache:
  | {
      platform: NodeJS.Platform
      supported: boolean
    }
  | undefined

export type PichuBashSandboxEscalation = {
  allowNetwork: boolean
  allowWritePaths: string[]
}

export type PichuManagedExecResult = {
  sessionId: string | null
  output: string
  originalOutputLength: number
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  terminalStatus: BackgroundTerminalStatus | null
}

export type PichuManagedExecOptions = {
  command: string
  cwd: string
  env?: NodeJS.ProcessEnv
  shellPath?: string
  sessionId?: string | null
  toolCallId?: string | null
  hookCommand?: string | null
  signal?: AbortSignal
  timeoutSeconds?: number
  yieldTimeMs: number
  maxOutputChars?: number
  tty?: boolean
  shouldSandbox?: () => boolean
  allowNetworkByDefault?: () => boolean
}

function normalizeExistingPath(path: string): string {
  const absolutePath = resolve(path)
  try {
    return realpathSync(absolutePath)
  } catch {
    return absolutePath
  }
}

function homePath(path: string): string {
  return join(homedir(), path)
}

function defaultPichuDataRoot(): string {
  return join(homedir(), '.pichu')
}

function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function readLegacyPichuDataRoot(): string | null {
  try {
    const bootstrapPath = join(defaultPichuDataRoot(), 'pichu-bootstrap.json')
    const parsed = JSON.parse(readFileSync(bootstrapPath, 'utf8')) as { dataRoot?: unknown }
    if (typeof parsed.dataRoot === 'string' && parsed.dataRoot.trim()) {
      return resolve(expandHomePath(parsed.dataRoot.trim()))
    }
  } catch {
    // ignore
  }
  return null
}

function localRpcSocketPaths(): string[] {
  return uniquePaths(
    [defaultPichuDataRoot(), readLegacyPichuDataRoot()]
      .filter((value): value is string => Boolean(value))
      .map((dataRoot) => join(dataRoot, 'run', 'pichu.sock'))
  )
}

function runtimePackageManagerWritePaths(): string[] {
  return uniquePaths(
    [defaultPichuDataRoot(), readLegacyPichuDataRoot()]
      .filter((value): value is string => Boolean(value))
      .flatMap((dataRoot) => [
        join(dataRoot, 'runtimes', 'npm-cache'),
        join(dataRoot, 'runtimes', 'npm-global')
      ])
  )
}

function shellNameForSandbox(shellPath: string | undefined): string | undefined {
  if (!shellPath) return undefined
  return shellPath.includes('/') ? basename(shellPath) : shellPath
}

function resolveBashShellPath(shellPath: string | undefined): string {
  if (shellPath) return shellPath
  if (process.platform !== 'win32') return 'bash'
  return WINDOWS_GIT_BASH_PATHS.find((path) => existsSync(path)) ?? 'bash.exe'
}

function killProcessGroup(processGroupId: number | undefined, signal: NodeJS.Signals): boolean {
  if (process.platform === 'win32' || !processGroupId) return false
  try {
    process.kill(-processGroupId, signal)
    return true
  } catch {
    return false
  }
}

function shellVariable(name: string): string {
  return `$${name}`
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))]
}

function normalizeApprovedPathToken(token: string): string | null {
  if (!token || token.includes('\0')) return null
  if (/[*?[\]{}]/.test(token)) return null

  let expanded = token
  if (expanded === '~') expanded = homedir()
  else if (expanded.startsWith('~/')) expanded = join(homedir(), expanded.slice(2))
  else if (expanded === '$HOME' || expanded === BRACED_HOME_VARIABLE) expanded = homedir()
  else if (expanded.startsWith('$HOME/')) expanded = join(homedir(), expanded.slice(6))
  else if (expanded.startsWith(`${BRACED_HOME_VARIABLE}/`)) {
    expanded = join(homedir(), expanded.slice(BRACED_HOME_VARIABLE.length + 1))
  }

  if (!expanded.startsWith('/')) return null
  const normalized = normalizeExistingPath(expanded)
  return normalized === parsePath(normalized).root ? null : normalized
}

function isShellOperator(entry: ParseEntry): boolean {
  return typeof entry === 'object' && entry !== null && 'op' in entry
}

function extractApprovedWritePaths(command: string): string[] {
  let entries: ParseEntry[]
  try {
    entries = parse(command, shellVariable)
  } catch {
    return []
  }

  const paths: string[] = []
  let currentSegmentExecutable: string | undefined
  let currentCommandIsRm = false
  let endOfOptions = false

  for (const entry of entries) {
    if (isShellOperator(entry)) {
      currentSegmentExecutable = undefined
      currentCommandIsRm = false
      endOfOptions = false
      continue
    }
    if (typeof entry !== 'string') continue

    if (!currentSegmentExecutable) {
      currentSegmentExecutable = entry
      currentCommandIsRm = basename(entry) === 'rm'
      continue
    }
    if (!endOfOptions && entry === '--') {
      endOfOptions = true
      continue
    }
    if (!endOfOptions && entry.startsWith('-')) continue

    const path = normalizeApprovedPathToken(entry)
    if (path) paths.push(path)
    if (currentCommandIsRm) paths.push(join(homedir(), '.Trash'))
  }

  return uniquePaths(paths)
}

export function buildPichuBashSandboxEscalationForApproval(
  request: ToolApprovalRequestForRenderer
): PichuBashSandboxEscalation | null {
  if (request.toolName !== 'exec_command') return null
  const action = request.autoReviewAction
  if (action?.type !== 'command') return null
  return {
    allowNetwork: false,
    allowWritePaths: extractApprovedWritePaths(action.command)
  }
}

export function registerPichuBashSandboxEscalationForApproval(
  request: ToolApprovalRequestForRenderer
): void {
  const escalation = buildPichuBashSandboxEscalationForApproval(request)
  if (!escalation) return
  approvedSandboxEscalations.set(request.toolUseId, escalation)
}

export function runPichuBashSandboxContext<T>(
  toolCallId: string,
  fn: () => Promise<T>
): Promise<T> {
  return bashToolCallContext.run(toolCallId, fn)
}

function consumeSandboxEscalationForCurrentToolCall(): PichuBashSandboxEscalation | undefined {
  const toolCallId = bashToolCallContext.getStore()
  if (!toolCallId) return undefined
  const escalation = approvedSandboxEscalations.get(toolCallId)
  approvedSandboxEscalations.delete(toolCallId)
  return escalation
}

export function isPichuBashSandboxSupported(): boolean {
  const platform = process.platform
  if (sandboxSupportCache?.platform === platform) return sandboxSupportCache.supported
  const supported =
    (platform === 'darwin' || platform === 'linux') &&
    (() => {
      try {
        return SandboxManager.checkDependencies().errors.length === 0
      } catch {
        return false
      }
    })()
  sandboxSupportCache = { platform, supported }
  return supported
}

export function buildPichuBashSandboxConfig(
  cwd: string,
  escalation?: PichuBashSandboxEscalation,
  options: {
    allowNetworkByDefault?: boolean
    allowLocalRpc?: boolean
    allowRuntimePackageManagerWrites?: boolean
    allowWritePaths?: string[]
    allowWorkspaceWrite?: boolean
    pluginDataPath?: string
  } = {}
): Partial<SandboxRuntimeConfig> {
  const workspaceRoot = normalizeExistingPath(cwd)
  const tmpRoot = normalizeExistingPath(tmpdir())
  const pluginDataPath = options.pluginDataPath
    ? normalizeExistingPath(options.pluginDataPath)
    : undefined
  const pluginDataParent = pluginDataPath
    ? normalizeExistingPath(join(pluginDataPath, '..'))
    : undefined
  const protectedReadPaths = PRIVATE_PICHU_READ_PATHS.map(homePath).filter(
    (path) => !pluginDataParent || normalizeExistingPath(path) !== pluginDataParent
  )
  const siblingPluginDataPaths =
    pluginDataPath && pluginDataParent
      ? readdirSync(pluginDataParent, { withFileTypes: true })
          .filter((entry) => entry.name !== basename(pluginDataPath))
          .map((entry) => join(pluginDataParent, entry.name))
      : []
  const filesystem = {
    denyRead: [
      ...PRIVATE_HOME_PATHS.map(homePath),
      ...protectedReadPaths,
      ...siblingPluginDataPaths,
      homePath('Library/Application Support/Pichu'),
      join(workspaceRoot, '.env'),
      join(workspaceRoot, '.env.*'),
      `${workspaceRoot}/**/.env`,
      `${workspaceRoot}/**/.env.*`
    ],
    allowWrite: uniquePaths([
      ...(options.allowWorkspaceWrite === false ? [] : [workspaceRoot]),
      tmpRoot,
      SANDBOX_TMPDIR,
      '/tmp',
      '/private/tmp',
      ...(options.allowRuntimePackageManagerWrites === false
        ? []
        : runtimePackageManagerWritePaths()),
      ...(options.allowWritePaths ?? []).map(normalizeExistingPath),
      ...(escalation?.allowWritePaths ?? [])
    ]),
    denyWrite: [
      ...PRIVATE_HOME_PATHS.map(homePath),
      ...protectedReadPaths,
      ...siblingPluginDataPaths,
      homePath('Library/Application Support/Pichu'),
      join(workspaceRoot, '.env'),
      join(workspaceRoot, '.env.*'),
      `${workspaceRoot}/**/.env`,
      `${workspaceRoot}/**/.env.*`,
      `${workspaceRoot}/**/*.key`,
      `${workspaceRoot}/**/*.pem`,
      join(workspaceRoot, '.git', 'hooks'),
      `${workspaceRoot}/.git/hooks/**`,
      join(workspaceRoot, '.git', 'config')
    ],
    allowGitConfig: false
  }
  const config: Partial<SandboxRuntimeConfig> = {
    filesystem
  }
  if (!escalation?.allowNetwork && !options.allowNetworkByDefault) {
    config.network = {
      allowedDomains: [],
      deniedDomains: [],
      allowUnixSockets: options.allowLocalRpc === false ? [] : localRpcSocketPaths()
    }
  }
  return config
}

function quoteShellToken(value: string): string {
  if (value.includes('\0')) throw new Error('Command tokens cannot contain NUL bytes')
  return `'${value.replaceAll("'", "'\\''")}'`
}

export async function preparePichuSandboxedStdioCommand(options: {
  command: string
  args: string[]
  cwd: string
  allowWritePaths?: string[]
  pluginDataPath?: string
}): Promise<{ command: string; args: string[] }> {
  if (!isPichuBashSandboxSupported()) {
    return { command: options.command, args: options.args }
  }

  const command = [options.command, ...options.args].map(quoteShellToken).join(' ')
  const sandboxedCommand = await SandboxManager.wrapWithSandbox(
    command,
    'bash',
    buildPichuBashSandboxConfig(options.cwd, undefined, {
      allowNetworkByDefault: false,
      allowLocalRpc: false,
      allowRuntimePackageManagerWrites: false,
      allowWritePaths: options.allowWritePaths,
      allowWorkspaceWrite: false,
      pluginDataPath: options.pluginDataPath
    })
  )
  return {
    command: resolveBashShellPath(undefined),
    args: ['-c', sandboxedCommand]
  }
}

function runManagedCommand(
  command: string,
  cwd: string,
  options: Parameters<BashOperations['exec']>[2],
  params: {
    shellPath?: string
    sessionId?: string | null
  } = {}
): Promise<{ exitCode: number | null }> {
  return new Promise((resolvePromise, reject) => {
    if (!existsSync(cwd)) {
      reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`))
      return
    }

    mkdirSync(SANDBOX_TMPDIR, { recursive: true })

    const shouldStreamOutput = typeof options.onData === 'function'
    const child = spawn(resolveBashShellPath(params.shellPath), ['-c', command], {
      cwd,
      detached: process.platform !== 'win32',
      env: options.env,
      stdio: [
        'ignore',
        shouldStreamOutput ? 'pipe' : 'ignore',
        shouldStreamOutput ? 'pipe' : 'ignore'
      ]
    })
    let backgroundTerminalId: string | null = null
    let pendingForceTerminate = false

    const safeTerminateManagedChild = () => {
      try {
        if (backgroundTerminalId) {
          terminateBackgroundTerminal(backgroundTerminalId, { force: true })
          return
        }
        child.kill('SIGKILL')
      } catch {
        // Best-effort cleanup: timeout/abort/error handlers must not throw.
      }
    }

    const forceTerminateManagedChild = () => {
      pendingForceTerminate = true
      safeTerminateManagedChild()
    }

    child.once('spawn', () => {
      backgroundTerminalId = registerBackgroundTerminal({
        child,
        command,
        cwd,
        sessionId: params.sessionId,
        processGroupId: process.platform === 'win32' ? null : (child.pid ?? null),
        preserveProcessGroupOnChildExit: false
      })
      if (pendingForceTerminate) {
        safeTerminateManagedChild()
      }
    })

    let timedOut = false
    let timeoutHandle: NodeJS.Timeout | undefined

    if (options.timeout !== undefined && options.timeout > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        forceTerminateManagedChild()
      }, options.timeout * 1000)
    }

    if (shouldStreamOutput) {
      child.stdout?.on('data', options.onData)
      child.stderr?.on('data', options.onData)
    }

    const onAbort = () => {
      forceTerminateManagedChild()
    }

    if (options.signal) {
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.on('error', (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      options.signal?.removeEventListener('abort', onAbort)
      if (backgroundTerminalId) safeTerminateManagedChild()
      reject(error)
    })

    child.on('close', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      options.signal?.removeEventListener('abort', onAbort)
      if (options.signal?.aborted) {
        reject(new Error('aborted'))
        return
      }
      if (timedOut) {
        reject(new Error(`timeout:${options.timeout}`))
        return
      }
      resolvePromise({ exitCode: code })
    })
  })
}

async function commandForPichuSandbox(
  command: string,
  shellPath: string | undefined,
  cwd: string,
  options: {
    shouldSandbox?: () => boolean
    allowNetworkByDefault?: () => boolean
    signal?: AbortSignal
  }
): Promise<string> {
  if (options.shouldSandbox?.() === false || !isPichuBashSandboxSupported()) return command
  return SandboxManager.wrapWithSandbox(
    command,
    shellNameForSandbox(shellPath),
    buildPichuBashSandboxConfig(cwd, consumeSandboxEscalationForCurrentToolCall(), {
      allowNetworkByDefault: options.allowNetworkByDefault?.() === true
    }),
    options.signal
  )
}

export async function runPichuManagedExecCommand(
  options: PichuManagedExecOptions
): Promise<PichuManagedExecResult> {
  if (!existsSync(options.cwd)) {
    throw new Error(`Working directory does not exist: ${options.cwd}\nCannot execute commands.`)
  }

  mkdirSync(SANDBOX_TMPDIR, { recursive: true })
  const command = await commandForPichuSandbox(options.command, options.shellPath, options.cwd, {
    shouldSandbox: options.shouldSandbox,
    allowNetworkByDefault: options.allowNetworkByDefault,
    signal: options.signal
  })

  let terminalId: string | null = null
  let timedOut = false
  let timeoutHandle: NodeJS.Timeout | undefined
  let keepTimeoutAfterReturn = false
  let pipeChild: ReturnType<typeof spawn> | null = null
  let ptyProcess: nodePty.IPty | null = null

  const terminateChild = () => {
    try {
      if (terminalId) {
        terminateBackgroundTerminal(terminalId, { force: true })
      } else {
        if (!killProcessGroup(pipeChild?.pid, 'SIGKILL')) {
          pipeChild?.kill('SIGKILL')
        }
        if (!killProcessGroup(ptyProcess?.pid, 'SIGKILL')) {
          ptyProcess?.kill('SIGKILL')
        }
      }
    } catch {
      // Best-effort cleanup.
    }
  }

  const onAbort = () => terminateChild()
  if (options.signal) {
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    if (options.signal?.aborted) throw new Error('aborted')

    if (options.tty === true) {
      ptyProcess = nodePty.spawn(resolveBashShellPath(options.shellPath), ['-c', command], {
        cwd: options.cwd,
        env: options.env,
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        encoding: 'utf8'
      })
      terminalId = registerBackgroundTerminal({
        ptyProcess,
        command: options.command,
        cwd: options.cwd,
        sessionId: options.sessionId,
        toolCallId: options.toolCallId,
        hookCommand: options.hookCommand,
        processGroupId: process.platform === 'win32' ? null : ptyProcess.pid,
        retainOnExit: true,
        captureOutput: true
      })
      if (options.signal?.aborted) {
        terminateChild()
        throw new Error('aborted')
      }
    } else {
      const child = spawn(resolveBashShellPath(options.shellPath), ['-c', command], {
        cwd: options.cwd,
        detached: process.platform !== 'win32',
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      pipeChild = child
      terminalId = await new Promise<string>((resolvePromise, reject) => {
        child.once('spawn', () => {
          const registeredTerminalId = registerBackgroundTerminal({
            child,
            command: options.command,
            cwd: options.cwd,
            sessionId: options.sessionId,
            toolCallId: options.toolCallId,
            hookCommand: options.hookCommand,
            processGroupId: process.platform === 'win32' ? null : (child.pid ?? null),
            retainOnExit: true,
            captureOutput: true
          })
          if (options.signal?.aborted) {
            terminateBackgroundTerminal(registeredTerminalId, { force: true })
          }
          resolvePromise(registeredTerminalId)
        })
        child.once('error', reject)
      })
      if (options.signal?.aborted) {
        terminateChild()
        throw new Error('aborted')
      }
    }

    if (options.timeoutSeconds !== undefined && options.timeoutSeconds > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        terminateChild()
      }, options.timeoutSeconds * 1000)
      timeoutHandle.unref()
    }

    const snapshot = await pollBackgroundTerminalOutput(terminalId, {
      yieldTimeMs: options.yieldTimeMs,
      maxChars: options.maxOutputChars,
      advance: true
    })
    if (options.signal?.aborted) throw new Error('aborted')
    if (!snapshot) throw new Error(`Unknown exec session ${terminalId}.`)

    if (snapshot.running) {
      keepTimeoutAfterReturn = timeoutHandle !== undefined
      options.signal?.removeEventListener('abort', onAbort)
      return {
        sessionId: terminalId,
        output: snapshot.output,
        originalOutputLength: snapshot.originalOutputLength,
        exitCode: snapshot.exitCode,
        signalCode: snapshot.signalCode,
        terminalStatus: snapshot.status
      }
    }

    releaseRetainedBackgroundTerminal(terminalId)
    if (timedOut) throw new Error(`timeout:${options.timeoutSeconds}`)
    return {
      sessionId: null,
      output: snapshot.output,
      originalOutputLength: snapshot.originalOutputLength,
      exitCode: snapshot.exitCode,
      signalCode: snapshot.signalCode,
      terminalStatus: snapshot.status
    }
  } finally {
    if (timeoutHandle && !keepTimeoutAfterReturn) clearTimeout(timeoutHandle)
    options.signal?.removeEventListener('abort', onAbort)
    if (terminalId) markBackgroundTerminalOutputRead(terminalId)
  }
}

export function createPichuSandboxedBashOperations(
  params: {
    shellPath?: string
    shouldSandbox?: () => boolean
    allowNetworkByDefault?: () => boolean
    getCurrentSessionId?: () => string | null
  } = {}
): BashOperations {
  return {
    async exec(command, cwd, options) {
      if (params.shouldSandbox?.() === false || !isPichuBashSandboxSupported()) {
        return runManagedCommand(command, cwd, options, {
          shellPath: params.shellPath,
          sessionId: params.getCurrentSessionId?.() ?? null
        })
      }

      const sandboxedCommand = await SandboxManager.wrapWithSandbox(
        command,
        shellNameForSandbox(params.shellPath),
        buildPichuBashSandboxConfig(cwd, consumeSandboxEscalationForCurrentToolCall(), {
          allowNetworkByDefault: params.allowNetworkByDefault?.() === true
        }),
        options.signal
      )
      return runManagedCommand(sandboxedCommand, cwd, options, {
        sessionId: params.getCurrentSessionId?.() ?? null
      })
    }
  }
}
