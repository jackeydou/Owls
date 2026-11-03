import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  type BashSpawnContext,
  createCodingTools,
  createReadOnlyTools,
  type ToolsOptions
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import {
  type BackgroundTerminalStatus,
  pollBackgroundTerminalOutput,
  readBackgroundTerminalOutput,
  releaseRetainedBackgroundTerminal,
  writeBackgroundTerminalStdin
} from '../background-terminals.js'
import { removeUnsupportedNpmConfigEnv, withDefaultRuntimePackageManagerEnv } from '../env.js'
import { findBundledNodeBinPath } from '../node-runtime.js'
import { findDefaultRuntimeCaBundlePath } from '../runtime-certs.js'
import { getAgentTrustProfile } from '../stores/settings-store.js'
import {
  createPichuSandboxedBashOperations,
  runPichuBashSandboxContext,
  runPichuManagedExecCommand
} from './pichu-bash-sandbox.js'

const require = createRequire(import.meta.url)
const DEFAULT_EXEC_YIELD_TIME_MS = 10_000
const DEFAULT_WRITE_STDIN_YIELD_TIME_MS = 250
const DEFAULT_EMPTY_WRITE_STDIN_YIELD_TIME_MS = 5_000
const MAX_EMPTY_WRITE_STDIN_YIELD_TIME_MS = 300_000
const DEFAULT_MAX_OUTPUT_TOKENS = 10_000
const STDIN_CLOSED_ERROR =
  'stdin is closed for this session; rerun exec_command with tty=true to keep stdin open'
const execCommandSchema = Type.Object({
  cmd: Type.String({ description: 'Shell command to execute.' }),
  workdir: Type.Optional(
    Type.String({ description: 'Working directory for the command. Defaults to the turn cwd.' })
  ),
  shell: Type.Optional(
    Type.String({ description: "Shell binary to launch. Defaults to the user's default shell." })
  ),
  tty: Type.Optional(
    Type.Boolean({
      description:
        'True allocates a PTY for the command and keeps stdin writable; false or omitted uses plain pipes with stdin closed.'
    })
  ),
  yield_time_ms: Type.Optional(
    Type.Number({
      description:
        'Wait before yielding output. Defaults to 10000 ms; long-running commands return a session ID.'
    })
  ),
  max_output_tokens: Type.Optional(
    Type.Number({ description: 'Output token budget. Defaults to 10000 tokens.' })
  )
})

const writeStdinSchema = Type.Object({
  session_id: Type.Union([
    Type.Number({ description: 'Identifier of the running exec session.' }),
    Type.String({ description: 'Identifier of the running exec session.' })
  ]),
  chars: Type.Optional(
    Type.String({
      description:
        'Bytes to write to stdin. Defaults to empty, which polls without writing. Non-empty input requires the exec session to have been started with tty=true, except Ctrl-C.'
    })
  ),
  yield_time_ms: Type.Optional(
    Type.Number({
      description:
        'Wait before yielding output. Non-empty writes default to 250 ms and cap at 30000 ms; empty polls wait 5000-300000 ms by default.'
    })
  ),
  max_output_tokens: Type.Optional(
    Type.Number({ description: 'Output token budget. Defaults to 10000 tokens.' })
  )
})

type ManagedExecDetails = {
  chunkId: string
  sessionId: string | null
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  terminalStatus: BackgroundTerminalStatus | null
  originalTokenCount: number
  hookToolName?: 'exec_command'
  hookToolUseId?: string
  hookInput?: { cmd: string }
  hookResponse?: string
  output: string
  wallTimeMs: number
}

