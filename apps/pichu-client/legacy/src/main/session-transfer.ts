import { ipcMain } from 'electron'
import {
  defaultVisibilityForRole,
  isPichuMessageVisibility,
  normalizeMessageKind
} from '../shared/agent-message-visibility.js'
import { type MessagePart, normalizeMessageParts } from '../shared/message-parts.js'
import { isPichuThinkingLevel, isSessionModelUpdatedBy } from '../shared/model-settings.js'
import {
  addImportedSession,
  getSessionById,
  getSessionBySharedSessionUrl,
  getSettingsForRenderer,
  type MessageRow,
  type SessionIndexEntry,
  saveSharedSessionUrl
} from './stores/settings-store.js'

const EXPORT_FORMAT = 'pichu.session.v1'
const MAX_IMPORT_BYTES = 50 * 1024 * 1024
const CLIENT_PROTOCOL = 'pichu-client'
const LEGACY_CLIENT_PROTOCOL = 'pix-client'

type ExportHeader = {
  type: typeof EXPORT_FORMAT
  version: 1
  exportedAt: string
  session: SessionIndexEntry
}

export type SessionImportResult = {
  status: 'imported'
  sessionId: string
  title: string
  messageCount: number
}

export type DuplicateSessionImportResult = {
  status: 'duplicate'
  sourceSessionId: string
  existingSessionId: string
  title: string
  messageCount: number
}

export type SessionImportResponse = SessionImportResult | DuplicateSessionImportResult

export type SessionImportOptions = {
  force?: boolean
}

type ParsedMessage = {
  sourceMessageId: string | null
  rawParts: unknown
  message: MessageRow
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMessageRole(value: unknown): value is MessageRow['role'] {
  return value === 'user' || value === 'assistant' || value === 'system' || value === 'tool'
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new Error(`Invalid session export: ${key} must be a string`)
  }
  return value
}

function requireIsoString(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key)
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid session export: ${key} must be a valid date`)
  }
  return value
}

function parseHeader(value: unknown): ExportHeader {
  if (!isRecord(value) || value.type !== EXPORT_FORMAT || value.version !== 1) {
    throw new Error('The selected file is not an Owls session JSONL export')
  }
  if (!isRecord(value.session)) {
    throw new Error('Invalid session export: missing session metadata')
  }

  return {
    type: EXPORT_FORMAT,
    version: 1,
    exportedAt: requireIsoString(value, 'exportedAt'),
    session: {
      sessionId: requireString(value.session, 'sessionId'),
      agentId: requireString(value.session, 'agentId'),
      cwd: requireString(value.session, 'cwd'),
      title: requireString(value.session, 'title'),
      createdAt: requireIsoString(value.session, 'createdAt'),
      updatedAt: requireIsoString(value.session, 'updatedAt'),
      sessionModelId: stringOrNull(value.session.sessionModelId),
      sessionThinkingLevel:
        typeof value.session.sessionThinkingLevel === 'string' &&
        isPichuThinkingLevel(value.session.sessionThinkingLevel)
          ? value.session.sessionThinkingLevel
          : null,
      sessionModelUpdatedAt: stringOrNull(value.session.sessionModelUpdatedAt),
      sessionModelUpdatedBy:
        typeof value.session.sessionModelUpdatedBy === 'string' &&
        isSessionModelUpdatedBy(value.session.sessionModelUpdatedBy)
          ? value.session.sessionModelUpdatedBy
          : null
    }
  }
}

function cloneImportedMessageParts(
  value: unknown,
  messageIdBySourceId: Map<string, string>
): MessagePart[] {
  return normalizeMessageParts(value).map((part) => {
    const id = crypto.randomUUID()
    if (part.type === 'selectionContext' && part.sourceMessageId) {
      return {
        ...part,
        id,
        sourceMessageId: messageIdBySourceId.get(part.sourceMessageId) ?? part.sourceMessageId
      }
    }
    if (part.type === 'comment') {
      const commentId = crypto.randomUUID()
      return {
        ...part,
        id,
        commentId,
        localBrowserScreenshot: part.localBrowserScreenshot
          ? { ...part.localBrowserScreenshot, commentId }
          : undefined,
        localArtifactAnnotationContext: part.localArtifactAnnotationContext
          ? { ...part.localArtifactAnnotationContext, annotationId: commentId }
          : undefined
      }
    }
    return { ...part, id }
  })
}

function parseMessage(value: unknown, sortOrder: number): ParsedMessage {
  if (!isRecord(value) || value.type !== 'message' || !isRecord(value.message)) {
    throw new Error(`Invalid session export: line ${sortOrder + 2} must be a message record`)
  }

  const message = value.message
  const role = message.role
  if (!isMessageRole(role)) {
    throw new Error(`Invalid session export: line ${sortOrder + 2} has an unsupported role`)
  }

  return {
    sourceMessageId: stringOrNull(message.id),
    rawParts: message.parts,
    message: {
      id: crypto.randomUUID(),
      sessionId: '',
      role,
      kind: normalizeMessageKind(message.kind),
      content: requireString(message, 'content'),
      agentContent: requireString(message, 'agentContent'),
      visibility: isPichuMessageVisibility(message.visibility)
        ? message.visibility
        : defaultVisibilityForRole(role),
      sortOrder,
      createdAt: requireIsoString(message, 'createdAt'),
      toolCallId: stringOrNull(message.toolCallId),
      toolName: stringOrNull(message.toolName),
      toolCallResult: stringOrNull(message.toolCallResult),
      attachmentsJson: stringOrNull(message.attachmentsJson),
      modelId: stringOrNull(message.modelId),
      modelProvider: stringOrNull(message.modelProvider),
      modelApi: stringOrNull(message.modelApi),
      modelUsageJson: stringOrNull(message.modelUsageJson),
      parts: []
    }
  }
}

function buildSessionImportDeeplink(cdnUrl: string): string {
  return `${CLIENT_PROTOCOL}://session/import?url=${encodeURIComponent(cdnUrl)}`
}

