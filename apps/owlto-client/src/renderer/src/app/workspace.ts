import { create } from 'zustand'
import type { Project, Reply } from '../../../shared/app'
import type { WorkspaceListing } from '../../../shared/workspace'
import { UIError, uiFailure } from './failures'
import { useAppStore } from './store'

type WorkspaceState = {
  /** The workspace's real path and folders; null until the first read finishes. */
  listing: WorkspaceListing | null
  /** Reads the workspace folder again. */
  refresh(): Promise<void>
  /** Makes a top-level folder its own project; resolves to whether that worked. */
  promote(path: string): Promise<boolean>
  /** Stops offering to make a repository a project. */
  dismiss(path: string): Promise<boolean>
  /** Forgets a project inside the workspace; resolves to whether that worked. */
  mergeBack(projectId: string): Promise<boolean>
}

const byName = (a: Project, b: Project) =>
  a.name.localeCompare(b.name) || a.path.localeCompare(b.path)

/** Runs a call, showing its failure on the app's error line; undefined when it failed. */
async function run<T>(fn: () => Promise<Reply<T>>): Promise<{ value: T } | undefined> {
  try {
    useAppStore.setState({ error: null })
    const reply = await fn()
    if (!reply.ok) throw new UIError(reply.error)
    return { value: reply.value }
  } catch (error) {
    useAppStore.setState({ error: uiFailure(error) })
    return undefined
  }
}

let reads = 0

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  listing: null,
  refresh: async () => {
    const read = ++reads
    try {
      const reply = await window.owlto.workspaceListing()
      // A slower, older read must not replace a newer one.
      if (reply.ok && read === reads) set({ listing: reply.value })
    } catch {
      // The Workspace still shows without its folders.
    }
  },
  promote: async (path) => {
    const result = await run(() => window.owlto.promoteWorkspaceFolder(path))
    if (!result) return false
    const project = result.value
    useAppStore.setState((state) => ({
      projects: [...state.projects.filter((p) => p.id !== project.id), project].sort(byName)
    }))
    await get().refresh()
    return true
  },
  dismiss: async (path) => {
    const result = await run(() => window.owlto.dismissWorkspaceFolder(path))
    if (!result) return false
    useAppStore.setState({ settings: result.value })
    await get().refresh()
    return true
  },
  mergeBack: async (projectId) => {
    const result = await run(() => window.owlto.mergeIntoWorkspace(projectId))
    if (!result) return false
    useAppStore.setState((state) => ({
      projects: state.projects.filter((p) => p.id !== projectId),
      routerProjectId: state.routerProjectId === projectId ? null : state.routerProjectId,
      settingsProject:
        state.settingsProject?.projectId === projectId ? null : state.settingsProject,
      settingsTab: state.settingsProject?.projectId === projectId ? 'workspace' : state.settingsTab
    }))
    await get().refresh()
    return true
  }
}))
