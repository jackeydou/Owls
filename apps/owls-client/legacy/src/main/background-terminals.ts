import { type ChildProcess, execFileSync } from 'node:child_process'

const TERMINATE_GRACE_MS = 2500
const TERMINATE_CONFIRM_POLL_MS = 100
const MAX_BACKGROUND_TERMINALS = 64
const PROTECTED_RECENT_TERMINALS = 8
const MAX_TERMINAL_OUTPUT_CHARS = 1024 * 1024
const DEFAULT_POLL_INTERVAL_MS = 100
const RETAINED_OUTPUT_TTL_MS = 5 * 60 * 1000
const PROCESS_GROUP_EXIT_SETTLE_MS = 100
const POST_EXIT_OUTPUT_DRAIN_MS = 50

export type BackgroundTerminalStatus = 'running' | 'terminating' | 'exited' | 'terminated'
export type BackgroundTerminalStdinWriteResult = 'ok' | 'unknown' | 'closed'

export type BackgroundTerminalInfo = {
  id: string
  command: string
  cwd: string
  sessionId: string | null
  pid: number | null
  startedAt: string
  status: BackgroundTerminalStatus
}

type TerminateBackgroundTerminalOptions = {
  force?: boolean
  sessionId?: string | null
}

type ListBackgroundTerminalsOptions = {
  sessionId?: string | null
}

type TerminateAllBackgroundTerminalsOptions = {
  force?: boolean
  sessionId?: string | null
}

type BackgroundTerminalEntry = BackgroundTerminalInfo & {
  toolCallId: string | null
  hookCommand: string | null
  child: ChildProcess | null
  ptyProcess: BackgroundTerminalPtyProcess | null
  ptyDisposables: Array<{ dispose(): void }>
  childClosed: boolean
  childClosedAtMs: number | null
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  processGroupId: number | null
  terminateTimer: NodeJS.Timeout | null
  startedAtMs: number
  exitedAtMs: number | null
  exitOutputDrainDone: boolean
  retainOnExit: boolean
  preserveProcessGroupOnChildExit: boolean
  output: string
  outputStartOffset: number
  readOffset: number
  waiters: Set<() => void>
}

type BackgroundTerminalPtyProcess = {
  readonly pid: number
  readonly onData: (listener: (data: string) => void) => { dispose(): void }
  readonly onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
    dispose(): void
  }
  write(data: string | Buffer): void
  kill(signal?: string): void
}

let nextBackgroundTerminalId = 1000
const backgroundTerminals = new Map<string, BackgroundTerminalEntry>()
let exitCleanupInstalled = false

function allocateBackgroundTerminalId(): string {
  while (backgroundTerminals.has(String(nextBackgroundTerminalId))) {
    nextBackgroundTerminalId += 1
  }
  const id = String(nextBackgroundTerminalId)
  nextBackgroundTerminalId += 1
  return id
}

function terminateProcessGroup(processGroupId: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-processGroupId, signal)
    return true
  } catch {
    return false
  }
}

function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch {
    return false
  }
}

function processGroupIdForPid(pid: number): number | null {
  if (process.platform === 'win32') return null
  try {
    const output = execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (!/^\d+$/.test(output)) return null
    const processGroupId = Number(output)
    return Number.isSafeInteger(processGroupId) && processGroupId > 0 ? processGroupId : null
  } catch {
    return null
  }
}

function processGroupIdForChildPid(pid: number | undefined): number | null {
  if (!pid) return null
  const processGroupId = processGroupIdForPid(pid)
  return processGroupId === pid ? processGroupId : null
}

function normalizeProcessGroupId(value: number | null | undefined): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function terminateEntry(entry: BackgroundTerminalEntry, signal: NodeJS.Signals): void {
  if (entry.processGroupId && terminateProcessGroup(entry.processGroupId, signal)) return
  if (entry.ptyProcess) {
    try {
      entry.ptyProcess.kill(signal)
    } catch {
      // The PTY may already have exited.
    }
    return
  }
  const child = entry.child
  if (!child) return
  try {
    child.kill(signal)
  } catch {
    // The process may already have exited.
  }
}

function notifyOutputWaiters(entry: BackgroundTerminalEntry): void {
  const waiters = [...entry.waiters]
  entry.waiters.clear()
  for (const waiter of waiters) waiter()
}

