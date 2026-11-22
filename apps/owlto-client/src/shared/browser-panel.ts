import { z } from 'zod'
import type { AgentProvider } from './agents.js'
import type { AppSettings, Reply } from './app.js'

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

/** Something a worker's tab waits on the user for, under a site rule. */
export type BrowserAsk = {
  id: string
  /** `open`: first visit to an "ask" site. `submit`: a form post on a site the user is signed in to. */
  kind: 'open' | 'submit'
  host: string
}

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
  ask: BrowserAsk | null
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

/** What a worker may do on a site: browse freely, ask the user first, or never open it. */
export const browserSiteRuleSchema = z.enum(['allow', 'ask', 'block'])
export type BrowserSiteRule = z.infer<typeof browserSiteRuleSchema>
/** A host such as `example.com`; it also covers its subdomains. */
export const browserHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d+)?$/)
export const browserSiteSchema = z.object({ host: browserHostSchema, rule: browserSiteRuleSchema })
export type BrowserSite = z.infer<typeof browserSiteSchema>
/** Settings → Browser. Added later, so older rows get the defaults. */
export const browserSettingsSchema = z.object({
  sites: z.array(browserSiteSchema).max(500).catch([]).default([]),
  /** Ask before a worker posts a form on a site the user is signed in to. */
  askBeforeSubmit: z.boolean().catch(true).default(true)
})
export type BrowserSettings = z.infer<typeof browserSettingsSchema>
export const defaultBrowserSettings: BrowserSettings = { sites: [], askBeforeSubmit: true }

/** The rule for a host: the most specific listed site that covers it, or null when none does. */
export function siteRuleFor(sites: BrowserSite[], host: string): BrowserSiteRule | null {
  const bare = host.toLowerCase().replace(/:\d+$/, '')
  let best: BrowserSite | null = null
  for (const site of sites) {
    const listed = site.host.replace(/:\d+$/, '')
    const covers =
      site.host === host.toLowerCase() || bare === listed || bare.endsWith(`.${listed}`)
    if (covers && (!best || site.host.length > best.host.length)) best = site
  }
  return best?.rule ?? null
}

/** What the user typed for a site: a URL or a host, reduced to the host. */
export function siteHost(input: string): string | null {
  const text = input.trim().toLowerCase()
  if (!text) return null
  try {
    const host = new URL(/^[a-z]+:\/\//.test(text) ? text : `https://${text}`).host
    return browserHostSchema.safeParse(host).success ? host : null
  } catch {
    return null
  }
}

export const browserAnswerSchema = z.object({
  tabId: browserTabIdSchema,
  askId: z.string().min(1).max(64),
  answer: z.enum(['allow', 'always', 'block'])
})
export type BrowserAnswer = z.infer<typeof browserAnswerSchema>

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
  /**
   * Answers a tab's ask: allow it once, always allow the site, or block it. "Always" saves a
   * site rule and returns the saved settings; the other answers return null.
   */
  answer(input: BrowserAnswer): Promise<Reply<AppSettings | null>>
  /** Signs out of every site in Owlto's browser by clearing its cookies and storage. */
  clearSignIns(): Promise<Reply<void>>
  /** Where downloads go: the chosen folder, or Owlto's default. */
  downloadsFolder(): Promise<Reply<string>>
  /** Picks a new downloads folder; null when the user cancels. */
  pickDownloadsFolder(): Promise<Reply<string | null>>
  revealDownloadsFolder(): Promise<Reply<void>>
  onChanged(listener: (snapshot: BrowserSnapshot) => void): () => void
}
