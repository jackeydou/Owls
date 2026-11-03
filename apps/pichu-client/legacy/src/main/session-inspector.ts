import type { Dirent } from 'node:fs'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import type { SessionFile, SessionListResult, SessionText } from '@pichu/session-inspector'
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron'
import { MODEL_TRAJECTORY_LOG_DIR_NAME } from '../shared/model-trajectory.js'
import { sqlite } from './db/index.js'
import { getDataRoot } from './pichu-paths.js'
import { getSessionById, getSessionIndex, getSessionMessages } from './stores/settings-store.js'

type RawRecord = Record<string, unknown>
type PichuMessage = ReturnType<typeof getSessionMessages>[number]

const codexSessionsRoot = join(homedir(), '.codex', 'sessions')
const codexArchivedSessionsRoot = join(homedir(), '.codex', 'archived_sessions')
const codexSessionIndexPath = join(homedir(), '.codex', 'session_index.jsonl')
const maxSessionFileBytes = 80 * 1024 * 1024
const latestPichuSessionPath = 'pichu://latest'
const latestPichuSessionToken = latestPichuSessionPath.slice('pichu://'.length)
const optionalSessionListTimeoutMs = 1500

function roundedMs(value: number): number {
  return Number(value.toFixed(1))
}

function pichuTrajectoriesRoot(): string {
  return join(getDataRoot(), MODEL_TRAJECTORY_LOG_DIR_NAME)
}

async function isPathInside(parent: string, child: string): Promise<boolean> {
  try {
    const [realParent, realChild] = await Promise.all([fs.realpath(parent), fs.realpath(child)])
    const rel = relative(realParent, realChild)
    return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel) && rel !== '..'
  } catch {
    return false
  }
}

async function archivedCodexSessionFallback(absolute: string): Promise<string | null> {
  const rel = relative(codexSessionsRoot, absolute)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return null
  }

  const archivedPath = join(codexArchivedSessionsRoot, basename(absolute))
  try {
    const stat = await fs.stat(archivedPath)
    return stat.isFile() ? archivedPath : null
  } catch {
    return null
  }
}

async function resolveAllowedSessionPath(value: string): Promise<string> {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Session path is required')
  }
  const expanded = trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed
  const absolute = resolve(expanded)
  if (!absolute.endsWith('.jsonl')) {
    throw new Error('Only .jsonl session files can be read')
  }

  const trajectoriesRoot = pichuTrajectoriesRoot()
  const [isCodexSession, isArchivedCodexSession, isModelTrajectory] = await Promise.all([
    isPathInside(codexSessionsRoot, absolute),
    isPathInside(codexArchivedSessionsRoot, absolute),
    isPathInside(trajectoriesRoot, absolute)
  ])
  if (isCodexSession || isArchivedCodexSession || isModelTrajectory) {
    return absolute
  }

  const archivedFallback = await archivedCodexSessionFallback(absolute)
  if (archivedFallback) {
    return archivedFallback
  }

  throw new Error('Only Codex sessions and Owls model trajectories can be read')
}

function sessionIdFromCodexPath(filePath: string): string {
  const match = basename(filePath).match(
    /rollout-.+?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
  )
  return match?.[1] || ''
}

async function readCodexTitleIndex(): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  try {
    const text = await fs.readFile(codexSessionIndexPath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line) as { id?: unknown; thread_name?: unknown }
        if (typeof record.id === 'string' && typeof record.thread_name === 'string') {
          titles.set(record.id, record.thread_name)
        }
      } catch {
        // Ignore malformed historical index rows.
      }
    }
  } catch {
    // Older Codex installs may not have this index.
  }
  return titles
}

async function walkCodexSessions(
  dir: string,
  limit: number,
  titleIndex: Map<string, string>,
  acc: SessionFile[] = []
): Promise<SessionFile[]> {
  if (acc.length >= limit) return acc

  let entries: Dirent[] = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }

  entries.sort((left, right) => right.name.localeCompare(left.name))
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkCodexSessions(fullPath, limit, titleIndex, acc)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const stat = await fs.stat(fullPath)
      const sessionId = sessionIdFromCodexPath(fullPath)
      const title = titleIndex.get(sessionId) || ''
      acc.push({
        source: 'codex',
        key: `codex:${fullPath}`,
        path: fullPath,
        sessionId,
        name: title || entry.name,
        title,
        fileName: entry.name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      })
    }
    if (acc.length >= limit) break
  }
  return acc
}

