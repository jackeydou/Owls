import { create } from 'zustand'
import type { Reply } from '../../../shared/app'
import type { BrowserBounds, BrowserSnapshot } from '../../../shared/browser-panel'
import { UIError, uiFailure } from '../app/failures'
import { useRouterStore } from '../router/store'

/** The browser's tabs as main last reported them; main owns the tabs and their pages. */
export const useBrowserStore = create<BrowserSnapshot>(() => ({ tabs: [], activeId: null }))

/** Follows main's tabs for as long as the shell is mounted. */
export function watchBrowser(): () => void {
  void window.owlto.browser.snapshot().then((reply) => {
    if (reply.ok) useBrowserStore.setState(reply.value)
  })
  return window.owlto.browser.onChanged((snapshot) => useBrowserStore.setState(snapshot))
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
  /** Bounds are sent often while dragging; a failure here has nothing to tell the user. */
  setBounds: (bounds: BrowserBounds) =>
    void api()
      .setBounds(bounds)
      .catch(() => {})
}