const RM_TO_TRASH_COMMAND_PREFIX = `
rm() {
  node --input-type=module - "$@" <<'PICHU_RM_TO_TRASH'
import { spawn } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import { parse, resolve } from 'node:path'

const binary = process.env.PICHU_TRASH_BINARY
if (binary == null || binary === '') {
  console.error('rm is disabled because Owls could not find the trash helper.')
  process.exit(127)
}

const rawArgs = process.argv.slice(2)
let force = false
let endOfOptions = false
const paths = []
const unsupported = []

for (const arg of rawArgs) {
  if (endOfOptions === false && arg === '--') {
    endOfOptions = true
    continue
  }
  if (endOfOptions === false && arg.startsWith('--')) {
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--recursive' || arg === '--dir' || arg === '--verbose') {
      continue
    }
    unsupported.push(arg)
    continue
  }
  if (endOfOptions === false && arg.startsWith('-') && (arg === '-' ? false : true)) {
    const flags = arg.slice(1).split('')
    if (flags.every((flag) => ['f', 'r', 'R', 'd', 'v'].includes(flag))) {
      if (flags.includes('f')) force = true
      continue
    }
    unsupported.push(arg)
    continue
  }
  paths.push(arg)
}

if (unsupported.length > 0) {
  console.error('rm: unsupported option for Owls trash wrapper: ' + unsupported.join(', '))
  process.exit(2)
}

if (paths.length === 0) {
  if (force) process.exit(0)
  console.error('rm: missing operand')
  process.exit(1)
}

const existingPaths = []
for (const target of paths) {
  const absolutePath = resolve(target)
  if (absolutePath === parse(absolutePath).root) {
    console.error('rm: refusing to trash filesystem root: ' + target)
    process.exit(1)
  }
  try {
    await lstat(target)
    existingPaths.push(target)
  } catch (error) {
    if (error?.code === 'ENOENT' && force) continue
    console.error(error?.message ?? String(error))
    process.exit(1)
  }
}

if (existingPaths.length === 0) process.exit(0)

const child = spawn(binary, existingPaths, { stdio: 'inherit' })
child.on('error', (error) => {
  console.error(error?.message ?? String(error))
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) {
    console.error('rm: trash helper exited with signal ' + signal)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
PICHU_RM_TO_TRASH
}
`

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function standaloneNodePath(filePath: string): string {
  return filePath.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
}

function findTrashBinaryPath(): string | null {
  if (process.platform !== 'darwin') return null
  try {
    const trashEntryPath = require.resolve('trash')
    const trashBinaryPath = join(dirname(trashEntryPath), 'lib', 'macos-trash')
    const unpackedTrashBinaryPath = standaloneNodePath(trashBinaryPath)
    if (existsSync(unpackedTrashBinaryPath)) return unpackedTrashBinaryPath
    if (existsSync(trashBinaryPath)) return trashBinaryPath
  } catch {
    return null
  }
  return null
}

function prependPathsToPath(env: NodeJS.ProcessEnv, paths: string[]): NodeJS.ProcessEnv {
  if (paths.length === 0) return env
  return {
    ...env,
    PATH: [...paths, env.PATH].filter(Boolean).join(delimiter)
  }
}

function removeHostNodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nextEnv = { ...env }
  if (nextEnv.NODE_ENV === process.env.NODE_ENV) {
    delete nextEnv.NODE_ENV
  }
  return nextEnv
}

function uniquePathEntries(paths: Array<string | null>): string[] {
  const seen = new Set<string>()
  const entries: string[] = []
  for (const path of paths) {
    if (!path || seen.has(path)) continue
    seen.add(path)
    entries.push(path)
  }
  return entries
}