async function listTrajectorySessions(limit: number): Promise<SessionFile[]> {
  const root = pichuTrajectoriesRoot()
  let entries: Dirent[] = []
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(async (entry) => {
        const fullPath = join(root, entry.name)
        const stat = await fs.stat(fullPath)
        const sessionId = entry.name.replace(/\.jsonl$/i, '')
        return {
          source: 'trajectory' as const,
          key: `trajectory:${fullPath}`,
          path: fullPath,
          sessionId,
          name: sessionId,
          title: sessionId,
          fileName: entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString()
        }
      })
  )

  return files
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
    .slice(0, limit)
}

function listPichuSessionStats(): Map<string, { messageCount: number; size: number }> {
  const rows = sqlite()
    .prepare(
      `
      select
        session_id as sessionId,
        count(id) as messageCount,
        coalesce(sum(length(content) + length(coalesce(agent_content, '')) + length(coalesce(tool_call_result, ''))), 0) as size
      from messages
      group by session_id
    `
    )
    .all() as Array<{ sessionId: string; messageCount: number; size: number }>
  return new Map(rows.map((row) => [row.sessionId, row]))
}

function listPichuSessions(limit: number): SessionFile[] {
  const statsBySessionId = listPichuSessionStats()
  return getSessionIndex('updated')
    .slice(0, limit)
    .map((session) => {
      const stats = statsBySessionId.get(session.sessionId)
      return {
        source: 'pichu',
        key: `pichu:${session.sessionId}`,
        sessionId: session.sessionId,
        name: session.title || session.sessionId,
        title: session.title || '',
        path: `pichu://${session.sessionId}`,
        size: Number(stats?.size || 0),
        messageCount: Number(stats?.messageCount || 0),
        modifiedAt: session.updatedAt,
        createdAt: session.createdAt,
        cwd: session.cwd,
        agentId: session.agentId
      }
    })
}

function latestPichuSessionId(): string {
  return getSessionIndex('updated')[0]?.sessionId || ''
}