function appendEntryOutput(entry: BackgroundTerminalEntry, data: Buffer | string): void {
  const text = typeof data === 'string' ? data : data.toString('utf8')
  if (!text) return
  entry.output += text
  if (entry.output.length > MAX_TERMINAL_OUTPUT_CHARS) {
    const trimCount = entry.output.length - MAX_TERMINAL_OUTPUT_CHARS
    entry.output = entry.output.slice(trimCount)
    entry.outputStartOffset += trimCount
  }
  notifyOutputWaiters(entry)
}

function forceTerminateEntry(entry: BackgroundTerminalEntry): void {
  terminateEntry(entry, 'SIGKILL')
}

function clearTerminateTimer(entry: BackgroundTerminalEntry): void {
  if (!entry.terminateTimer) return
  clearTimeout(entry.terminateTimer)
  entry.terminateTimer = null
}

function removeBackgroundTerminal(id: string, status: BackgroundTerminalStatus): void {
  const entry = backgroundTerminals.get(id)
  if (!entry) return
  clearTerminateTimer(entry)
  for (const disposable of entry.ptyDisposables) disposable.dispose()
  entry.ptyDisposables = []
  entry.status = status
  notifyOutputWaiters(entry)
  backgroundTerminals.delete(id)
}

function isChildProcessKnownClosed(entry: BackgroundTerminalEntry): boolean {
  if (entry.childClosed) return true
  const child = entry.child
  return child?.exitCode != null || child?.signalCode != null
}

function removeIfProcessGroupExited(entry: BackgroundTerminalEntry): boolean {
  if (
    entry.processGroupId &&
    (!isChildProcessKnownClosed(entry) || entry.preserveProcessGroupOnChildExit)
  ) {
    if (
      isChildProcessKnownClosed(entry) &&
      entry.childClosedAtMs !== null &&
      Date.now() - entry.childClosedAtMs < PROCESS_GROUP_EXIT_SETTLE_MS
    ) {
      return false
    }
    if (processGroupExists(entry.processGroupId)) {
      return false
    }
  } else if (!isChildProcessKnownClosed(entry)) {
    return false
  }
  const status =
    entry.status === 'terminated' || entry.status === 'terminating' ? 'terminated' : 'exited'
  if (entry.retainOnExit) {
    clearTerminateTimer(entry)
    entry.status = status
    entry.exitedAtMs = Date.now()
    notifyOutputWaiters(entry)
    return true
  }
  removeBackgroundTerminal(entry.id, status)
  return true
}

function isVisibleTerminalStatus(status: BackgroundTerminalStatus): boolean {
  return status === 'running' || status === 'terminating'
}

function sessionMatches(
  entry: BackgroundTerminalEntry,
  sessionId: string | null | undefined
): boolean {
  return sessionId === undefined || entry.sessionId === sessionId
}

function compareEntryAge(left: BackgroundTerminalEntry, right: BackgroundTerminalEntry): number {
  return left.startedAtMs - right.startedAtMs || Number(left.id) - Number(right.id)
}

function visibleBackgroundTerminalEntries(
  options: ListBackgroundTerminalsOptions = {}
): BackgroundTerminalEntry[] {
  pruneExitedBackgroundTerminals()
  return [...backgroundTerminals.values()]
    .filter(
      (entry) => isVisibleTerminalStatus(entry.status) && sessionMatches(entry, options.sessionId)
    )
    .sort((a, b) => Number(a.id) - Number(b.id))
}

function scheduleTerminationConfirmation(entry: BackgroundTerminalEntry, delayMs: number): void {
  clearTerminateTimer(entry)
  entry.terminateTimer = setTimeout(() => {
    entry.terminateTimer = null
    if (!backgroundTerminals.has(entry.id)) return
    if (removeIfProcessGroupExited(entry)) return
    scheduleTerminationConfirmation(entry, TERMINATE_CONFIRM_POLL_MS)
  }, delayMs)
  entry.terminateTimer.unref()
}

function scheduleForceTermination(entry: BackgroundTerminalEntry): void {
  clearTerminateTimer(entry)
  entry.terminateTimer = setTimeout(() => {
    entry.terminateTimer = null
    if (!backgroundTerminals.has(entry.id)) return
    forceTerminateEntry(entry)
    scheduleTerminationConfirmation(entry, TERMINATE_CONFIRM_POLL_MS)
  }, TERMINATE_GRACE_MS)
  entry.terminateTimer.unref()
}

