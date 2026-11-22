/**
 * Site rules for worker tabs (Settings → Browser): blocks a worker from sites the user
 * blocked, and makes it wait for the user before it opens an "ask" site or posts a form on a
 * site the user is signed in to. Only main-frame requests of tabs a worker drives are checked;
 * the user's own browsing is never held up.
 */
import type { OnBeforeRequestListenerDetails, Session } from 'electron'
import { type BrowserAsk, type BrowserSettings, siteRuleFor } from '../../shared/browser-panel.js'

/** "Always allow" is saved as a site rule before the ask settles, so here it reads as allow. */
export type AskAnswer = 'allow' | 'block'

export type SitePolicyDeps = {
  settings: () => BrowserSettings
  /** The worker tab behind a request, while its worker drives it; null for anything else. */
  workerTab: (webContentsId: number) => { tabId: string; key: string } | null
  /** Shows the ask on the tab and resolves with the user's answer. */
  ask: (tabId: string, ask: Omit<BrowserAsk, 'id'>) => Promise<AskAnswer>
  /** Whether the session holds cookies for the URL, which is how a sign-in shows. */
  signedIn: (url: string) => Promise<boolean>
}

export class SitePolicy {
  /** Hosts a worker may open after the user allowed them once, by worker key. */
  private readonly allowedOnce = new Map<string, Set<string>>()

  constructor(private readonly deps: SitePolicyDeps) {}

  install(session: Session): void {
    session.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'], types: ['mainFrame'] },
      (details, callback) => {
        void this.decide(details).then(
          (allowed) => callback({ cancel: !allowed }),
          () => callback({ cancel: true })
        )
      }
    )
  }

  forgetWorker(key: string): void {
    this.allowedOnce.delete(key)
  }

  private async decide(details: OnBeforeRequestListenerDetails): Promise<boolean> {
    const tab =
      details.webContentsId === undefined ? null : this.deps.workerTab(details.webContentsId)
    if (!tab) return true
    let host: string
    try {
      host = new URL(details.url).host.toLowerCase()
    } catch {
      return false
    }
    const settings = this.deps.settings()
    const rule = siteRuleFor(settings.sites, host)
    if (rule === 'block') return false
    const allowed = this.allowedOnce.get(tab.key) ?? new Set<string>()
    if (rule === 'ask' && !allowed.has(host)) {
      if (!(await this.asked(tab, 'open', host))) return false
      allowed.add(host)
      this.allowedOnce.set(tab.key, allowed)
    }
    // A site the user listed as allowed posts without asking.
    if (details.method === 'POST' && settings.askBeforeSubmit && rule !== 'allow') {
      if ((await this.deps.signedIn(details.url)) && !(await this.asked(tab, 'submit', host)))
        return false
    }
    return true
  }

  private async asked(
    tab: { tabId: string },
    kind: BrowserAsk['kind'],
    host: string
  ): Promise<boolean> {
    return (await this.deps.ask(tab.tabId, { kind, host })) === 'allow'
  }
}
