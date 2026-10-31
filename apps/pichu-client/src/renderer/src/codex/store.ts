import { create } from 'zustand'
import type {
  CodexConnection,
  CodexEvent,
  CodexFailure,
  CodexProject,
  CodexReply,
  CodexSession,
  CodexSettings,
  RespondCodexRequest
} from '../../../shared/codex'
import { CodexUIError, uiFailure } from './failures'

function unwrap<T>(reply: CodexReply<T>): T {
  if (!reply.ok) throw new CodexUIError(reply.error)
  return reply.value
}
type State = {
  loaded: boolean
  error: CodexFailure | null
  sending: boolean
  view: 'chat' | 'settings'
  selectedId: string | null
  draftCwd: string | null
  sessions: CodexSession[]
  projects: CodexProject[]
  settings: CodexSettings
  connection: CodexConnection
  initialize(): Promise<void>
  event(event: CodexEvent): void
  select(id: string): void
  newTask(cwd?: string): void
  showSettings(): void
  clearError(): void
  pickProject(): Promise<void>
  connect(): Promise<void>
  selectExecutable(): Promise<void>
  saveSettings(settings: CodexSettings): Promise<void>
  send(text: string): Promise<boolean>
  interrupt(): Promise<void>
  respond(input: RespondCodexRequest): Promise<void>
  archive(id: string): Promise<void>
}
let connectionEvents = 0
export const useCodexStore = create<State>((set, get) => {
  async function action<T>(fn: () => Promise<CodexReply<T>>): Promise<T | undefined> {
    try {
      set({ error: null })
      return unwrap(await fn())
    } catch (error) {
      set({ error: uiFailure(error) })
      return undefined
    }
  }
  return {
    loaded: false,
    error: null,
    sending: false,
    view: 'chat',
    selectedId: null,
    draftCwd: null,
    sessions: [],
    projects: [],
    settings: {
      executablePath: null,
      model: null,
      effort: null,
      permission: 'workspace-write',
      theme: 'system',
      language: 'en'
    },
    connection: {
      status: 'disconnected',
      executablePath: null,
      version: null,
      account: { kind: 'signed-out' },
      models: [],
      error: null
    },
    initialize: async () => {
      const version = connectionEvents
      const snapshot = await action(() => window.codex.snapshot())
      if (!snapshot) {
        set({ loaded: true })
        return
      }
      set((state) => ({
        loaded: true,
        projects: snapshot.projects,
        settings: snapshot.settings,
        draftCwd: state.draftCwd ?? snapshot.projects[0]?.path ?? null,
        sessions: snapshot.sessions.map((s) => {
          const live = state.sessions.find((existing) => existing.id === s.id)
          return live && live.updatedAt >= s.updatedAt ? live : s
        }),
        connection: version === connectionEvents ? snapshot.connection : state.connection
      }))
    },
    event: (event) => {
      if (event.type === 'connection') {
        connectionEvents++
        set({ connection: event.connection })
        return
      }
      if (event.type === 'removed') {
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== event.sessionId),
          selectedId: state.selectedId === event.sessionId ? null : state.selectedId
        }))
        return
      }
      set((state) => ({
        sessions: [event.session, ...state.sessions.filter((s) => s.id !== event.session.id)].sort(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt)
        )
      }))
    },
    select: (id) => set({ selectedId: id, view: 'chat', error: null }),
    newTask: (cwd) =>
      set({ selectedId: null, view: 'chat', error: null, draftCwd: cwd ?? get().draftCwd }),
    showSettings: () => set({ view: 'settings', error: null }),
    clearError: () => set({ error: null }),
    pickProject: async () => {
      const project = await action(() => window.codex.pickProject())
      if (project)
        set((state) => ({
          projects: [...state.projects.filter((p) => p.id !== project.id), project].sort((a, b) =>
            a.name.localeCompare(b.name)
          ),
          draftCwd: project.path,
          selectedId: null,
          view: 'chat'
        }))
    },
    connect: async () => {
      const connection = await action(() => window.codex.connect())
      if (connection) set({ connection })
    },
    selectExecutable: async () => {
      const connection = await action(() => window.codex.selectExecutable())
      if (connection) {
        set({ connection })
        await get().initialize()
      }
    },
    saveSettings: async (settings) => {
      const saved = await action(() =>
        window.codex.saveSettings({
          model: settings.model,
          effort: settings.effort,
          permission: settings.permission,
          theme: settings.theme,
          language: settings.language
        })
      )
      if (saved) set({ settings: saved })
    },
    send: async (text) => {
      if (get().sending) return false
      set({ sending: true, error: null })
      try {
        let sessionId = get().selectedId
        if (!sessionId) {
          const cwd = get().draftCwd
          if (!cwd) return false
          const { model, effort, permission } = get().settings
          const session = unwrap(
            await window.codex.createSession({ cwd, model, effort, permission })
          )
          get().event({ type: 'session', session })
          set({ selectedId: session.id })
          sessionId = session.id
        }
        unwrap(await window.codex.send({ sessionId, commandId: crypto.randomUUID(), text }))
        return true
      } catch (error) {
        set({ error: uiFailure(error) })
        return false
      } finally {
        set({ sending: false })
      }
    },
    interrupt: async () => {
      const id = get().selectedId
      if (id) await action(() => window.codex.interrupt(id))
    },
    respond: async (input) => {
      await action(() => window.codex.respond(input))
    },
    archive: async (id) => {
      await action(() => window.codex.archive(id))
    }
  }
})