function pruneExitedBackgroundTerminals(): void {
  for (const entry of [...backgroundTerminals.values()]) {
    if (isVisibleTerminalStatus(entry.status)) {
      if (entry.childClosed) removeIfProcessGroupExited(entry)
      continue
    }
    if (
      entry.retainOnExit &&
      entry.exitedAtMs !== null &&
      Date.now() - entry.exitedAtMs > RETAINED_OUTPUT_TTL_MS
    ) {
      removeBackgroundTerminal(entry.id, entry.status)
    }
  }
}

function pruneBackgroundTerminalsIfNeeded(): void {
  const visibleEntries = visibleBackgroundTerminalEntries()
  if (visibleEntries.length <= MAX_BACKGROUND_TERMINALS) return
  const overflowCount = visibleEntries.length - MAX_BACKGROUND_TERMINALS

  const protectedIds = new Set(
    [...visibleEntries]
      .sort((a, b) => compareEntryAge(b, a))
      .slice(0, PROTECTED_RECENT_TERMINALS)
      .map((entry) => entry.id)
  )
  const prunableEntries = visibleEntries
    .filter((entry) => !protectedIds.has(entry.id))
    .sort(compareEntryAge)

  for (const entry of prunableEntries.slice(0, overflowCount)) {
    if (entry.status === 'running') {
      terminateBackgroundTerminal(entry.id, { force: true })
    }
  }
}

export function registerBackgroundTerminal(params: {
  child?: ChildProcess
  ptyProcess?: BackgroundTerminalPtyProcess
  command: string
  cwd: string
  sessionId?: string | null
  toolCallId?: string | null
  hookCommand?: string | null
  processGroupId?: number | null
  retainOnExit?: boolean
  captureOutput?: boolean
  preserveProcessGroupOnChildExit?: boolean
}): string {
  if (!params.child && !params.ptyProcess) {
    throw new Error('registerBackgroundTerminal requires a child process or PTY process.')
  }
  const id = allocateBackgroundTerminalId()
  const startedAtMs = Date.now()
  const pid = params.child?.pid ?? params.ptyProcess?.pid ?? null
  const normalizedProcessGroupId = normalizeProcessGroupId(params.processGroupId)
  const processGroupId =
    normalizedProcessGroupId === undefined
      ? processGroupIdForChildPid(pid ?? undefined)
      : normalizedProcessGroupId
  const entry: BackgroundTerminalEntry = {
    id,
    child: params.child ?? null,
    ptyProcess: params.ptyProcess ?? null,
    ptyDisposables: [],
    command: params.command,
    cwd: params.cwd,
    sessionId: params.sessionId ?? null,
    toolCallId: params.toolCallId ?? null,
    hookCommand: params.hookCommand ?? null,
    pid,
    startedAt: new Date(startedAtMs).toISOString(),
    status: 'running',
    childClosed: false,
    childClosedAtMs: null,
    exitCode: null,
    signalCode: null,
    processGroupId,
    terminateTimer: null,
    startedAtMs,
    exitedAtMs: null,
    exitOutputDrainDone: false,
    retainOnExit: params.retainOnExit === true,
    preserveProcessGroupOnChildExit: params.preserveProcessGroupOnChildExit !== false,
    output: '',
    outputStartOffset: 0,
    readOffset: 0,
    waiters: new Set()
  }
  backgroundTerminals.set(id, entry)

  if (params.ptyProcess) {
    if (params.captureOutput) {
      entry.ptyDisposables.push(
        params.ptyProcess.onData((data: string) => appendEntryOutput(entry, data))
      )
    }
    entry.ptyDisposables.push(
      params.ptyProcess.onExit((event) => {
        entry.exitCode = event.exitCode
        entry.signalCode = null
        entry.childClosed = true
        entry.childClosedAtMs = Date.now()
        removeIfProcessGroupExited(entry)
      })
    )
  } else if (params.child) {
    if (params.captureOutput) {
      params.child.stdout?.on('data', (data: Buffer) => appendEntryOutput(entry, data))
      params.child.stderr?.on('data', (data: Buffer) => appendEntryOutput(entry, data))
    }

    params.child.once('close', (code, signal) => {
      entry.exitCode = code
      entry.signalCode = signal
      entry.childClosed = true
      entry.childClosedAtMs = Date.now()
      removeIfProcessGroupExited(entry)
    })
    params.child.once('error', (error) => {
      appendEntryOutput(entry, `${error.message}\n`)
      entry.childClosed = true
      entry.childClosedAtMs = Date.now()
      removeIfProcessGroupExited(entry)
    })
  }

  pruneBackgroundTerminalsIfNeeded()
  return id
}

