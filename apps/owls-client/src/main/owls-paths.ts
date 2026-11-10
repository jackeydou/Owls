import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { app } from 'electron'
import { parseDataRootArg } from '../shared/startup-args.js'

const STORE_FILENAME = 'owls-settings.json'
const BOOTSTRAP_FILENAME = 'owls-bootstrap.json'

export function defaultDataRoot(): string {
  return join(homedir(), '.owls')
}

/**
 * Worker worktrees for the default data root. They hold the user's code, so
 * they live in a folder Finder shows (not under the hidden `~/.owls`) and
 * outside `~/Documents`, which iCloud may sync.
 */
export function defaultWorktreesRoot(): string {
  return join(homedir(), 'Owls', 'worktrees')
}

/**
 * Where Router workers get their own git worktrees, one directory per
 * repository (RFC 11.1). A custom data root keeps its worktrees inside it, so
 * isolated profiles never share worktrees with the normal app.
 */
export function workerWorktreesRoot(dataRoot = getDataRoot()): string {
  return resolve(dataRoot) === resolve(defaultDataRoot())
    ? defaultWorktreesRoot()
    : join(dataRoot, 'worktrees')
}

/**
 * Where projects cloned from GitHub or made with Quick start go by default:
 * next to the worker worktrees for the default data root, inside a custom
 * data root otherwise.
 */
export function projectsHome(dataRoot = getDataRoot()): string {
  return resolve(dataRoot) === resolve(defaultDataRoot())
    ? join(homedir(), 'Owls', 'projects')
    : join(dataRoot, 'projects')
}

/** The working directory of Router engines in threads with no default project. */
export function routerThreadHome(dataRoot = getDataRoot()): string {
  return join(dataRoot, 'router-threads')
}

/** The empty working directory Dreaming runs in; it has no project to read. */
export function memoryDreamingHome(dataRoot = getDataRoot()): string {
  return join(dataRoot, 'memory-dreaming')
}

export function defaultWorkspaceRoot(): string {
  return join(homedir(), 'Documents', 'Owls')
}

function bootstrapPath(): string {
  return join(app.getPath('userData'), BOOTSTRAP_FILENAME)
}

function dataRootBootstrapMirrorPath(): string {
  return join(defaultDataRoot(), BOOTSTRAP_FILENAME)
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

function isUnsafePersistentDataRoot(dataRoot: string): boolean {
  const tempRoot = tmpdir()
  try {
    const realTempRoot = realpathSync(tempRoot)
    return isPathInside(tempRoot, dataRoot) || isPathInside(realTempRoot, dataRoot)
  } catch {
    return isPathInside(tempRoot, dataRoot)
  }
}

function readBootstrapDataRoot(path: string): string | null {
  try {
    if (!existsSync(path)) {
      return null
    }
    const raw = readFileSync(path, 'utf8')
    const j = JSON.parse(raw) as { dataRoot?: string }
    if (j.dataRoot && typeof j.dataRoot === 'string' && j.dataRoot.trim()) {
      const dataRoot = resolveOwlsPath(j.dataRoot.trim())
      if (isUnsafePersistentDataRoot(dataRoot)) {
        return null
      }
      return dataRoot
    }
  } catch {
    // ignore
  }
  return null
}

function readPersistedDataRoot(): string | null {
  return (
    readBootstrapDataRoot(bootstrapPath()) ?? readBootstrapDataRoot(dataRootBootstrapMirrorPath())
  )
}

function readArgvDataRoot(): string | null {
  const parsed = parseDataRootArg(process.argv)
  if (!parsed) return null
  return resolveOwlsPath(parsed.value)
}

export function resolveOwlsPath(input: string): string {
  const t = input.trim()
  if (!t) {
    throw new Error('Path is empty')
  }
  let p = t
  if (p.startsWith('~/')) {
    p = join(homedir(), p.slice(2))
  } else if (p === '~') {
    p = homedir()
  }
  if (!isAbsolute(p)) {
    throw new Error('Path must be absolute or use ~ for home')
  }
  return normalize(p)
}

/** Resolved absolute path where Owls keeps config and persistent app data. */
export function getDataRoot(): string {
  const fromArgv = readArgvDataRoot()
  if (fromArgv) {
    return fromArgv
  }
  const fromBootstrap = readPersistedDataRoot()
  if (fromBootstrap) {
    return fromBootstrap
  }
  return defaultDataRoot()
}

export function ensureBootstrapDir(): void {
  mkdirSync(dirname(bootstrapPath()), { recursive: true })
}

function writeBootstrapFile(path: string, dataRoot: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ dataRoot }, null, 2)}\n`, 'utf8')
}

function syncDataRootBootstrapMirror(dataRoot: string): void {
  const mirrorPath = dataRootBootstrapMirrorPath()
  if (normalize(mirrorPath) === normalize(bootstrapPath())) {
    return
  }

  if (dataRoot === defaultDataRoot()) {
    rmSync(mirrorPath, { force: true })
    return
  }

  if (isUnsafePersistentDataRoot(dataRoot)) {
    return
  }

  writeBootstrapFile(mirrorPath, dataRoot)
}

export function writeBootstrapDataRoot(absPath: string): void {
  const dataRoot = resolveOwlsPath(absPath)
  ensureBootstrapDir()
  writeBootstrapFile(bootstrapPath(), dataRoot)
  syncDataRootBootstrapMirror(dataRoot)
}

/** Persist the normal data root in the app profile without saving one-off startup overrides. */
export function writeBootstrapIfMissing(): void {
  if (parseDataRootArg(process.argv)) {
    return
  }

  const profileRoot = readBootstrapDataRoot(bootstrapPath())
  if (profileRoot) {
    syncDataRootBootstrapMirror(profileRoot)
    return
  }

  if (!existsSync(bootstrapPath()) || profileRoot === null) {
    const root = readPersistedDataRoot() ?? defaultDataRoot()
    writeBootstrapDataRoot(root)
  }
}

export function storeFilePath(root: string): string {
  return join(root, STORE_FILENAME)
}

function migrateSettingsFile(oldRoot: string, newRoot: string): void {
  const src = storeFilePath(oldRoot)
  const dst = storeFilePath(newRoot)
  if (existsSync(src) && !existsSync(dst)) {
    copyFileSync(src, dst)
  }
}

/**
 * Move config to a new root (bootstrap + migrate store file), then restart the app.
 * IPC returns `{ restarting: true }` before exit (restart is deferred one microtask).
 */
export function applyNewDataRoot(absoluteOrTilde: string): 'restarting' | 'unchanged' {
  const newRoot = resolveOwlsPath(absoluteOrTilde)
  if (isUnsafePersistentDataRoot(newRoot)) {
    throw new Error('Temporary folders cannot be saved as the Owls data root')
  }
  const oldRoot = getDataRoot()
  if (newRoot === oldRoot) {
    return 'unchanged'
  }
  mkdirSync(newRoot, { recursive: true })
  migrateSettingsFile(oldRoot, newRoot)
  writeBootstrapDataRoot(newRoot)
  queueMicrotask(() => {
    app.relaunch()
    app.exit(0)
  })
  return 'restarting'
}