function withPichuBash(
  options?: ToolsOptions,
  pichuPathEntries: string[] = [],
  getCurrentSessionId?: () => string | null
): ToolsOptions {
  const existingSpawnHook = options?.bash?.spawnHook
  const existingCommandPrefix = options?.bash?.commandPrefix
  const pathEntries = uniquePathEntries([findBundledNodeBinPath(), ...pichuPathEntries])
  const pichuCommandPrefix = pathEntries.length
    ? `export PATH=${pathEntries.map(shellQuote).join(delimiter)}:$PATH`
    : undefined
  const trashBinaryPath = findTrashBinaryPath()
  const trashCommandPrefix = trashBinaryPath
    ? `export PICHU_TRASH_BINARY=${shellQuote(trashBinaryPath)}\n${RM_TO_TRASH_COMMAND_PREFIX}`
    : undefined
  const commandPrefix = [pichuCommandPrefix, trashCommandPrefix, existingCommandPrefix]
    .filter(Boolean)
    .join('\n')

  return {
    ...options,
    bash: {
      ...options?.bash,
      commandPrefix: commandPrefix || undefined,
      operations:
        options?.bash?.operations ??
        createPichuSandboxedBashOperations({
          shellPath: options?.bash?.shellPath,
          shouldSandbox: () => getAgentTrustProfile() !== 'full',
          allowNetworkByDefault: () => getAgentTrustProfile() === 'auto',
          getCurrentSessionId: () => getCurrentSessionId?.() ?? null
        }),
      spawnHook(context: BashSpawnContext): BashSpawnContext {
        const nextContext = existingSpawnHook ? existingSpawnHook(context) : context
        const currentSessionId = getCurrentSessionId?.()
        const env = withDefaultRuntimePackageManagerEnv(
          removeUnsupportedNpmConfigEnv(
            removeHostNodeEnv(prependPathsToPath(nextContext.env, pathEntries))
          ),
          findDefaultRuntimeCaBundlePath()
        )
        return {
          ...nextContext,
          env: {
            ...env,
            ...(currentSessionId ? { PICHU_SESSION_ID: currentSessionId } : {})
          }
        }
      }
    }
  }
}

function outputCharsForTokens(maxOutputTokens: number | undefined): number {
  const tokens =
    typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens)
      ? Math.max(1, Math.floor(maxOutputTokens))
      : DEFAULT_MAX_OUTPUT_TOKENS
  return tokens * 4
}

function clampYieldTime(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(250, Math.min(30_000, Math.floor(value)))
}

function clampEmptyWriteStdinYieldTime(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_EMPTY_WRITE_STDIN_YIELD_TIME_MS
  }
  return Math.max(
    DEFAULT_EMPTY_WRITE_STDIN_YIELD_TIME_MS,
    Math.min(MAX_EMPTY_WRITE_STDIN_YIELD_TIME_MS, Math.floor(value))
  )
}

function managedExecResponseText(result: ManagedExecDetails): string {
  const sections = [
    `Chunk ID: ${result.chunkId}`,
    `Wall time: ${(result.wallTimeMs / 1000).toFixed(4)} seconds`
  ]
  if (result.terminalStatus === 'terminated') {
    const signal = result.signalCode ? ` with signal ${result.signalCode}` : ''
    sections.push(`Process terminated${signal}`)
  } else if (result.exitCode !== null) {
    sections.push(`Process exited with code ${result.exitCode}`)
  } else if (result.signalCode) {
    sections.push(`Process ended with signal ${result.signalCode}`)
  }
  if (result.sessionId) sections.push(`Process running with session ID ${result.sessionId}`)
  sections.push(`Original token count: ${result.originalTokenCount}`)
  sections.push('Output:')
  sections.push(result.output)
  return sections.join('\n')
}

function prepareManagedCommandContext(
  command: string,
  workdir: string,
  bashOptions: NonNullable<ToolsOptions['bash']>
): BashSpawnContext {
  const commandWithPrefix = [bashOptions.commandPrefix, command].filter(Boolean).join('\n')
  const context: BashSpawnContext = {
    command: commandWithPrefix,
    cwd: workdir,
    env: process.env
  }
  return bashOptions.spawnHook ? bashOptions.spawnHook(context) : context
}

async function seedPichuSiteDevAuth(cwd: string): Promise<void> {
  void cwd
}