export type BackgroundTerminalOutputSnapshot = {
  id: string
  command: string
  sessionId: string | null
  toolCallId: string | null
  hookCommand: string | null
  output: string
  originalOutputLength: number
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  status: BackgroundTerminalStatus
  running: boolean
}

function truncateOutputForModel(output: string, maxChars: number | undefined): string {
  if (!maxChars || maxChars <= 0 || output.length <= maxChars) return output
  return output.slice(output.length - maxChars)
}

function outputSnapshotForEntry(
  entry: BackgroundTerminalEntry,
  options: { advance?: boolean; maxChars?: number } = {}
): BackgroundTerminalOutputSnapshot {
  const outputEndOffset = entry.outputStartOffset + entry.output.length
  const unreadStartOffset = Math.max(entry.readOffset, entry.outputStartOffset)
  const output = entry.output.slice(unreadStartOffset - entry.outputStartOffset)
  const originalOutputLength = Math.max(0, outputEndOffset - entry.readOffset)
  if (options.advance) entry.readOffset = outputEndOffset
  return {
    id: entry.id,
    command: entry.command,
    sessionId: entry.sessionId,
    toolCallId: entry.toolCallId,
    hookCommand: entry.hookCommand,
    output: truncateOutputForModel(output, options.maxChars),
    originalOutputLength,
    exitCode: entry.exitCode,
    signalCode: entry.signalCode,
    status: entry.status,
    running: isVisibleTerminalStatus(entry.status)
  }
}

async function settleExitedEntryOutput(entry: BackgroundTerminalEntry): Promise<void> {
  if (entry.exitOutputDrainDone || isVisibleTerminalStatus(entry.status)) return
  entry.exitOutputDrainDone = true
  await new Promise<void>((resolve) => {
    setTimeout(resolve, POST_EXIT_OUTPUT_DRAIN_MS)
  })
}

export function readBackgroundTerminalOutput(
  id: string,
  options: { advance?: boolean; maxChars?: number } = {}
): BackgroundTerminalOutputSnapshot | null {
  pruneExitedBackgroundTerminals()
  const entry = backgroundTerminals.get(id)
  if (!entry) return null
  return outputSnapshotForEntry(entry, options)
}

function waitForEntryOutput(entry: BackgroundTerminalEntry, timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout)
      entry.waiters.delete(waiter)
      resolve()
    }
    const timeout = setTimeout(finish, timeoutMs)
    const waiter = () => {
      finish()
    }
    entry.waiters.add(waiter)
  })
}

export async function pollBackgroundTerminalOutput(
  id: string,
  options: { yieldTimeMs: number; maxChars?: number; advance?: boolean }
): Promise<BackgroundTerminalOutputSnapshot | null> {
  const deadline = Date.now() + Math.max(0, options.yieldTimeMs)
  while (true) {
    pruneExitedBackgroundTerminals()
    const entry = backgroundTerminals.get(id)
    if (!entry) return null
    if (!isVisibleTerminalStatus(entry.status)) {
      await settleExitedEntryOutput(entry)
      return outputSnapshotForEntry(entry, {
        advance: options.advance,
        maxChars: options.maxChars
      })
    }
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      return outputSnapshotForEntry(entry, {
        advance: options.advance,
        maxChars: options.maxChars
      })
    }
    await waitForEntryOutput(entry, Math.min(DEFAULT_POLL_INTERVAL_MS, remainingMs))
  }
}

export function writeBackgroundTerminalStdin(
  id: string,
  chars: string
): BackgroundTerminalStdinWriteResult {
  pruneExitedBackgroundTerminals()
  const entry = backgroundTerminals.get(id)
  if (!entry || !isVisibleTerminalStatus(entry.status)) return 'unknown'
  if (chars === '\u0003') {
    terminateEntry(entry, 'SIGINT')
    return 'ok'
  }
  if (entry.ptyProcess) {
    try {
      entry.ptyProcess.write(chars)
      return 'ok'
    } catch {
      return 'closed'
    }
  }
  return 'closed'
}

