import type { SessionStoreSet } from './types'

function normalizeSessionIds(sessionIds: string[]): string[] {
  return [...new Set(sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean))]
}

export function setSessionRunning(sessionId: string, running: boolean, set: SessionStoreSet): void {
  set((state) => {
    const ids = new Set(state.runningSessionIds)
    if (running) {
      ids.add(sessionId)
    } else {
      ids.delete(sessionId)
    }
    return {
      runningSessionIds: [...ids],
      busy:
        state.sessionId === sessionId
          ? running || state.waitingSessionIds.includes(sessionId)
          : state.busy
    }
  })
}

export function markSessionUnread(sessionId: string, set: SessionStoreSet): void {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) return
  set((state) => {
    if (state.unreadSessionIds.includes(normalizedSessionId)) return {}
    return { unreadSessionIds: [...state.unreadSessionIds, normalizedSessionId] }
  })
}

export function clearSessionUnread(sessionId: string, set: SessionStoreSet): void {
  const normalizedSessionId = sessionId.trim()
  set((state) => ({
    unreadSessionIds: state.unreadSessionIds.filter((id) => id !== normalizedSessionId)
  }))
}

export function hydrateUnreadSessionIds(sessionIds: string[], set: SessionStoreSet): void {
  set((state) => ({
    unreadSessionIds: normalizeSessionIds([...sessionIds, ...state.unreadSessionIds]),
    unreadSessionIdsLoaded: true
  }))
}

export function markSessionFailed(sessionId: string, set: SessionStoreSet): void {
  set((state) => {
    if (state.failedSessionIds.includes(sessionId)) return {}
    return { failedSessionIds: [...state.failedSessionIds, sessionId] }
  })
}

export function clearSessionFailed(sessionId: string, set: SessionStoreSet): void {
  set((state) => ({
    failedSessionIds: state.failedSessionIds.filter((id) => id !== sessionId)
  }))
}
