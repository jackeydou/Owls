import { existsSync, realpathSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Project } from '../../shared/app.js'
import { isWithin, normalizePath, type WorkspaceFolder } from '../../shared/workspace.js'
import { OwltoError } from './errors.js'

/** The workspace folder with symlinks resolved, as project paths are; as given when it is missing. */
export function realWorkspace(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * The workspace's top-level folders, by name. Hidden folders are left out; a
 * workspace that does not exist yet has none.
 */
export async function listWorkspaceFolders(
  workspace: string,
  projects: readonly Project[],
  dismissed: readonly string[]
): Promise<WorkspaceFolder[]> {
  const root = realWorkspace(workspace)
  let entries: { name: string; isDirectory(): boolean }[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e): WorkspaceFolder => {
      const path = join(root, e.name)
      return {
        name: e.name,
        path,
        git: existsSync(join(path, '.git')),
        projectId: projects.find((p) => p.path === path)?.id ?? null,
        dismissed: dismissed.includes(path)
      }
    })
  return folders.sort((a, b) => a.name.localeCompare(b.name))
}

/** A path the renderer named as a workspace folder, checked to be a direct child of the workspace. */
export async function workspaceChild(workspace: string, path: string): Promise<string> {
  const root = realWorkspace(workspace)
  let real: string
  try {
    real = realpathSync(path)
  } catch {
    throw new OwltoError('project_required', 'This folder no longer exists.')
  }
  if (dirname(real) !== root || !(await stat(real)).isDirectory())
    throw new OwltoError('project_required', 'Choose a folder directly inside the workspace.')
  return real
}

/** True for a project inside the workspace, which can be merged back into it. */
export function isWorkspaceProject(workspace: string, project: Project): boolean {
  const root = realWorkspace(workspace)
  return normalizePath(project.path) !== normalizePath(root) && isWithin(project.path, root)
}
