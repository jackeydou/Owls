import {
  browserBoundsSchema,
  browserHistorySchema,
  browserNavigateSchema,
  browserTabIdSchema
} from '../../shared/browser-panel.js'
import type { IpcHandle } from '../app/ipc.js'
import type { BrowserManager } from './manager.js'

/** The `browser-*` channels behind `window.owlto.browser`. */
export function registerBrowserIpc(handle: IpcHandle, browser: BrowserManager): void {
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
}
