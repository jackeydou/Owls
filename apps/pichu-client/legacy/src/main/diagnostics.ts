import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { app, dialog, ipcMain } from 'electron'
import { ZipFile } from 'yazl'
import type {
  ChatDiagnosticDetails,
  ChatDiagnosticEventInput,
  ChatDiagnosticEventName,
  DiagnosticPrimitive,
  DiagnosticsExportOptions,
  DiagnosticsExportResult
} from '../shared/diagnostics.js'
import { appendJsonlLog } from './diagnostics/log-writer.js'
import { getDataRoot } from './pichu-paths.js'

const CHAT_EVENTS_LOG = 'chat-events.jsonl'
const AUTH_EVENTS_LOG = 'auth-events.jsonl'
const AUTO_UPDATE_EVENTS_LOG = 'auto-update-events.jsonl'
const PLUGIN_EVENTS_LOG = 'plugin-events.jsonl'
const RUNTIME_EVENTS_LOG = 'runtime-events.jsonl'
const COMPUTER_USE_LOG = 'computer-use.log'
const CHAT_DIAGNOSTIC_EVENTS = new Set<ChatDiagnosticEventName>([
  'renderer_send_started',
  'renderer_send_queued',
  'renderer_new_session_created',
  'renderer_user_message_persisted',
  'renderer_agent_prompt_started',
  'renderer_agent_prompt_completed',
  'renderer_agent_prompt_failed',
  'agent_prompt_ipc_received',
  'agent_prompt_ipc_completed',
  'agent_prompt_ipc_failed',
  'agent_prompt_flow_started',
  'agent_session_resumed',
  'agent_runtime_resolved',
  'agent_run_created',
  'agent_run_started',
  'agent_run_finished',
  'agent_run_debug_started',
  'agent_run_debug_finished',
  'agent_hooks_started',
  'agent_hooks_completed',
  'agent_prompt_messages_prepared',
  'agent_prompt_returned',
  'agent_prompt_model_failed',
  'agent_prompt_failed',
  'agent_waiting_for_human_input',
  'agent_session_completed',
  'model_request_started',
  'model_request_finished',
  'diagnostics_exported',
  'diagnostics_export_file_skipped'
])

function logsRoot(): string {
  return join(getDataRoot(), 'logs')
}

function chatEventsLogPath(): string {
  return join(logsRoot(), CHAT_EVENTS_LOG)
}

function autoUpdateEventsLogPath(): string {
  return join(logsRoot(), AUTO_UPDATE_EVENTS_LOG)
}

function safeDetails(details: ChatDiagnosticDetails | undefined): ChatDiagnosticDetails {
  if (!details) return {}
  const safe: ChatDiagnosticDetails = {}
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue
    safe[key] = Array.isArray(value)
      ? value.map((item) => safePrimitive(item))
      : safePrimitive(value)
  }
  return safe
}

function safePrimitive(value: DiagnosticPrimitive): DiagnosticPrimitive {
  if (typeof value === 'string') {
    return value.slice(0, 500)
  }
  return value
}

function isDiagnosticPrimitive(value: unknown): value is DiagnosticPrimitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function normalizeChatDiagnosticInput(input: unknown): ChatDiagnosticEventInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Diagnostic event must be an object')
  }
  const raw = input as Record<string, unknown>
  if (
    typeof raw.event !== 'string' ||
    !CHAT_DIAGNOSTIC_EVENTS.has(raw.event as ChatDiagnosticEventName)
  ) {
    throw new Error('Unknown diagnostic event')
  }
  const details =
    raw.details && typeof raw.details === 'object' && !Array.isArray(raw.details)
      ? normalizeDiagnosticDetails(raw.details)
      : undefined
  return {
    event: raw.event as ChatDiagnosticEventName,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
    runId: typeof raw.runId === 'string' ? raw.runId : null,
    details
  }
}

function normalizeDiagnosticDetails(rawDetails: object): ChatDiagnosticDetails {
  const details: ChatDiagnosticDetails = {}
  for (const [key, value] of Object.entries(rawDetails)) {
    if (isDiagnosticPrimitive(value)) {
      details[key] = value
    } else if (Array.isArray(value) && value.every(isDiagnosticPrimitive)) {
      details[key] = value
    }
  }
  return details
}

export function writeChatDiagnosticEvent(input: ChatDiagnosticEventInput): void {
  appendJsonlLog(chatEventsLogPath(), {
    event: input.event,
    sessionId: input.sessionId?.trim() || null,
    runId: input.runId?.trim() || null,
    ...safeDetails(input.details)
  })
}

