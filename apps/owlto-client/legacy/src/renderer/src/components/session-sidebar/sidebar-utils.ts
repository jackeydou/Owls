import type { SessionIndexEntry } from '@renderer/stores/session-store'
import type { ProjectSortSetting } from '@renderer/stores/settings-store'
import type { ProjectEntry } from '../../../../preload/index.d'

export type SessionSortKey = 'updated' | 'created'
export type ProjectSortKey = ProjectSortSetting

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (days < 70) return `${weeks}w`
  return new Date(iso).toLocaleDateString()
}

function getSessionSortTime(entry: SessionIndexEntry, sortKey: SessionSortKey): number {
  const value = sortKey === 'created' ? entry.createdAt : entry.updatedAt || entry.createdAt
  return new Date(value).getTime()
}

export function compareSessionsBySortKey(
  left: SessionIndexEntry,
  right: SessionIndexEntry,
  sortKey: SessionSortKey
): number {
  return getSessionSortTime(right, sortKey) - getSessionSortTime(left, sortKey)
}

function getProjectSortTime(project: ProjectEntry, sortKey: 'updated' | 'created'): number {
  const value = sortKey === 'created' ? project.createdAt : project.updatedAt || project.createdAt
  return new Date(value).getTime()
}

export function compareProjectsBySortKey(
  left: ProjectEntry,
  right: ProjectEntry,
  sortKey: ProjectSortKey
): number {
  if (sortKey === 'name') {
    return left.name.localeCompare(right.name) || left.path.localeCompare(right.path)
  }
  const byTime = getProjectSortTime(right, sortKey) - getProjectSortTime(left, sortKey)
  return byTime || left.name.localeCompare(right.name) || left.path.localeCompare(right.path)
}
