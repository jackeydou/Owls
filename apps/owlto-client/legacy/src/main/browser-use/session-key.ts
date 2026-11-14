import { getSessionById } from '../stores/settings-store.js'

export function browserSessionKeyForSession(sessionId: string): string {
  const session = getSessionById(sessionId)
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`)
  }
  return session.sessionKind === 'side' && session.parentSessionId
    ? session.parentSessionId
    : sessionId
}

export function browserCursorSessionKeysForAgentSession(sessionId: string): string[] {
  const keys = new Set<string>([sessionId])
  const session = getSessionById(sessionId)
  if (session?.sessionKind === 'side' && session.parentSessionId) {
    keys.add(session.parentSessionId)
  }
  return [...keys]
}
