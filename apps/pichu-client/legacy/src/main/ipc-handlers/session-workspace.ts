import {
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  type Stats
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const MAX_SESSION_DIRECTORY_ATTEMPTS = 100
const MAX_SESSION_DIRECTORY_NAME_LENGTH = 80
const MAX_SESSION_DIRECTORY_ENTRIES = 1_000
const SKIPPED_SESSION_FILE_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out'
])
const SKIPPED_SESSION_FILE_NAMES = new Set(['.ds_store'])

export type SessionFileEntry = {
  path: string
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: string
}

function generateSessionId(): string {
  return crypto.randomUUID()
}

function formatSessionDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function slugifySessionDirectoryName(text?: string): string {
  return (
    text
      ?.toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.slice(0, 6)
      .join('-')
      .slice(0, MAX_SESSION_DIRECTORY_NAME_LENGTH) || 'new-chat'
  )
}

export function createSessionWorkspace(
  cwd: string,
  prompt?: string
): {
  sessionId: string
  sessionCwd: string
  cronJobCwd: string
} {
  const datedCwd = join(cwd, formatSessionDate(new Date()))
  mkdirSync(datedCwd, { recursive: true })

  const baseName = slugifySessionDirectoryName(prompt)
  for (let attempt = 0; attempt < MAX_SESSION_DIRECTORY_ATTEMPTS; attempt += 1) {
    const sessionDirName = attempt === 0 ? baseName : `${baseName}-${attempt + 1}`
    const sessionCwd = join(datedCwd, sessionDirName)
    try {
      mkdirSync(sessionCwd, { recursive: false })
      return { sessionId: generateSessionId(), sessionCwd, cronJobCwd: datedCwd }
    } catch (error) {
      if (existsSync(sessionCwd)) {
        continue
      }
      throw error
    }
  }

  throw new Error('Unable to create a unique session workspace directory')
}

export function ensureSessionWorkingDirectory(cwd: string): string {
  mkdirSync(cwd, { recursive: true })
  return cwd
}

export function deleteSessionWorkingDirectory(cwd: string): void {
  rmSync(cwd, { recursive: true, force: true })
}

export function resolveSessionRuntimePaths(
  cwd: string,
  sessionId?: string
): {
  sessionCwd: string
  cronJobCwd: string
} {
  const legacySessionCwd = sessionId ? join(cwd, sessionId) : null
  if (legacySessionCwd && existsSync(legacySessionCwd)) {
    return {
      sessionCwd: ensureSessionWorkingDirectory(legacySessionCwd),
      cronJobCwd: cwd
    }
  }

  return {
    sessionCwd: ensureSessionWorkingDirectory(cwd),
    cronJobCwd: dirname(cwd)
  }
}

export function resolveSessionDirectory(entry: { cwd: string }, sessionId: string): string {
  return resolveSessionRuntimePaths(entry.cwd, sessionId).sessionCwd
}

export function assertWithinDirectory(rootDir: string, targetPath: string): void {
  const relativePath = relative(rootDir, targetPath)
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Path must stay within the session directory')
  }
}

function normalizeSessionDirectoryPath(directory?: string): string {
  return (directory ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

export function listSessionDirectory(sessionDir: string, directory?: string): SessionFileEntry[] {
  const relativeDirectory = normalizeSessionDirectoryPath(directory)
  const currentDir = relativeDirectory ? resolve(sessionDir, relativeDirectory) : sessionDir
  if (relativeDirectory) {
    assertWithinDirectory(sessionDir, currentDir)
  }

  let entries: Dirent[]
  try {
    entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  } catch (error) {
    console.warn('[pi-handler] failed to list session directory:', {
      directory: relativeDirectory || '.',
      errorCode: errorCode(error)
    })
    return []
  }

  const result: SessionFileEntry[] = []
  for (const entry of entries) {
    if (result.length >= MAX_SESSION_DIRECTORY_ENTRIES) break
    if (SKIPPED_SESSION_FILE_NAMES.has(entry.name.toLowerCase())) continue
    if (entry.isDirectory() && SKIPPED_SESSION_FILE_DIRECTORIES.has(entry.name)) continue

    const fullPath = join(currentDir, entry.name)
    let stats: Stats
    try {
      stats = lstatSync(fullPath)
    } catch {
      continue
    }
    if (stats.isSymbolicLink()) continue

    const relativePath = relative(sessionDir, fullPath).split('\\').join('/')
    const isDirectory = stats.isDirectory()

    result.push({
      path: relativePath,
      name: entry.name,
      isDirectory,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    })
  }

  return result
}
