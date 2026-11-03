import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ipcMain } from 'electron'
import { normalizeWebTargetUrl } from '../../shared/web-targets.js'
import type { SessionIndexSortKey } from '../stores/settings-store.js'
import {
  archiveSessionInIndex,
  deleteAllArchivedSessionsFromIndex,
  deleteArchivedSessionFromIndex,
  deleteSideSessionFromIndex,
  deleteSideSessionsForParent,
  getArchivedSessionIndex,
  getSessionById,
  getSessionIndex,
  getSideSessionsForParent,
  reorderPinnedSessions,
  setSessionPinned,
  unarchiveSessionInIndex,
  updateSessionTitle
} from '../stores/settings-store.js'
import type { SessionFileEntry } from './session-workspace.js'

type SessionIpcContext = {
  hasSessionRuntime: (sessionId: string) => boolean
  disposeSessionRuntime: (sessionId: string, force?: boolean) => Promise<void>
  resolveSessionDirectory: (entry: { cwd: string }, sessionId: string) => string
  listSessionDirectory: (sessionDir: string, directory?: string) => SessionFileEntry[]
  assertWithinDirectory: (rootDir: string, targetPath: string) => void
  generateAndSaveSessionTitle: (
    sessionId: string,
    fallbackText: string,
    hasImages?: boolean
  ) => Promise<string>
}

function parseSessionFileUrlParams(value: unknown): { sessionId: string; filePath: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Session id and file path are required')
  }
  const sessionId =
    typeof (value as { sessionId?: unknown }).sessionId === 'string'
      ? (value as { sessionId: string }).sessionId.trim()
      : ''
  const filePath =
    typeof (value as { filePath?: unknown }).filePath === 'string'
      ? (value as { filePath: string }).filePath.trim()
      : ''
  if (!sessionId || !filePath) {
    throw new Error('Session id and file path are required')
  }
  return { sessionId, filePath }
}

function resolveSafeSessionFilePath(
  context: Pick<SessionIpcContext, 'assertWithinDirectory'>,
  sessionDir: string,
  filePath: string,
  symlinkError: string,
  directoryError: string
): string {
  const fullPath = resolve(sessionDir, filePath)
  context.assertWithinDirectory(sessionDir, fullPath)

  const linkStats = lstatSync(fullPath)
  if (linkStats.isSymbolicLink()) {
    throw new Error(symlinkError)
  }

  const realSessionDir = realpathSync.native(sessionDir)
  const realFullPath = realpathSync.native(fullPath)
  context.assertWithinDirectory(realSessionDir, realFullPath)

  const stats = statSync(realFullPath)
  if (stats.isDirectory()) {
    throw new Error(directoryError)
  }

  return realFullPath
}

