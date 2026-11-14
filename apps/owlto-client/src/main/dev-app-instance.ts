import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { app } from 'electron'
import type { DevAppInstanceInfo } from '../shared/dev-app-instance.js'
import { parseDevNameArg } from '../shared/startup-args.js'

declare const __OWLTO_DEV__: boolean

let cachedDevAppInstance: DevAppInstanceInfo | null | undefined

function isDevRuntime(): boolean {
  return typeof __OWLTO_DEV__ !== 'undefined' && __OWLTO_DEV__
}

function hashPath(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

function safePathSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function profilePathSegment(value: string, id: string): string {
  return safePathSegment(value) || `dev-${id.slice(0, 6)}`
}

function profileDirectoryName(label: string, worktreeId: string, name: string | null): string {
  const profileId = name ? hashPath(name) : worktreeId
  return `${profilePathSegment(label, profileId)}-${profileId}`
}

function findRepoRoot(startPath: string): string | null {
  let current = resolve(startPath)
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(current, 'pnpm-workspace.yaml')) || existsSync(join(current, '.git'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}

function codexWorktreeLabel(worktreeRoot: string): string | null {
  const parts = worktreeRoot.split(sep)
  const worktreesIndex = parts.lastIndexOf('worktrees')
  if (worktreesIndex >= 1 && parts[worktreesIndex - 1] === '.codex' && parts[worktreesIndex + 1]) {
    return parts[worktreesIndex + 1]
  }
  return null
}

function codexWorktreeRoot(worktreeRoot: string): string | null {
  const parts = worktreeRoot.split(sep)
  const worktreesIndex = parts.lastIndexOf('worktrees')
  if (worktreesIndex >= 1 && parts[worktreesIndex - 1] === '.codex' && parts[worktreesIndex + 1]) {
    return parts.slice(0, worktreesIndex + 2).join(sep) || sep
  }
  return null
}

function compactHomePath(value: string): string {
  const home = homedir()
  if (value === home) return '~'
  if (value.startsWith(`${home}${sep}`)) {
    return `~${sep}${value.slice(home.length + 1)}`
  }
  return value
}

function localCheckoutLabel(worktreeRoot: string, id: string): string {
  const repoName = basename(worktreeRoot)
  const parentName = basename(dirname(worktreeRoot))
  if (repoName === 'owlto_client' && parentName === 'Projects') {
    return 'main'
  }
  if (repoName === 'owlto_client' && parentName) {
    return parentName
  }
  return repoName || `dev-${id.slice(0, 6)}`
}

function devInstanceDisplayPath(worktreeRoot: string): string {
  return compactHomePath(codexWorktreeRoot(worktreeRoot) ?? worktreeRoot)
}

function defaultDevName(worktreeRoot: string, fallbackLabel: string): string {
  const repoName = basename(worktreeRoot)
  if (repoName && fallbackLabel && repoName !== fallbackLabel) {
    return `${repoName} (${fallbackLabel})`
  }
  return repoName || fallbackLabel
}

function readDevName(): string | null {
  return parseDevNameArg(process.argv)?.value ?? null
}

function createDevAppInstanceInfo(): DevAppInstanceInfo | null {
  if (!isDevRuntime()) return null

  const startPath = resolve(process.cwd())
  const worktreeRoot = findRepoRoot(startPath) ?? resolve(startPath, '..', '..')
  const id = hashPath(worktreeRoot)
  const explicitName = readDevName()
  const fallbackLabel = codexWorktreeLabel(worktreeRoot) ?? localCheckoutLabel(worktreeRoot, id)
  const name = explicitName ?? defaultDevName(worktreeRoot, fallbackLabel)
  const label = explicitName ?? fallbackLabel
  const displayPath = explicitName ?? devInstanceDisplayPath(worktreeRoot)
  const userDataPath = join(
    app.getPath('appData'),
    'Owlto Dev',
    profileDirectoryName(label, id, explicitName)
  )

  return {
    kind: 'dev',
    label,
    name,
    displayPath,
    worktreeRoot,
    userDataPath
  }
}

export function getDevAppInstanceInfo(): DevAppInstanceInfo | null {
  if (cachedDevAppInstance !== undefined) return cachedDevAppInstance
  cachedDevAppInstance = createDevAppInstanceInfo()
  return cachedDevAppInstance
}

export function configureDevAppInstanceProfile(): DevAppInstanceInfo | null {
  const instance = getDevAppInstanceInfo()
  if (instance) {
    app.setPath('userData', instance.userDataPath)
  }
  return instance
}