function parseSessionJsonl(content: string): {
  header: ExportHeader
  messages: MessageRow[]
} {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) {
    throw new Error('The selected JSONL file is empty')
  }

  let header: ExportHeader
  try {
    header = parseHeader(JSON.parse(lines[0]) as unknown)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('The selected file is not valid JSONL')
    }
    throw error
  }

  const parsedMessages = lines.slice(1).map((line, index) => {
    try {
      return parseMessage(JSON.parse(line) as unknown, index)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid session export: line ${index + 2} is not valid JSON`)
      }
      throw error
    }
  })
  const messageIdBySourceId = new Map(
    parsedMessages.flatMap((parsed) =>
      parsed.sourceMessageId ? [[parsed.sourceMessageId, parsed.message.id] as const] : []
    )
  )
  const messages = parsedMessages.map((parsed) => ({
    ...parsed.message,
    parts: cloneImportedMessageParts(parsed.rawParts, messageIdBySourceId)
  }))

  return { header, messages }
}

function importSessionJsonlFromContent(
  content: string,
  fallbackTitle: string,
  options: SessionImportOptions = {},
  sourceUrl?: string
): SessionImportResponse {
  if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) {
    throw new Error('Session export is too large to import')
  }

  const { header, messages } = parseSessionJsonl(content)
  const existingSession =
    (sourceUrl ? getSessionBySharedSessionUrl(sourceUrl) : undefined) ??
    getSessionById(header.session.sessionId)
  if (existingSession && options.force !== true) {
    return {
      status: 'duplicate',
      sourceSessionId: header.session.sessionId,
      existingSessionId: existingSession.sessionId,
      title: existingSession.title || header.session.title || fallbackTitle,
      messageCount: messages.length
    }
  }

  const sessionId = crypto.randomUUID()
  const now = new Date().toISOString()
  const cwd = getSettingsForRenderer().workingDirectory
  const title = header.session.title.trim() || fallbackTitle
  const importedMessages = messages.map((message) => ({
    ...message,
    sessionId
  }))

  addImportedSession({
    sessionId,
    agentId: header.session.agentId || 'pi-agent',
    cwd,
    title,
    createdAt: header.session.createdAt,
    updatedAt: now,
    sessionModelId: header.session.sessionModelId,
    sessionThinkingLevel: header.session.sessionThinkingLevel,
    sessionModelUpdatedAt: header.session.sessionModelUpdatedAt,
    sessionModelUpdatedBy: header.session.sessionModelUpdatedBy,
    messages: importedMessages
  })
  if (sourceUrl) {
    saveSharedSessionUrl({
      sessionId,
      sourceUpdatedAt: now,
      url: sourceUrl
    })
  }

  return {
    status: 'imported',
    sessionId,
    title,
    messageCount: importedMessages.length
  }
}

async function downloadSessionJsonl(url: string): Promise<string> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('Session import URL must be a valid URL')
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Session import URL must use HTTPS')
  }

  const response = await fetch(parsedUrl)
  if (!response.ok) {
    throw new Error(`Failed to download session export: HTTP ${response.status}`)
  }

  const contentLength = Number(response.headers.get('content-length') ?? '0')
  if (contentLength > MAX_IMPORT_BYTES) {
    throw new Error('Session export is too large to import')
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_IMPORT_BYTES) {
    throw new Error('Session export is too large to import')
  }

  return buffer.toString('utf8')
}

function unwrapSessionImportUrl(value: string): string {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(value)
  } catch {
    throw new Error('Session import URL must be a valid URL')
  }

  if (
    [CLIENT_PROTOCOL, LEGACY_CLIENT_PROTOCOL].some(
      (clientProtocol) => parsedUrl.protocol === `${clientProtocol}:`
    ) &&
    parsedUrl.hostname === 'session'
  ) {
    if (parsedUrl.pathname !== '/import') {
      throw new Error('Session import deeplink must point to a shared session import')
    }
    const cdnUrl = parsedUrl.searchParams.get('url')?.trim()
    if (!cdnUrl) {
      throw new Error('Session import deeplink is missing its CDN URL')
    }
    return cdnUrl
  }

  return value
}

export async function importSessionJsonlFromUrl(
  url: string,
  options: SessionImportOptions = {}
): Promise<SessionImportResponse> {
  const cdnUrl = unwrapSessionImportUrl(url)
  const sourceUrl = buildSessionImportDeeplink(cdnUrl)
  const content = await downloadSessionJsonl(cdnUrl)
  const fallbackTitle = new URL(cdnUrl).pathname
    .split('/')
    .pop()
    ?.replace(/\.jsonl$/i, '')
  return importSessionJsonlFromContent(
    content,
    fallbackTitle || 'Imported session',
    options,
    sourceUrl
  )
}

function normalizeSessionImportIpcInput(value: unknown): {
  url: string
  options: SessionImportOptions
} {
  if (typeof value === 'string') {
    return { url: value, options: {} }
  }
  if (isRecord(value)) {
    return {
      url: typeof value.url === 'string' ? value.url : '',
      options: { force: value.force === true }
    }
  }
  return { url: '', options: {} }
}

export function registerSessionTransferIpc(): void {
  ipcMain.handle('agent:session-import-jsonl', async (_, input: unknown) => {
    const { url, options } = normalizeSessionImportIpcInput(input)
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      throw new Error('Session import URL is required')
    }

    return importSessionJsonlFromUrl(trimmedUrl, options)
  })
}