export function resolveCommandWorkdir(baseCwd: string, workdir: string | undefined): string {
  const normalizedBaseCwd = resolve(baseCwd)
  if (!workdir?.trim()) return normalizedBaseCwd
  const resolvedWorkdir = resolve(normalizedBaseCwd, workdir)
  if (getAgentTrustProfile() === 'full') return resolvedWorkdir

  const realBaseCwd = realpathSync(normalizedBaseCwd)
  const realWorkdir = realpathSync(resolvedWorkdir)
  const relativePath = relative(realBaseCwd, realWorkdir)
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return resolvedWorkdir
  }
  throw new Error(`Working directory must stay inside ${normalizedBaseCwd}.`)
}

async function executeManagedCommand(params: {
  toolCallId: string
  command: string
  cwd: string
  bashOptions: NonNullable<ToolsOptions['bash']>
  shellPath?: string
  tty?: boolean
  timeoutSeconds?: number
  yieldTimeMs?: number
  maxOutputTokens?: number
  signal?: AbortSignal
  getCurrentSessionId?: () => string | null
}): Promise<ManagedExecDetails> {
  const startedAt = Date.now()
  const chunkId = randomUUID()
  const context = prepareManagedCommandContext(params.command, params.cwd, params.bashOptions)
  await seedPichuSiteDevAuth(context.cwd)
  const result = await runPichuManagedExecCommand({
    command: context.command,
    cwd: context.cwd,
    env: context.env,
    shellPath: params.shellPath ?? params.bashOptions.shellPath,
    sessionId: params.getCurrentSessionId?.() ?? null,
    toolCallId: params.toolCallId,
    hookCommand: params.command,
    signal: params.signal,
    timeoutSeconds: params.timeoutSeconds,
    yieldTimeMs: clampYieldTime(params.yieldTimeMs, DEFAULT_EXEC_YIELD_TIME_MS),
    maxOutputChars: outputCharsForTokens(params.maxOutputTokens),
    tty: params.tty,
    shouldSandbox: () => getAgentTrustProfile() !== 'full',
    allowNetworkByDefault: () => getAgentTrustProfile() === 'auto'
  })
  return {
    chunkId,
    sessionId: result.sessionId,
    exitCode: result.exitCode,
    signalCode: result.signalCode,
    terminalStatus: result.terminalStatus,
    originalTokenCount: approximateTokenCountFromLength(
      result.originalOutputLength ?? result.output.length
    ),
    hookToolName: 'exec_command',
    hookToolUseId: params.toolCallId,
    hookInput: { cmd: params.command },
    ...(result.sessionId === null ? { hookResponse: result.output } : {}),
    output: result.output,
    wallTimeMs: Date.now() - startedAt
  }
}

function approximateTokenCountFromLength(length: number): number {
  return Math.ceil(length / 4)
}

function createExecCommandTool(
  cwd: string,
  bashOptions: NonNullable<ToolsOptions['bash']>,
  getCurrentSessionId?: () => string | null
): AgentTool<typeof execCommandSchema, ManagedExecDetails> {
  return {
    name: 'exec_command',
    label: 'Exec Command',
    description:
      'Runs a command, returning output or a session ID for ongoing interaction. Use this for local dev servers and other long-running commands.',
    parameters: execCommandSchema,
    async execute(toolCallId, params, signal) {
      return runPichuBashSandboxContext(toolCallId, async () => {
        const result = await executeManagedCommand({
          toolCallId,
          command: params.cmd,
          cwd: resolveCommandWorkdir(cwd, params.workdir),
          bashOptions,
          shellPath: params.shell,
          tty: params.tty,
          yieldTimeMs: params.yield_time_ms,
          maxOutputTokens: params.max_output_tokens,
          signal,
          getCurrentSessionId
        })
        return {
          content: [{ type: 'text' as const, text: managedExecResponseText(result) }],
          details: result
        }
      })
    }
  }
}

