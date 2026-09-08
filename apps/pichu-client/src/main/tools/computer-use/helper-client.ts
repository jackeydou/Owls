import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { app } from 'electron'
import type {
  ComputerUseHelperRequest,
  ComputerUseHelperResponse,
  ComputerUseHelperResult
} from './helper-protocol.js'

type HelperCommand = {
  command: string
  args: string[]
}

type PendingRequest = {
  resolve: (result: ComputerUseHelperResult) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

type ComputerUseHelperRequestWithoutId = ComputerUseHelperRequest extends infer Request
  ? Request extends { id: string }
    ? Omit<Request, 'id'>
    : never
  : never
type ComputerUseHelperError = Extract<ComputerUseHelperResponse, { ok: false }>['error']

const HELPER_TIMEOUT_MS = 10_000
const HELPER_APP_EXECUTABLE = join(
  'Owls Computer Use.app',
  'Contents',
  'MacOS',
  'Owls Computer Use'
)
const HELPER_ENTRY_RELATIVE_PATH = join('out', 'main', 'tools', 'computer-use', 'helper-entry.js')
const BUNDLED_NODE_RELATIVE_PATH = join(
  'resources',
  'node',
  process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64',
  'bin',
  'node'
)

let helperProcess: ChildProcessWithoutNullStreams | null = null
let helperLines: Interface | null = null
let helperRequestSequence = 0
const pendingRequests = new Map<string, PendingRequest>()

function isHelperError(error: unknown): error is ComputerUseHelperError {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { message?: unknown; name?: unknown; stack?: unknown }
  return (
    typeof candidate.message === 'string' &&
    (candidate.name === undefined || typeof candidate.name === 'string') &&
    (candidate.stack === undefined || typeof candidate.stack === 'string')
  )
}

function helperUnavailableError(): Error {
  return new Error(
    'Computer Use requires the Owls Computer Use helper for macOS screen and input permissions. This build does not include the helper yet.'
  )
}

function isPathInside(parent: string, child: string): boolean {
  const parentPath = realpathSync(parent)
  const childPath = realpathSync(child)
  return childPath === parentPath || childPath.startsWith(`${parentPath}${sep}`)
}

function existingTrustedPath(root: string, ...segments: string[]): string | null {
  const candidate = join(root, ...segments)
  if (!existsSync(candidate) || !existsSync(root)) return null
  try {
    return isPathInside(root, candidate) ? candidate : null
  } catch {
    return null
  }
}

function devOnlyRoots(): string[] {
  if (app.isPackaged) return []
  return [app.getAppPath(), resolve(app.getAppPath(), '..'), process.cwd()]
}

function helperExecutableCandidates(): string[] {
  return [
    existingTrustedPath(process.resourcesPath, 'helpers', HELPER_APP_EXECUTABLE),
    ...devOnlyRoots().flatMap((root) => [
      existingTrustedPath(root, 'build', 'generated', 'helpers', HELPER_APP_EXECUTABLE),
      existingTrustedPath(
        root,
        'apps',
        'pichu-client',
        'build',
        'generated',
        'helpers',
        HELPER_APP_EXECUTABLE
      )
    ])
  ].filter((candidate): candidate is string => Boolean(candidate))
}

function helperEntryCandidates(): Array<{ entry: string; node: string }> {
  return devOnlyRoots()
    .flatMap((root) => [
      {
        entry: existingTrustedPath(root, HELPER_ENTRY_RELATIVE_PATH),
        node: existingTrustedPath(root, BUNDLED_NODE_RELATIVE_PATH)
      },
      {
        entry: existingTrustedPath(root, 'apps', 'pichu-client', HELPER_ENTRY_RELATIVE_PATH),
        node: existingTrustedPath(root, 'apps', 'pichu-client', BUNDLED_NODE_RELATIVE_PATH)
      }
    ])
    .filter((candidate): candidate is { entry: string; node: string } =>
      Boolean(candidate.entry && candidate.node)
    )
}

function resolveHelperCommand(): HelperCommand | null {
  if (process.platform !== 'darwin') return null

  for (const executable of helperExecutableCandidates()) {
    if (existsSync(executable)) {
      return { command: executable, args: [] }
    }
  }

  for (const candidate of helperEntryCandidates()) {
    if (existsSync(candidate.entry) && existsSync(candidate.node)) {
      return { command: candidate.node, args: [candidate.entry] }
    }
  }

  return null
}

export function isComputerUseHelperAvailable(): boolean {
  return resolveHelperCommand() !== null
}

function rejectPending(error: Error): void {
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timeout)
    pending.reject(error)
    pendingRequests.delete(id)
  }
}

