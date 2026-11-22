import { z } from 'zod'
import type { AgentProvider } from './agents.js'
import type { Reply } from './app.js'

/**
 * The in-app browser: tabs main owns (one WebContentsView each) and the panel in the right
 * sidebar that shows them. See docs/RFC_OWLTO_IN_APP_BROWSER.md.
 */

/** Who opened a tab and keeps it: one worker, or the user's own tab. */
export type BrowserTabOwner =
  | { kind: 'worker'; workerId: string; provider: AgentProvider; title: string }
  | { kind: 'user' }

/**
 * Who has the controls right now. `agent`: the worker drives, the page ignores the user's
 * input until they take over. `user`: the user drives, and the worker's calls wait.
 * `handoff`: the worker asked the user to finish one step, such as a sign-in or a captcha.
 */
/** The last thing a worker did on its tab, for the panel's who-drives line. */
export type BrowserAction = { kind: 'open'; host: string } | { kind: 'click' } | { kind: 'type' }

export type BrowserControl =
  | { kind: 'agent'; action: BrowserAction | null }
  | { kind: 'user' }
  | { kind: 'handoff'; reason: string }

export type BrowserTab = {
  id: string
  owner: BrowserTabOwner
  url: string
  title: string
  secure: boolean
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  control: BrowserControl
}

/** Every tab, oldest first, and the one the panel shows. */
export type BrowserSnapshot = { tabs: BrowserTab[]; activeId: string | null }

export const browserTabIdSchema = z.string().min(1).max(64)
/**
 * Where the page area sits in the window, in CSS pixels; null while it is not on screen, such
 * as when the panel is closed or shows another tab.
 */
export const browserBoundsSchema = z
  .object({
    x: z.number().finite().min(0),
    y: z.number().finite().min(0),
    width: z.number().finite().min(0).max(20_000),
    height: z.number().finite().min(0).max(20_000)
  })
  .nullable()
export type BrowserBounds = z.infer<typeof browserBoundsSchema>
export const browserNavigateSchema = z.object({
  tabId: browserTabIdSchema,
  url: z.string().min(1).max(8_192)
})
export const browserHistorySchema = z.object({
  tabId: browserTabIdSchema,
  action: z.enum(['back', 'forward', 'reload'])
})

/** `window.owlto.browser`. */
export interface BrowserAPI {
  snapshot(): Promise<Reply<BrowserSnapshot>>
  activate(tabId: string): Promise<Reply<void>>
  close(tabId: string): Promise<Reply<void>>
  /** Opens a tab of the user's own, which workers never see. */
  newTab(): Promise<Reply<BrowserTab>>
  navigate(input: z.infer<typeof browserNavigateSchema>): Promise<Reply<void>>
  history(input: z.infer<typeof browserHistorySchema>): Promise<Reply<void>>
  /** Pauses the tab's worker and gives the page to the user. */
  takeOver(tabId: string): Promise<Reply<void>>
  /** Gives the page back to its worker, ending a take-over or a hand-off. */
  handBack(tabId: string): Promise<Reply<void>>
  /** Where to lay the active tab's page; null hides it. */
  setBounds(bounds: BrowserBounds): Promise<Reply<void>>
  onChanged(listener: (snapshot: BrowserSnapshot) => void): () => void
}