async function optionalSessionSource(
  label: string,
  task: Promise<SessionFile[]>
): Promise<SessionFile[]> {
  let timeoutId: NodeJS.Timeout | null = null
  const timeout = new Promise<SessionFile[]>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn('[session-inspector:main] skipped slow optional sessions source', {
        label,
        timeoutMs: optionalSessionListTimeoutMs
      })
      resolve([])
    }, optionalSessionListTimeoutMs)
  })

  try {
    return await Promise.race([
      task.catch((error) => {
        console.warn('[session-inspector:main] failed to list optional sessions source', {
          label,
          error
        })
        return []
      }),
      timeout
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

function parseJsonText(text: string | null | undefined): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function messageContent(role: string, content: string): Array<{ type: string; text: string }> {
  const type = role === 'assistant' ? 'output_text' : 'input_text'
  return [{ type, text: content || '' }]
}

function assistantReplayContent(callRecord: Record<string, unknown>): RawRecord[] {
  return Array.isArray(callRecord.assistantContent)
    ? callRecord.assistantContent.filter(
        (block): block is RawRecord =>
          Boolean(block) && typeof block === 'object' && !Array.isArray(block)
      )
    : []
}

function assistantReplayPrefix(callRecord: Record<string, unknown>): RawRecord[] {
  return assistantReplayContent(callRecord).filter((block) => block.type !== 'toolCall')
}

function isRuntimeContextMessage(message: PichuMessage): boolean {
  return (
    message.role === 'user' &&
    message.visibility === 'model-only' &&
    message.content.includes('The following context is provided by Owls')
  )
}

function modelMetadata(message: PichuMessage): RawRecord {
  const usage = parseJsonText(message.modelUsageJson)
  return {
    ...(message.modelId ? { model: message.modelId } : {}),
    ...(message.modelProvider ? { model_provider: message.modelProvider } : {}),
    ...(message.modelApi ? { model_api: message.modelApi } : {}),
    ...(usage && typeof usage === 'object' ? { usage } : {})
  }
}

function pichuRowsToJsonl(
  session: NonNullable<ReturnType<typeof getSessionById>>,
  messages: PichuMessage[]
): string {
  const systemMessage = messages.find((message) => message.role === 'system')
  const modelMessage = [...messages].reverse().find((message) => message.modelId)
  const sessionModel = modelMessage?.modelId || session.sessionModelId || session.agentId
  const records: RawRecord[] = [
    {
      timestamp: session.createdAt,
      type: 'session_meta',
      payload: {
        id: session.sessionId,
        timestamp: session.createdAt,
        cwd: session.cwd,
        originator: 'Owls',
        source: 'pichu',
        model_provider: modelMessage?.modelProvider || session.agentId,
        ...(modelMessage?.modelId ? { model: modelMessage.modelId } : {}),
        ...(modelMessage?.modelApi ? { model_api: modelMessage.modelApi } : {}),
        title: session.title,
        agent_id: session.agentId,
        base_instructions: { text: systemMessage?.content || '' }
      }
    },
    {
      timestamp: session.createdAt,
      type: 'turn_context',
      payload: {
        turn_id: session.sessionId,
        cwd: session.cwd,
        current_date: session.createdAt.slice(0, 10),
        model: sessionModel,
        effort: '',
        summary: session.title || 'pichu session',
        user_instructions: '',
        developer_instructions: ''
      }
    }
  ]

  for (const message of messages) {
    const timestamp = message.createdAt
    const visibility = message.visibility || 'shared'
    if (message.role === 'system') continue

    if (message.role === 'tool') {
      const call = parseJsonText(message.content)
      const callRecord =
        call && typeof call === 'object' && !Array.isArray(call)
          ? (call as Record<string, unknown>)
          : {}
      const callName =
        message.toolName || (typeof callRecord.name === 'string' ? callRecord.name : '') || 'tool'
      const callArguments = Object.hasOwn(callRecord, 'arguments') ? callRecord.arguments : call
      const assistantPrefix = assistantReplayPrefix(callRecord)
      if (assistantPrefix.length > 0) {
        records.push({
          timestamp,
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'pre_tool',
            visibility,
            ...modelMetadata(message),
            content: assistantPrefix
          }
        })
      }
      records.push({
        timestamp,
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: callName,
          call_id: message.toolCallId || message.id,
          visibility,
          ...modelMetadata(message),
          arguments:
            typeof callArguments === 'string' ? callArguments : JSON.stringify(callArguments ?? {})
        }
      })
      records.push({
        timestamp,
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: message.toolCallId || message.id,
          visibility,
          output: parseJsonText(message.toolCallResult) ?? ''
        }
      })
      continue
    }

    const phase = isRuntimeContextMessage(message) ? 'runtime_context' : undefined
    records.push({
      timestamp,
      type: 'response_item',
      payload: {
        type: 'message',
        role: message.role,
        visibility,
        ...modelMetadata(message),
        ...(phase ? { phase, source: 'pichu.runtime_context' } : {}),
        content: messageContent(message.role, message.content)
      }
    })

    if (
      message.role === 'user' &&
      message.agentContent &&
      message.agentContent !== message.content
    ) {
      records.push({
        timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          phase: 'agent_input',
          visibility: 'model-only',
          source: 'pichu.agent_content',
          content: messageContent('user', message.agentContent)
        }
      })
    }
  }

  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
}

async function readFileSessionText(filePath: string): Promise<SessionText> {
  const totalStart = performance.now()
  const resolved = await resolveAllowedSessionPath(filePath)
  const statStart = performance.now()
  const stat = await fs.stat(resolved)
  const statEnd = performance.now()
  if (stat.size > maxSessionFileBytes) {
    throw new Error('Session file is larger than 80 MB')
  }
  const readStart = performance.now()
  const body = await fs.readFile(resolved, 'utf8')
  const readEnd = performance.now()
  const titleStart = performance.now()
  const title = (await readCodexTitleIndex()).get(sessionIdFromCodexPath(resolved)) || ''
  const titleEnd = performance.now()
  console.info('[session-inspector:main] read file', {
    path: resolved,
    bytes: stat.size,
    statMs: roundedMs(statEnd - statStart),
    readFileMs: roundedMs(readEnd - readStart),
    titleIndexMs: roundedMs(titleEnd - titleStart),
    totalMs: roundedMs(performance.now() - totalStart)
  })
  return { body, title }
}

