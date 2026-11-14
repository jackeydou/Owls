import { create } from 'zustand'
import type { ProjectEntry } from '../../../preload/index.d'

type ProjectsState = {
  projects: ProjectEntry[]
  loaded: boolean
  error: string | null
  load: () => Promise<void>
  createFromScratch: () => Promise<ProjectEntry | null>
  addExistingFolder: () => Promise<ProjectEntry | null>
  touch: (path: string) => Promise<ProjectEntry | null>
  setPinned: (path: string, pinned: boolean) => Promise<void>
  rename: (path: string, name: string) => Promise<void>
  remove: (path: string) => Promise<void>
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

function upsertProject(projects: ProjectEntry[], project: ProjectEntry): ProjectEntry[] {
  return sortProjects([project, ...projects.filter((item) => item.path !== project.path)])
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  loaded: false,
  error: null,

  load: async () => {
    try {
      const projects = await window.api.projects.list()
      set({ projects: sortProjects(projects), loaded: true, error: null })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loaded: true })
    }
  },

  createFromScratch: async () => {
    try {
      const project = await window.api.projects.createFromScratch()
      if (project) {
        set((state) => ({ projects: upsertProject(state.projects, project), error: null }))
      }
      return project
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  addExistingFolder: async () => {
    try {
      const project = await window.api.projects.addExistingFolder()
      if (project) {
        set((state) => ({ projects: upsertProject(state.projects, project), error: null }))
      }
      return project
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  touch: async (path: string) => {
    try {
      const project = await window.api.projects.touch(path)
      if (project) {
        set((state) => ({ projects: upsertProject(state.projects, project), error: null }))
      }
      return project
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  setPinned: async (path: string, pinned: boolean) => {
    try {
      const project = await window.api.projects.setPinned(path, pinned)
      set((state) => ({ projects: upsertProject(state.projects, project), error: null }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  rename: async (path: string, name: string) => {
    try {
      const project = await window.api.projects.rename(path, name)
      set((state) => ({ projects: upsertProject(state.projects, project), error: null }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  remove: async (path: string) => {
    try {
      await window.api.projects.remove(path)
      set((state) => ({
        projects: state.projects.filter((project) => project.path !== path),
        error: null
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
}))