function resetHelper(error?: Error): void {
  helperLines?.close()
  helperLines = null
  if (helperProcess !== null) {
    helperProcess.removeAllListeners()
    helperProcess.stdout.removeAllListeners()
    helperProcess.stderr.removeAllListeners()
    helperProcess.stdin.removeAllListeners()
    if (!helperProcess.killed) {
      helperProcess.kill()
    }
  }
  helperProcess = null
  rejectPending(error ?? new Error('Computer Use helper stopped.'))
}

function parseResponse(line: string): ComputerUseHelperResponse {
  const parsed = JSON.parse(line) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Computer Use helper returned a non-object response.')
  }
  const response = parsed as Partial<ComputerUseHelperResponse>
  if (typeof response.id !== 'string') {
    throw new Error('Computer Use helper response is missing id.')
  }
  if (response.ok !== true && response.ok !== false) {
    throw new Error('Computer Use helper response is missing ok.')
  }
  if (response.ok === false && !isHelperError(response.error)) {
    throw new Error('Computer Use helper returned an invalid error response.')
  }
  return response as ComputerUseHelperResponse
}

function ensureHelperProcess(): ChildProcessWithoutNullStreams {
  if (helperProcess !== null) return helperProcess

  const helper = resolveHelperCommand()
  if (!helper) {
    throw helperUnavailableError()
  }

  const child = spawn(helper.command, helper.args, {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  helperProcess = child
  helperLines = createInterface({
    input: child.stdout,
    crlfDelay: Number.POSITIVE_INFINITY
  })

  helperLines.on('line', (line) => {
    let response: ComputerUseHelperResponse
    try {
      response = parseResponse(line)
    } catch (error) {
      resetHelper(error instanceof Error ? error : new Error(String(error)))
      return
    }

    const pending = pendingRequests.get(response.id)
    if (!pending) return
    pendingRequests.delete(response.id)
    clearTimeout(pending.timeout)
    if (response.ok) {
      pending.resolve(response.result)
    } else {
      const error = new Error(response.error.message)
      error.name = response.error.name ?? 'ComputerUseHelperError'
      if (response.error.stack) {
        error.stack = response.error.stack
      }
      pending.reject(error)
    }
  })

  child.on('error', (error) => resetHelper(error))
  child.on('exit', (code, signal) => {
    resetHelper(
      new Error(`Computer Use helper exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`)
    )
  })

  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim()
    if (text) {
      console.warn('[computer-use-helper]', text)
    }
  })

  return child
}

export function sendComputerUseHelperRequest(
  request: ComputerUseHelperRequestWithoutId
): Promise<ComputerUseHelperResult> {
  const child = ensureHelperProcess()
  if (!child.stdin.writable || child.exitCode !== null || child.signalCode !== null) {
    resetHelper(new Error('Computer Use helper is not writable.'))
    throw new Error('Computer Use helper is not available.')
  }
  const id = String(++helperRequestSequence)
  const payload: ComputerUseHelperRequest = { id, ...request } as ComputerUseHelperRequest

  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id)
      const error = new Error(`Computer Use helper request "${request.method}" timed out.`)
      resetHelper(error)
      rejectRequest(error)
    }, HELPER_TIMEOUT_MS)

    pendingRequests.set(id, {
      resolve: resolveRequest,
      reject: rejectRequest,
      timeout
    })

    child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (!error) return
      const pending = pendingRequests.get(id)
      if (!pending) return
      pendingRequests.delete(id)
      clearTimeout(pending.timeout)
      pending.reject(error)
    })
  })
}

export function disposeComputerUseHelper(): void {
  resetHelper()
}
