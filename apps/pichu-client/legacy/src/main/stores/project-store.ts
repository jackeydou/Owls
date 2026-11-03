import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ProjectEntry } from '../../shared/projects.js'
import { defaultWorkspaceRoot, resolvePichuPath } from '../pichu-paths.js'
import { getStoredSetting, setStoredSetting } from './settings-store.js'

const PROJECTS_SETTING_KEY = 'projects'
const SCRATCH_PROJECT_BASENAME = 'Untitled Project'

function projectNameForPath(path: string): string {
  return basename(path) || path
}

function isProjectEntry(value: unknown): value is ProjectEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.path === 'string' &&
    typeof item.name === 'string' &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  )
}

function readProjects(): ProjectEntry[] {
  const raw = getStoredSetting(PROJECTS_SETTING_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isProjectEntry).map((project) => ({
      ...project,
      path: resolvePichuPath(project.path),
      name: project.name.trim() || projectNameForPath(project.path),
      pinned: project.pinned === true,
      pinnedOrder: typeof project.pinnedOrder === 'number' ? project.pinnedOrder : 0
    }))
  } catch {
    return []
  }
}

function writeProjects(projects: ProjectEntry[]): void {
  setStoredSetting(PROJECTS_SETTING_KEY, JSON.stringify(projects))
}

function sortProjects(projects: ProjectEntry[]): ProjectEntry[] {
  return [...projects].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
    if (left.pinned && right.pinned) {
      const byPinnedOrder = (right.pinnedOrder ?? 0) - (left.pinnedOrder ?? 0)
      if (byPinnedOrder) return byPinnedOrder
    }
    const byUpdatedAt = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    return byUpdatedAt || left.name.localeCompare(right.name) || left.path.localeCompare(right.path)
  })
}

function assertDirectory(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Project folder does not exist: ${path}`)
  }
  if (!statSync(path).isDirectory()) {
    throw new Error(`Project path is not a folder: ${path}`)
  }
}

export function listProjects(): ProjectEntry[] {
  return sortProjects(readProjects())
}

export function getProjectByPath(path: string | undefined): ProjectEntry | null {
  const normalizedPath = path?.trim() ? resolvePichuPath(path) : ''
  if (!normalizedPath) return null
  return readProjects().find((project) => project.path === normalizedPath) ?? null
}

export function upsertProject(path: string): ProjectEntry {
  const normalizedPath = resolvePichuPath(path)
  assertDirectory(normalizedPath)

  const projects = readProjects()
  const existing = projects.find((project) => project.path === normalizedPath)
  const now = new Date().toISOString()
  const nextProject: ProjectEntry = existing
    ? {
        ...existing,
        name: existing.name.trim() || projectNameForPath(normalizedPath),
        updatedAt: now
      }
    : {
        path: normalizedPath,
        name: projectNameForPath(normalizedPath),
        createdAt: now,
        updatedAt: now
      }

  writeProjects([nextProject, ...projects.filter((project) => project.path !== normalizedPath)])
  return nextProject
}

export function touchProject(path: string): ProjectEntry | null {
  const normalizedPath = resolvePichuPath(path)
  const projects = readProjects()
  const existing = projects.find((project) => project.path === normalizedPath)
  if (!existing) return null

  const nextProject = {
    ...existing,
    updatedAt: new Date().toISOString()
  }
  writeProjects([nextProject, ...projects.filter((project) => project.path !== normalizedPath)])
  return nextProject
}

export function setProjectPinned(path: string, pinned: boolean): ProjectEntry {
  const normalizedPath = resolvePichuPath(path)
  const projects = readProjects()
  const existing = projects.find((project) => project.path === normalizedPath)
  if (!existing) {
    throw new Error(`Unknown project: ${normalizedPath}`)
  }

  const nextPinnedOrder = pinned
    ? Math.max(0, ...projects.map((project) => project.pinnedOrder ?? 0)) + 1
    : 0
  const nextProject = {
    ...existing,
    pinned,
    pinnedOrder: nextPinnedOrder,
    updatedAt: new Date().toISOString()
  }
  writeProjects([nextProject, ...projects.filter((project) => project.path !== normalizedPath)])
  return nextProject
}

export function renameProject(path: string, name: string): ProjectEntry {
  const normalizedPath = resolvePichuPath(path)
  const nextName = name.trim()
  if (!nextName) {
    throw new Error('Project name is required')
  }

  const projects = readProjects()
  const existing = projects.find((project) => project.path === normalizedPath)
  if (!existing) {
    throw new Error(`Unknown project: ${normalizedPath}`)
  }

  const nextProject = {
    ...existing,
    name: nextName,
    updatedAt: new Date().toISOString()
  }
  writeProjects([nextProject, ...projects.filter((project) => project.path !== normalizedPath)])
  return nextProject
}

export function removeProject(path: string): { removed: boolean } {
  const normalizedPath = resolvePichuPath(path)
  const projects = readProjects()
  const nextProjects = projects.filter((project) => project.path !== normalizedPath)
  writeProjects(nextProjects)
  return { removed: nextProjects.length !== projects.length }
}

export function createScratchProject(path: string): ProjectEntry {
  const normalizedPath = resolvePichuPath(path)
  mkdirSync(normalizedPath, { recursive: true })
  return upsertProject(normalizedPath)
}

export function defaultScratchProjectPath(): string {
  const root = defaultWorkspaceRoot()
  mkdirSync(root, { recursive: true })

  for (let index = 0; index < 100; index += 1) {
    const name = index === 0 ? SCRATCH_PROJECT_BASENAME : `${SCRATCH_PROJECT_BASENAME} ${index + 1}`
    const candidate = join(root, name)
    if (!existsSync(candidate)) return candidate
  }

  return join(root, `${SCRATCH_PROJECT_BASENAME} ${Date.now()}`)
}
