import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { app } from 'electron'
import { parseDataRootArg } from '../shared/startup-args.js'

const STORE_FILENAME = 'pichu-settings.json'
const BOOTSTRAP_FILENAME = 'pichu-bootstrap.json'
const LEGACY_STORE_FILENAME = 'pix-settings.json'
const LEGACY_BOOTSTRAP_FILENAME = 'pix-bootstrap.json'
const LEGACY_DATABASE_FILENAME = 'pix.db'

export function defaultDataRoot(): string {
  return join(homedir(), '.pichu')
}

function legacyDefaultDataRoot(): string {
  return join(homedir(), '.pix')
}

export function defaultWorkspaceRoot(): string {
  return join(homedir(), 'Documents', 'Pichu')
}

function bootstrapPath(): string {
  return join(app.getPath('userData'), BOOTSTRAP_FILENAME)
}

function dataRootBootstrapMirrorPath(): string {
  return join(defaultDataRoot(), BOOTSTRAP_FILENAME)
}

function legacyProductBootstrapPath(): string {
  return join(legacyDefaultDataRoot(), LEGACY_BOOTSTRAP_FILENAME)
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
      const dataRoot = resolvePichuPath(j.dataRoot.trim())
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
    readBootstrapDataRoot(bootstrapPath()) ??
    readBootstrapDataRoot(dataRootBootstrapMirrorPath()) ??
    readBootstrapDataRoot(legacyProductBootstrapPath())
  )
}

function readArgvDataRoot(): string | null {
  const parsed = parseDataRootArg(process.argv)
  if (!parsed) return null
  return resolvePichuPath(parsed.value)
}

export function resolvePichuPath(input: string): string {
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
  const dataRoot = resolvePichuPath(absPath)
  ensureBootstrapDir()
  writeBootstrapFile(bootstrapPath(), dataRoot)
  syncDataRootBootstrapMirror(dataRoot)
}

function migrateLegacyFileName(root: string, legacyName: string, currentName: string): void {
  const legacyPath = join(root, legacyName)
  const currentPath = join(root, currentName)
  if (existsSync(legacyPath) && !existsSync(currentPath)) {
    renameSync(legacyPath, currentPath)
  }
}

function migrateLegacyDataRootFiles(root: string): void {
  migrateLegacyFileName(root, LEGACY_STORE_FILENAME, STORE_FILENAME)
  migrateLegacyFileName(root, LEGACY_BOOTSTRAP_FILENAME, BOOTSTRAP_FILENAME)
  for (const suffix of ['', '-wal', '-shm']) {
    migrateLegacyFileName(root, `${LEGACY_DATABASE_FILENAME}${suffix}`, `pichu.db${suffix}`)
  }
}

export function migrateLegacyDataRoot(
  legacyRoot = legacyDefaultDataRoot(),
  currentRoot = defaultDataRoot()
): void {
  if (normalize(legacyRoot) === normalize(currentRoot)) return
  if (!existsSync(currentRoot) && existsSync(legacyRoot)) {
    cpSync(legacyRoot, currentRoot, { recursive: true, errorOnExist: true })
  }
  if (existsSync(currentRoot)) {
    migrateLegacyDataRootFiles(currentRoot)
  }
}

export function ensureDataRootDir(): void {
  const dataRoot = getDataRoot()
  if (normalize(dataRoot) === normalize(defaultDataRoot())) {
    migrateLegacyDataRoot()
  }
  mkdirSync(dataRoot, { recursive: true })
  migrateLegacyDataRootFiles(dataRoot)
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
  const newRoot = resolvePichuPath(absoluteOrTilde)
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