export function writeAutoUpdateDiagnosticEvent(
  event: string,
  details: Record<string, DiagnosticPrimitive> = {}
): void {
  appendJsonlLog(autoUpdateEventsLogPath(), {
    event: event.slice(0, 100),
    ...safeDetails(details)
  })
}

function addFileIfExists(zip: ZipFile, filePath: string, zipPath: string, includedFiles: string[]) {
  if (!existsSync(filePath)) return
  try {
    if (!statSync(filePath).isFile()) return
    zip.addFile(filePath, zipPath)
    includedFiles.push(zipPath)
  } catch (error) {
    appendJsonlLog(chatEventsLogPath(), {
      event: 'diagnostics_export_file_skipped',
      exportFile: zipPath,
      result: 'diagnostic_file_skipped',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

function diagnosticsManifest(
  includedFiles: string[],
  includeDatabase: boolean
): Record<string, unknown> {
  return {
    createdAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    includedFiles,
    includeDatabase,
    dataRoot: getDataRoot().replace(/\/Users\/[^/]+/g, '/Users/[redacted]'),
    note: 'This package includes diagnostic metadata and local log files. Chat message text is not included unless pichu.db is explicitly added.'
  }
}

export async function exportDiagnosticsPackage(
  options: DiagnosticsExportOptions = {}
): Promise<DiagnosticsExportResult> {
  const includeDatabase = options.includeDatabase === true
  const defaultName = `pichu-diagnostics-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19)}.zip`
  const result = await dialog.showSaveDialog({
    title: 'Export Owls diagnostics',
    defaultPath: join(app.getPath('desktop'), defaultName),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }]
  })
  if (result.canceled || !result.filePath) {
    return { exported: false, includedFiles: [] }
  }

  const zip = new ZipFile()
  const dataRoot = getDataRoot()
  const includedFiles: string[] = []
  addFileIfExists(
    zip,
    join(dataRoot, 'logs', CHAT_EVENTS_LOG),
    `logs/${CHAT_EVENTS_LOG}`,
    includedFiles
  )
  addFileIfExists(
    zip,
    join(dataRoot, 'logs', AUTH_EVENTS_LOG),
    `logs/${AUTH_EVENTS_LOG}`,
    includedFiles
  )
  addFileIfExists(
    zip,
    join(dataRoot, 'logs', AUTO_UPDATE_EVENTS_LOG),
    `logs/${AUTO_UPDATE_EVENTS_LOG}`,
    includedFiles
  )
  addFileIfExists(
    zip,
    join(dataRoot, 'plugins', 'logs', PLUGIN_EVENTS_LOG),
    `plugins/logs/${PLUGIN_EVENTS_LOG}`,
    includedFiles
  )
  addFileIfExists(
    zip,
    join(dataRoot, 'runtimes', 'logs', RUNTIME_EVENTS_LOG),
    `runtimes/logs/${RUNTIME_EVENTS_LOG}`,
    includedFiles
  )
  addFileIfExists(zip, join(dataRoot, COMPUTER_USE_LOG), COMPUTER_USE_LOG, includedFiles)
  if (includeDatabase) {
    addFileIfExists(zip, join(dataRoot, 'pichu.db'), 'pichu.db', includedFiles)
    addFileIfExists(zip, join(dataRoot, 'pichu.db-wal'), 'pichu.db-wal', includedFiles)
    addFileIfExists(zip, join(dataRoot, 'pichu.db-shm'), 'pichu.db-shm', includedFiles)
  }

  zip.addBuffer(
    Buffer.from(
      `${JSON.stringify(diagnosticsManifest(includedFiles, includeDatabase), null, 2)}\n`
    ),
    'manifest.json'
  )
  mkdirSync(dirname(result.filePath), { recursive: true })
  const writePromise = pipeline(zip.outputStream, createWriteStream(result.filePath))
  zip.end()
  await writePromise
  writeChatDiagnosticEvent({
    event: 'diagnostics_exported',
    details: {
      source: 'diagnostics_export',
      includedFileCount: includedFiles.length,
      includeDatabase
    }
  })
  return { exported: true, path: result.filePath, includedFiles }
}

export function registerDiagnosticsIpc(): void {
  ipcMain.handle('diagnostics:record-chat-event', (_, input: unknown) => {
    writeChatDiagnosticEvent(normalizeChatDiagnosticInput(input))
  })
  ipcMain.handle('diagnostics:export', (_, options?: DiagnosticsExportOptions) =>
    exportDiagnosticsPackage(options)
  )
}