function readPichuSessionText(sessionId: string): SessionText {
  const totalStart = performance.now()
  const trimmedSessionId = sessionId.trim()
  if (!trimmedSessionId) {
    throw new Error('Owls session id is required')
  }
  const normalizedSessionId =
    trimmedSessionId === latestPichuSessionToken ? latestPichuSessionId() : trimmedSessionId
  if (!normalizedSessionId) {
    throw new Error('No Owls sessions found')
  }
  const session = getSessionById(normalizedSessionId)
  if (!session) {
    throw new Error(`Owls session not found: ${normalizedSessionId}`)
  }
  const messagesStart = performance.now()
  const messages = getSessionMessages(normalizedSessionId)
  const messagesEnd = performance.now()
  const jsonlStart = performance.now()
  const body = pichuRowsToJsonl(session, messages)
  const jsonlEnd = performance.now()
  console.info('[session-inspector:main] read pichu session', {
    sessionId: normalizedSessionId,
    messages: messages.length,
    bytes: body.length,
    getMessagesMs: roundedMs(messagesEnd - messagesStart),
    stringifyMs: roundedMs(jsonlEnd - jsonlStart),
    totalMs: roundedMs(performance.now() - totalStart)
  })
  return {
    body,
    title: session.title
  }
}

function assertSessionInspectorEnabled(isEnabled?: () => boolean): void {
  if (isEnabled && !isEnabled()) {
    throw new Error('Session Inspector is only available in debug and beta builds')
  }
}

function assertSessionInspectorCaller(
  event: IpcMainInvokeEvent,
  getWindow?: () => BrowserWindow | null
): void {
  const window = getWindow?.()
  if (!window || window.isDestroyed() || event.sender !== window.webContents) {
    throw new Error('Unauthorized session-inspector IPC caller')
  }
}

export function registerSessionInspectorIpc(
  options: {
    isEnabled?: () => boolean
    openWindow?: () => void
    getWindow?: () => BrowserWindow | null
  } = {}
): void {
  ipcMain.handle('session-inspector:open-window', () => {
    assertSessionInspectorEnabled(options.isEnabled)
    options.openWindow?.()
  })

  ipcMain.handle(
    'session-inspector:list-sessions',
    async (event, input?: { includeOptional?: boolean; limit?: number }) => {
      assertSessionInspectorEnabled(options.isEnabled)
      assertSessionInspectorCaller(event, options.getWindow)
      const limit = Math.min(Math.max(Number(input?.limit || 160), 1), 300)
      const pichuSessions = listPichuSessions(limit)
      const includeOptional = input?.includeOptional !== false
      const [codexSessions, archivedCodexSessions, trajectorySessions] = includeOptional
        ? await (async () => {
            const titleIndexPromise = readCodexTitleIndex()
            return Promise.all([
              optionalSessionSource(
                'sessions',
                titleIndexPromise.then((titleIndex) =>
                  walkCodexSessions(codexSessionsRoot, limit, titleIndex)
                )
              ),
              optionalSessionSource(
                'archived_sessions',
                titleIndexPromise.then((titleIndex) =>
                  walkCodexSessions(codexArchivedSessionsRoot, limit, titleIndex)
                )
              ),
              optionalSessionSource('trajectories', listTrajectorySessions(limit))
            ])
          })()
        : [[], [], []]
      const sessions = [
        ...pichuSessions,
        ...codexSessions,
        ...archivedCodexSessions,
        ...trajectorySessions
      ]
      sessions.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
      return {
        root: codexSessionsRoot,
        sessions: sessions.slice(0, limit)
      } satisfies SessionListResult
    }
  )

  ipcMain.handle('session-inspector:read-session-text', async (event, sessionPath: string) => {
    assertSessionInspectorEnabled(options.isEnabled)
    assertSessionInspectorCaller(event, options.getWindow)
    const totalStart = performance.now()
    const path = sessionPath?.trim()
    if (!path) {
      throw new Error('Session path is required')
    }
    const result = path.startsWith('pichu://')
      ? readPichuSessionText(path.slice('pichu://'.length))
      : await readFileSessionText(path)
    console.info('[session-inspector:main] read-session-text handled', {
      path,
      bytes: result.body.length,
      totalMs: roundedMs(performance.now() - totalStart)
    })
    return result
  })
}
