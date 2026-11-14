import type { SessionIndexEntry } from './types'

function sameSessionIndexEntry(left: SessionIndexEntry, right: SessionIndexEntry): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.agentId === right.agentId &&
    left.cwd === right.cwd &&
    left.title === right.title &&
    left.sessionKind === right.sessionKind &&
    left.parentSessionId === right.parentSessionId &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.pinned === right.pinned &&
    left.pinnedOrder === right.pinnedOrder &&
    left.sessionModelId === right.sessionModelId &&
    left.sessionThinkingLevel === right.sessionThinkingLevel &&
    left.sessionModelUpdatedAt === right.sessionModelUpdatedAt &&
    left.sessionModelUpdatedBy === right.sessionModelUpdatedBy
  )
}

export function reconcileSessionIndex(
  previous: SessionIndexEntry[],
  next: SessionIndexEntry[]
): SessionIndexEntry[] {
  if (previous.length === 0) return next

  const previousBySessionId = new Map(previous.map((entry) => [entry.sessionId, entry]))
  let changed = previous.length !== next.length
  const reconciled = next.map((entry, index) => {
    const previousEntry = previousBySessionId.get(entry.sessionId)
    if (!previousEntry || !sameSessionIndexEntry(previousEntry, entry)) {
      changed = true
      return entry
    }
    if (previous[index] !== previousEntry) {
      changed = true
    }
    return previousEntry
  })

  return changed ? reconciled : previous
}