export function markBackgroundTerminalOutputRead(id: string): void {
  const entry = backgroundTerminals.get(id)
  if (!entry) return
  entry.readOffset = entry.outputStartOffset + entry.output.length
}

export function releaseRetainedBackgroundTerminal(id: string): void {
  pruneExitedBackgroundTerminals()
  const entry = backgroundTerminals.get(id)
  if (!entry || isVisibleTerminalStatus(entry.status)) return
  removeBackgroundTerminal(id, entry.status)
}

export function listBackgroundTerminals(
  options: ListBackgroundTerminalsOptions = {}
): BackgroundTerminalInfo[] {
  return visibleBackgroundTerminalEntries(options).map((entry) => ({
    id: entry.id,
    command: entry.command,
    cwd: entry.cwd,
    sessionId: entry.sessionId,
    pid: entry.pid,
    startedAt: entry.startedAt,
    status: entry.status
  }))
}

export function isKnownBackgroundTerminalPid(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  pruneExitedBackgroundTerminals()
  const processGroupId = processGroupIdForPid(pid)
  return [...backgroundTerminals.values()].some((entry) =>
    entryMatchesPidOrProcessGroup(entry, pid, processGroupId)
  )
}

export function isKnownBackgroundTerminalPidForSession(
  pid: number,
  sessionId: string | null | undefined
): boolean {
  if (!sessionId || !Number.isSafeInteger(pid) || pid <= 0) return false
  pruneExitedBackgroundTerminals()
  const processGroupId = processGroupIdForPid(pid)
  return [...backgroundTerminals.values()].some((entry) => {
    if (entry.sessionId !== sessionId) return false
    return entryMatchesPidOrProcessGroup(entry, pid, processGroupId)
  })
}

function entryMatchesPidOrProcessGroup(
  entry: BackgroundTerminalEntry,
  pid: number,
  processGroupId: number | null
): boolean {
  if (!isVisibleTerminalStatus(entry.status) || !entry.pid) return false
  return (
    entry.pid === pid || (entry.processGroupId !== null && processGroupId === entry.processGroupId)
  )
}

export function terminateBackgroundTerminal(
  id: string,
  options: TerminateBackgroundTerminalOptions = {}
): boolean {
  const entry = backgroundTerminals.get(id)
  if (!entry || !isVisibleTerminalStatus(entry.status)) return false
  if (!sessionMatches(entry, options.sessionId)) return false

  if (options.force) {
    entry.status = 'terminating'
    forceTerminateEntry(entry)
    scheduleTerminationConfirmation(entry, TERMINATE_CONFIRM_POLL_MS)
    return true
  }

  if (entry.status !== 'running') return false
  entry.status = 'terminating'
  terminateEntry(entry, 'SIGTERM')
  scheduleForceTermination(entry)
  return true
}

export function terminateAllBackgroundTerminals(
  options: TerminateAllBackgroundTerminalsOptions = {}
): number {
  let terminated = 0
  for (const entry of [...backgroundTerminals.values()]) {
    if (!sessionMatches(entry, options.sessionId)) continue
    if (
      terminateBackgroundTerminal(entry.id, { force: options.force, sessionId: options.sessionId })
    ) {
      terminated += 1
    }
  }
  return terminated
}

export function forceTerminateAllBackgroundTerminals(
  options: { sessionId?: string | null } = {}
): number {
  return terminateAllBackgroundTerminals({ ...options, force: true })
}

export function terminateBackgroundTerminalsOnProcessExit(): number {
  let terminated = 0
  for (const entry of [...backgroundTerminals.values()]) {
    if (!isVisibleTerminalStatus(entry.status)) continue
    clearTerminateTimer(entry)
    terminateEntry(entry, 'SIGKILL')
    terminated += 1
  }
  return terminated
}

export function installBackgroundTerminalExitCleanup(): void {
  if (exitCleanupInstalled) return
  exitCleanupInstalled = true
  process.once('exit', () => {
    terminateBackgroundTerminalsOnProcessExit()
  })
}
