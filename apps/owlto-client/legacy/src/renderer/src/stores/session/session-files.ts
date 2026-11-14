import type { FileTreeEntry } from '../../../../preload/index.d'

export function normalizeSessionFileDirectory(directory?: string): string {
  return (directory ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
}

function sessionFileParentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function directChildPathForDirectory(path: string, directory: string): string | null {
  if (!directory) {
    const [segment] = path.split('/')
    return segment || null
  }

  if (!path.startsWith(`${directory}/`)) return null
  const rest = path.slice(directory.length + 1)
  const [segment] = rest.split('/')
  return segment ? `${directory}/${segment}` : null
}

export function mergeSessionDirectoryEntries(
  current: FileTreeEntry[],
  directory: string,
  entries: FileTreeEntry[]
): FileTreeEntry[] {
  const normalizedDirectory = normalizeSessionFileDirectory(directory)
  const directEntryPaths = new Set(entries.map((entry) => entry.path))
  const directDirectoryPaths = new Set(
    entries.filter((entry) => entry.isDirectory).map((entry) => entry.path)
  )
  const remaining = current.filter((entry) => {
    if (directEntryPaths.has(entry.path)) return false
    if (sessionFileParentPath(entry.path) === normalizedDirectory) return false

    const directChildPath = directChildPathForDirectory(entry.path, normalizedDirectory)
    if (!directChildPath) return true
    return directDirectoryPaths.has(directChildPath)
  })
  const byPath = new Map<string, FileTreeEntry>()

  for (const entry of remaining) {
    byPath.set(entry.path, entry)
  }
  for (const entry of entries) {
    byPath.set(entry.path, entry)
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}
