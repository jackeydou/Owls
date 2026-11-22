import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Reply } from '../../../shared/app'
import type {
  BrowserAnswer,
  BrowserBounds,
  BrowserSnapshot,
  BrowserTab
} from '../../../shared/browser-panel'
import { UIError, uiFailure } from '../app/failures'
import { useAppStore } from '../app/store'
import { useRouterStore } from '../router/store'

/** The browser's tabs as main last reported them; main owns the tabs and their pages. */
export const useBrowserStore = create<BrowserSnapshot>(() => ({ tabs: [], activeId: null }))

/** What a tab waits on the user for, as a key that changes with each new hand-off or ask. */
export function tabNeed(tab: BrowserTab): string | null {
  if (tab.ask) return `ask:${tab.ask.id}`
  if (tab.control.kind === 'handoff') return `handoff:${tab.control.reason}`
  return null
}

/**
 * The worker's browser tab, preferring one that waits on the user, or null when it has none.
 * `needsYou` is true while a hand-off or an ask waits.
 */
export function useWorkerTab(workerId: string): { tabId: string; needsYou: boolean } | null {
  const found = useBrowserStore(
    useShallow((s) => {
      const owned = s.tabs.filter(
        (tab) => tab.owner.kind === 'worker' && tab.owner.workerId === workerId
      )
      const tab = owned.find((x) => tabNeed(x)) ?? owned.at(-1)
      return { tabId: tab?.id ?? null, needsYou: Boolean(tab && tabNeed(tab)) }
    })
  )
  return found.tabId ? { tabId: found.tabId, needsYou: found.needsYou } : null
}

/** Opens the Browser panel on a tab, as when the user picks it from a worker. */
export function showBrowserTab(tabId: string): void {
  useAppStore.getState().showRightPanel('browser')
  void browserActions.activate(tabId)
}

/**
 * Follows main's tabs for as long as the shell is mounted. A tab that starts waiting on the
 * user opens the Browser panel, so a hand-off or an ask never sits out of sight.
 */
export function watchBrowser(): () => void {
  const apply = (snapshot: BrowserSnapshot) => {
    const before = new Set(useBrowserStore.getState().tabs.map(tabNeed).filter(Boolean))
    useBrowserStore.setState(snapshot)
    if (snapshot.tabs.some((tab) => tabNeed(tab) && !before.has(tabNeed(tab))))
      useAppStore.getState().showRightPanel('browser')
  }
  void window.owlto.browser.snapshot().then((reply) => {
    if (reply.ok) apply(reply.value)
  })
  return window.owlto.browser.onChanged(apply)
}

/** Runs a browser call; a failure shows in the shell's error toast. */
async function call<T>(run: () => Promise<Reply<T>>): Promise<T | undefined> {
  try {
    const reply = await run()
    if (!reply.ok) throw new UIError(reply.error)
    return reply.value
  } catch (error) {
    useRouterStore.setState({ error: uiFailure(error) })
    return undefined
  }
}

/** Like `call`, for a call with no value: resolves to whether it worked. */
async function ran(run: () => Promise<Reply<void>>): Promise<boolean> {
  try {
    const reply = await run()
    if (!reply.ok) throw new UIError(reply.error)
    return true
  } catch (error) {
    useRouterStore.setState({ error: uiFailure(error) })
    return false
  }
}

const api = () => window.owlto.browser

export const browserActions = {
  activate: (tabId: string) => call(() => api().activate(tabId)),
  close: (tabId: string) => call(() => api().close(tabId)),
  newTab: () => call(() => api().newTab()),
  navigate: (tabId: string, url: string) => call(() => api().navigate({ tabId, url })),
  history: (tabId: string, action: 'back' | 'forward' | 'reload') =>
    call(() => api().history({ tabId, action })),
  takeOver: (tabId: string) => call(() => api().takeOver(tabId)),
  handBack: (tabId: string) => call(() => api().handBack(tabId)),
  answer: async (input: BrowserAnswer) => {
    const saved = await call(() => api().answer(input))
    // "Always allow" saved a site rule; keep Settings in step so a later save keeps it.
    if (saved) useAppStore.setState({ settings: saved })
  },
  clearSignIns: () => ran(() => api().clearSignIns()),
  downloadsFolder: () => call(() => api().downloadsFolder()),
  pickDownloadsFolder: () => call(() => api().pickDownloadsFolder()),
  revealDownloadsFolder: () => ran(() => api().revealDownloadsFolder()),
  /** Bounds are sent often while dragging; a failure here has nothing to tell the user. */
  setBounds: (bounds: BrowserBounds) =>
    void api()
      .setBounds(bounds)
      .catch(() => {})
}
