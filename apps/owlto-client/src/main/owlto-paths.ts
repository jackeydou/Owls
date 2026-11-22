import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { app } from 'electron'
import { parseDataRootArg } from '../shared/startup-args.js'
import { isDebugPackage } from './build-flavor.js'

const BOOTSTRAP_FILENAME = 'owlto-bootstrap.json'

/** The released app's data root. Folders Finder shows sit next to it only for this root. */
function mainDataRoot(): string {
  return join(homedir(), '.owlto')
}

/**
 * A debug package installs as its own app ("Owlto Debug"), so it keeps all of its data,
 * worktrees, projects, and notes inside its own root and never touches the released app's.
 */
export function defaultDataRoot(): string {
  return isDebugPackage() ? join(homedir(), '.owlto-debug') : mainDataRoot()
}

function isMainDataRoot(dataRoot: string): boolean {
  return resolve(dataRoot) === resolve(mainDataRoot())
}

/**
 * Worker worktrees for the default data root. They hold the user's code, so
 * they live in a folder Finder shows (not under the hidden `~/.owlto`) and
 * outside `~/Documents`, which iCloud may sync.
 */
export function defaultWorktreesRoot(): string {
  return join(homedir(), 'Owlto', 'worktrees')
}

/**
 * Where Router workers get their own git worktrees, one directory per
 * repository (RFC 11.1). A custom data root keeps its worktrees inside it, so
 * isolated profiles never share worktrees with the normal app.
 */
export function workerWorktreesRoot(dataRoot = getDataRoot()): string {
  return isMainDataRoot(dataRoot) ? defaultWorktreesRoot() : join(dataRoot, 'worktrees')
}

/**
 * Where projects cloned from GitHub or made with Quick start go by default:
 * next to the worker worktrees for the default data root, inside a custom
 * data root otherwise.
 */
export function projectsHome(dataRoot = getDataRoot()): string {
  return isMainDataRoot(dataRoot)
    ? join(homedir(), 'Owlto', 'projects')
    : join(dataRoot, 'projects')
}

/**
 * Where workers run tasks that belong to no project, unless the user picked
 * another folder: next to the projects for the default data root, inside a
 * custom data root otherwise.
 */
export function workspaceHome(dataRoot = getDataRoot()): string {
  return isMainDataRoot(dataRoot)
    ? join(homedir(), 'Owlto', 'Workspace')
    : join(dataRoot, 'workspace')
}

/**
 * Where notes live, one Markdown file each: next to the workspace for the
 * default data root, so other editors and git can use them, inside a custom
 * data root otherwise.
 */
export function notesHome(dataRoot = getDataRoot()): string {
  return isMainDataRoot(dataRoot) ? join(homedir(), 'Owlto', 'Notes') : join(dataRoot, 'notes')
}

/** The working directory of Router engines in threads with no default project. */
export function routerThreadHome(dataRoot = getDataRoot()): string {
  return join(dataRoot, 'router-threads')
}

/** Where files the user attaches to worker messages are kept. */
export function attachmentsHome(dataRoot = getDataRoot()): string {
  return join(dataRoot, 'attachments')
}

/** Owlto's browser: its session (sign-ins), downloads, and the screenshots scripts return. */
export function browserHome(dataRoot = getDataRoot()): string {
  return join(dataRoot, 'browser')
}

/** The empty working directory Dreaming runs in; it has no project to read. */
export function memoryDreamingHome(dataRoot = getDataRoot()): string {
  return join(dataRoot, 'memory-dreaming')
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
      const dataRoot = resolveOwltoPath(j.dataRoot.trim())
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
  return resolveOwltoPath(parsed.value)
}

export function resolveOwltoPath(input: string): string {
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

/** Resolved absolute path where Owlto keeps config and persistent app data. */
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

/** The anonymous analytics install id; only release builds with analytics write it. */
export function analyticsIdentityPath(root: string): string {
  return join(root, 'analytics.json')
}
