import type { AgentProvider } from './agents'

/**
 * The in-app browser panel's model, as main would send it to the renderer.
 * See docs/RFC_OWLTO_IN_APP_BROWSER.md. The prototype fills it with demo tabs.
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
export type BrowserControl =
  | { kind: 'agent'; action: string | null }
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