function createWriteStdinTool(
  getCurrentSessionId?: () => string | null
): AgentTool<typeof writeStdinSchema, ManagedExecDetails> {
  return {
    name: 'write_stdin',
    label: 'Write Stdin',
    description: 'Writes characters to an existing exec session and returns recent output.',
    parameters: writeStdinSchema,
    async execute(_toolCallId, params) {
      const sessionId = String(params.session_id)
      const chars = params.chars ?? ''
      const initialSnapshot = readBackgroundTerminalOutput(sessionId)
      if (!initialSnapshot) throw new Error(`Unknown exec session ${sessionId}.`)
      const currentSessionId = getCurrentSessionId?.() ?? null
      if (currentSessionId && initialSnapshot.sessionId !== currentSessionId) {
        throw new Error(`Unknown exec session ${sessionId}.`)
      }
      if (chars) {
        const stdinWriteResult = writeBackgroundTerminalStdin(sessionId, chars)
        if (stdinWriteResult === 'unknown') throw new Error(`Unknown exec session ${sessionId}.`)
        if (stdinWriteResult === 'closed') throw new Error(STDIN_CLOSED_ERROR)
      }
      const startedAt = Date.now()
      const snapshot = await pollBackgroundTerminalOutput(sessionId, {
        yieldTimeMs: chars
          ? clampYieldTime(params.yield_time_ms, DEFAULT_WRITE_STDIN_YIELD_TIME_MS)
          : clampEmptyWriteStdinYieldTime(params.yield_time_ms),
        maxChars: outputCharsForTokens(params.max_output_tokens),
        advance: true
      })
      if (!snapshot) throw new Error(`Unknown exec session ${sessionId}.`)
      const result = {
        chunkId: randomUUID(),
        sessionId: snapshot.running ? sessionId : null,
        exitCode: snapshot.exitCode,
        signalCode: snapshot.signalCode,
        terminalStatus: snapshot.status,
        originalTokenCount: approximateTokenCountFromLength(
          snapshot.originalOutputLength ?? snapshot.output.length
        ),
        hookToolName: 'exec_command' as const,
        hookToolUseId: snapshot.toolCallId ?? sessionId,
        hookInput: { cmd: snapshot.hookCommand ?? snapshot.command },
        ...(!snapshot.running ? { hookResponse: snapshot.output } : {}),
        output: snapshot.output,
        wallTimeMs: Date.now() - startedAt
      }
      if (!snapshot.running) {
        releaseRetainedBackgroundTerminal(sessionId)
      }
      return {
        content: [{ type: 'text' as const, text: managedExecResponseText(result) }],
        details: result
      }
    }
  }
}

function withoutLegacyBashTool<T extends AgentTool>(tool: T): boolean {
  return tool.name !== 'bash'
}

export function createPichuCodingTools(
  cwd: string,
  options?: ToolsOptions,
  pichuPathEntries: string[] = [],
  getCurrentSessionId?: () => string | null
) {
  const pichuOptions = withPichuBash(options, pichuPathEntries, getCurrentSessionId)
  const bashOptions = pichuOptions.bash ?? {}
  return [
    createExecCommandTool(cwd, bashOptions, getCurrentSessionId),
    createWriteStdinTool(getCurrentSessionId),
    ...createCodingTools(cwd, pichuOptions).filter(withoutLegacyBashTool)
  ]
}

export function createPichuReadOnlyTools(
  cwd: string,
  options?: ToolsOptions,
  pichuPathEntries: string[] = [],
  getCurrentSessionId?: () => string | null
) {
  const pichuOptions = withPichuBash(options, pichuPathEntries, getCurrentSessionId)
  const bashOptions = pichuOptions.bash ?? {}
  return [
    createExecCommandTool(cwd, bashOptions, getCurrentSessionId),
    createWriteStdinTool(getCurrentSessionId),
    ...createReadOnlyTools(cwd, pichuOptions).filter(withoutLegacyBashTool)
  ]
}
