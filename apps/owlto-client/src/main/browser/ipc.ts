import { mkdirSync } from 'node:fs'
import { dialog, shell } from 'electron'
import type { AppSettings } from '../../shared/app.js'
import {
  browserAnswerSchema,
  browserBoundsSchema,
  browserHistorySchema,
  browserNavigateSchema,
  browserTabIdSchema
} from '../../shared/browser-panel.js'
import type { IpcHandle } from '../app/ipc.js'
import type { BrowserManager } from './manager.js'

export type BrowserIpcDeps = {
  settings: () => AppSettings
  save: (settings: AppSettings) => AppSettings
  /** The downloads folder in use: the saved choice, or Owlto's default. */
  downloadsRoot: () => string
}

/** The `browser-*` channels behind `window.owlto.browser`. */
export function registerBrowserIpc(
  handle: IpcHandle,
  browser: BrowserManager,
  deps: BrowserIpcDeps
): void {
  handle('browser-snapshot', () => browser.snapshot())
  handle('browser-activate', (input) => browser.activate(browserTabIdSchema.parse(input)))
  handle('browser-close', (input) => browser.closeTabById(browserTabIdSchema.parse(input)))
  handle('browser-new-tab', () => browser.newUserTab())
  handle('browser-navigate', (input) => {
    const { tabId, url } = browserNavigateSchema.parse(input)
    browser.navigate(tabId, url)
  })
  handle('browser-history', (input) => {
    const { tabId, action } = browserHistorySchema.parse(input)
    browser.history(tabId, action)
  })
  handle('browser-take-over', (input) => browser.takeOver(browserTabIdSchema.parse(input)))
  handle('browser-hand-back', (input) => browser.handBack(browserTabIdSchema.parse(input)))
  handle('browser-bounds', (input) => browser.setBounds(browserBoundsSchema.parse(input)))
  handle('browser-answer', (input) => {
    const { tabId, askId, answer } = browserAnswerSchema.parse(input)
    const ask = browser.pendingAsk(tabId, askId)
    if (!ask) return null
    let saved: AppSettings | null = null
    // The rule is saved before the ask settles, so the request it lets through already sees it.
    if (answer === 'always') {
      const settings = deps.settings()
      const sites = settings.browser.sites.filter((site) => site.host !== ask.host)
      saved = deps.save({
        ...settings,
        browser: { ...settings.browser, sites: [...sites, { host: ask.host, rule: 'allow' }] }
      })
    }
    browser.answer(tabId, askId, answer === 'block' ? 'block' : 'allow')
    return saved
  })
  handle('browser-clear-sign-ins', () => browser.clearSignIns())
  handle('browser-downloads-folder', () => deps.downloadsRoot())
  handle('browser-pick-downloads', async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: deps.downloadsRoot(),
      properties: ['openDirectory', 'createDirectory']
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    deps.save({ ...deps.settings(), browserDownloadsPath: path })
    return path
  })
  handle('browser-reveal-downloads', async () => {
    const root = deps.downloadsRoot()
    mkdirSync(root, { recursive: true })
    const failure = await shell.openPath(root)
    if (failure) throw new Error(failure)
  })
}