export function registerSessionIpcHandlers(context: SessionIpcContext): void {
  ipcMain.handle('agent:session-index', (_, params?: { sortKey?: SessionIndexSortKey }) => {
    return getSessionIndex(params?.sortKey === 'created' ? 'created' : 'updated')
  })

  ipcMain.handle(
    'agent:session-files',
    (_, params: string | { sessionId?: string; directory?: string } | null) => {
      const payload = typeof params === 'object' && params !== null ? params : null
      const sessionId =
        typeof params === 'string'
          ? params.trim()
          : typeof payload?.sessionId === 'string'
            ? payload.sessionId.trim()
            : ''
      if (!sessionId) {
        throw new Error('Session id is required')
      }

      const directory = typeof payload?.directory === 'string' ? payload.directory : ''
      const entry = getSessionById(sessionId)
      if (!entry) {
        throw new Error(`Unknown session: ${sessionId}`)
      }

      const sessionDir = context.resolveSessionDirectory(entry, sessionId)
      return context.listSessionDirectory(sessionDir, directory)
    }
  )

  ipcMain.handle(
    'agent:read-session-file',
    (_, params: { sessionId: string; filePath: string }) => {
      const sessionId = params.sessionId?.trim()
      const filePath = params.filePath?.trim()
      if (!sessionId || !filePath) {
        throw new Error('Session id and file path are required')
      }

      const entry = getSessionById(sessionId)
      if (!entry) {
        throw new Error(`Unknown session: ${sessionId}`)
      }

      const sessionDir = context.resolveSessionDirectory(entry, sessionId)
      const fullPath = resolveSafeSessionFilePath(
        context,
        sessionDir,
        filePath,
        'Cannot preview a symbolic link',
        'Cannot preview a directory'
      )

      const content = readFileSync(fullPath)
      if (content.includes(0)) {
        return 'Binary file preview is not available.'
      }

      return content.toString('utf8')
    }
  )

  ipcMain.handle('agent:session-file-url', (_, params: unknown) => {
    const { sessionId, filePath } = parseSessionFileUrlParams(params)
    const entry = getSessionById(sessionId)
    if (!entry) {
      throw new Error(`Unknown session: ${sessionId}`)
    }

    const sessionDir = context.resolveSessionDirectory(entry, sessionId)
    const fullPath = resolveSafeSessionFilePath(
      context,
      sessionDir,
      filePath,
      'Cannot open a symbolic link in the browser',
      'Cannot open a directory in the browser'
    )

    const fileUrl = pathToFileURL(fullPath).toString()
    const webTargetUrl = normalizeWebTargetUrl(fileUrl)
    if (!webTargetUrl) {
      throw new Error('Only local HTML files can be opened in the browser')
    }
    return webTargetUrl
  })

  ipcMain.handle('agent:session-index-update-title', (_, sessionId: string, title: string) => {
    updateSessionTitle(sessionId, title)
  })

  ipcMain.handle('agent:session-index-set-pinned', (_, sessionId: string, pinned: boolean) => {
    const normalizedSessionId = sessionId?.trim()
    if (!normalizedSessionId) {
      throw new Error('Session id is required')
    }
    if (!getSessionById(normalizedSessionId)) {
      throw new Error(`Unknown session: ${normalizedSessionId}`)
    }
    setSessionPinned(normalizedSessionId, Boolean(pinned))
  })

  ipcMain.handle('agent:session-index-reorder-pinned', (_, sessionIds: string[]) => {
    if (!Array.isArray(sessionIds)) {
      throw new Error('Session ids are required')
    }
    for (const sessionId of sessionIds) {
      if (typeof sessionId !== 'string' || !getSessionById(sessionId)) {
        throw new Error(`Unknown session: ${sessionId}`)
      }
    }
    reorderPinnedSessions(sessionIds)
  })

  ipcMain.handle(
    'agent:generate-session-title',
    async (_, params: { sessionId: string; fallbackText: string; hasImages?: boolean }) => {
      const sessionId = params.sessionId?.trim()
      if (!sessionId) {
        throw new Error('Session id is required')
      }
      if (!getSessionById(sessionId)) {
        throw new Error(`Unknown session: ${sessionId}`)
      }
      return context.generateAndSaveSessionTitle(
        sessionId,
        params.fallbackText ?? '',
        params.hasImages === true
      )
    }
  )

  const disposeSessionAndSideChildren = async (
    entry: ReturnType<typeof getSessionById>
  ): Promise<void> => {
    if (!entry) return
    if (context.hasSessionRuntime(entry.sessionId)) {
      await context.disposeSessionRuntime(entry.sessionId, entry.sessionKind === 'side')
    }
    if (entry.sessionKind !== 'main') return
    for (const child of getSideSessionsForParent(entry.sessionId)) {
      if (context.hasSessionRuntime(child.sessionId)) {
        await context.disposeSessionRuntime(child.sessionId, true)
      }
    }
  }

  const archiveSession = async (sessionId: string): Promise<void> => {
    const normalizedSessionId = sessionId?.trim()
    if (!normalizedSessionId) {
      throw new Error('Session id is required')
    }
    const entry = getSessionById(normalizedSessionId)
    if (!entry) {
      throw new Error(`Unknown session: ${normalizedSessionId}`)
    }
    await disposeSessionAndSideChildren(entry)
    if (entry.sessionKind === 'side') {
      deleteSideSessionFromIndex(normalizedSessionId)
      return
    }
    deleteSideSessionsForParent(normalizedSessionId)
    archiveSessionInIndex(normalizedSessionId)
  }

  ipcMain.handle('agent:session-index-archive', async (_, sessionId: string) => {
    await archiveSession(sessionId)
  })

  ipcMain.handle('agent:session-index-remove', async (_, sessionId: string) => {
    await archiveSession(sessionId)
  })

  ipcMain.handle('agent:archived-session-index', () => {
    return getArchivedSessionIndex()
  })

  ipcMain.handle('agent:session-index-unarchive', (_, sessionId: string) => {
    const normalizedSessionId = sessionId?.trim()
    if (!normalizedSessionId) {
      throw new Error('Session id is required')
    }
    if (!getSessionById(normalizedSessionId)) {
      throw new Error(`Unknown session: ${normalizedSessionId}`)
    }
    unarchiveSessionInIndex(normalizedSessionId)
  })

  ipcMain.handle('agent:archived-session-delete', async (_, sessionId: string) => {
    const normalizedSessionId = sessionId?.trim()
    if (!normalizedSessionId) {
      throw new Error('Session id is required')
    }
    const entry = getSessionById(normalizedSessionId)
    if (!entry) {
      throw new Error(`Unknown session: ${normalizedSessionId}`)
    }
    if (!entry.archivedAt) {
      throw new Error(`Session is not archived: ${normalizedSessionId}`)
    }
    await disposeSessionAndSideChildren(entry)
    deleteArchivedSessionFromIndex(normalizedSessionId)
  })

  ipcMain.handle('agent:archived-sessions-delete-all', async () => {
    const archivedSessions = getArchivedSessionIndex()
    for (const entry of archivedSessions) {
      await disposeSessionAndSideChildren(entry)
    }
    return deleteAllArchivedSessionsFromIndex()
  })
}
