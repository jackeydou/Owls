import { create } from 'zustand'
import type { BrowserTab } from '../../../shared/browser-panel'

/**
 * Prototype state for the in-app browser panel. The real panel would mirror tabs that
 * main owns (one WebContentsView each) through `window.owlto.browser` events; here the
 * actions only change local state so the design can be clicked through.
 */
type BrowserState = {
  tabs: BrowserTab[]
  activeId: string | null
  activate(id: string): void
  close(id: string): void
  takeOver(id: string): void
  handBack(id: string): void
}

const DEMO_TABS: BrowserTab[] = [
  {
    id: 'tab-codex',
    owner: { kind: 'worker', workerId: 'w-codex', provider: 'codex', title: 'Check settings page' },
    url: 'http://localhost:5173/settings',
    title: 'Taskboard · Settings',
    secure: false,
    loading: false,
    canGoBack: true,
    canGoForward: false,
    control: { kind: 'agent', action: 'Click "Save changes"' }
  },
  {
    id: 'tab-cursor',
    owner: {
      kind: 'worker',
      workerId: 'w-cursor',
      provider: 'cursor',
      title: 'Pull billing export'
    },
    url: 'https://accounts.example.com/sign-in',
    title: 'Sign in · Example',
    secure: true,
    loading: false,
    canGoBack: true,
    canGoForward: false,
    control: { kind: 'handoff', reason: 'Sign in to accounts.example.com, then hand it back.' }
  },
  {
    id: 'tab-user',
    owner: { kind: 'user' },
    url: 'https://docs.example.dev/api/webhooks',
    title: 'Webhooks · Example Docs',
    secure: true,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    control: { kind: 'user' }
  }
]

const setControl = (tabs: BrowserTab[], id: string, control: BrowserTab['control']) =>
  tabs.map((tab) => (tab.id === id ? { ...tab, control } : tab))

// Only debug builds show the prototype, so release builds never ship demo pages.
const demo = __OWLTO_BUILD_MODE__ === 'debug'

export const useBrowserStore = create<BrowserState>((set) => ({
  tabs: demo ? DEMO_TABS : [],
  activeId: demo ? 'tab-codex' : null,
  activate: (activeId) => set({ activeId }),
  close: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id)
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      const activeId =
        state.activeId === id
          ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
          : state.activeId
      return { tabs, activeId }
    }),
  takeOver: (id) => set((state) => ({ tabs: setControl(state.tabs, id, { kind: 'user' }) })),
  handBack: (id) =>
    set((state) => ({ tabs: setControl(state.tabs, id, { kind: 'agent', action: null }) }))
}))
