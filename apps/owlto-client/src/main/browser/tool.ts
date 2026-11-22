import { z } from 'zod'
import type { ReportToolResult } from '../router/report.js'
import { asyncWorkerTool, type WorkerTool } from '../router/worker-tools.js'
import type { BrowserRunMode } from './protocol.js'
import {
  BROWSER_DEFAULT_TIMEOUT_MS,
  BROWSER_MAX_TIMEOUT_MS,
  BROWSER_RESULT_LIMIT
} from './run-code.js'

/** Runs worker scripts against Owlto's browser tabs; the Electron app backs it with a utility process. */
export interface WorkerBrowser {
  /** `key` names the caller's tab: runs with the same key share one page. */
  run(key: string, code: string, timeoutMs: number, mode: BrowserRunMode): Promise<ReportToolResult>
}

export const BROWSER_TOOL_NAME = 'browser'

export const BROWSER_TOOL_DESCRIPTION = `Drive a real browser tab by running a Playwright script. The tab opens in Owlto's Browser panel, where the user can watch, and take over to sign in or solve a check before handing it back to you. Write the body of an async JavaScript function; it runs in Owlto, outside your sandbox, with the user's network. In scope: \`page\` (your own Playwright Page; it stays open between calls, so you can navigate once and keep working), \`context\` (a BrowserContext holding only your tabs; sign-ins persist and are shared with other workers), and \`console\` (its output comes back to you). There is no require, import, or Node API. \`return\` a JSON-serializable value, such as text or a list of links, and keep it small: the reply is cut at ${BROWSER_RESULT_LIMIT} characters. Returning the bytes of \`await page.screenshot()\` saves a PNG and returns its path; open that file with your own file or image viewer to see the page. Example: \`await page.goto('http://localhost:3000'); await page.getByRole('button', { name: 'Save' }).click(); return await page.locator('.toast').innerText()\`. While the user holds your tab, a call waits for them to hand it back. Never type the user's passwords; when a page asks for a sign-in, say so in your reply so the user can sign in in the panel. Unless you have full access, the script cannot read or write local files: options such as \`path\`, file uploads, saving downloads, and traces are refused, and \`setTimeout\` is the only timer. Prefer a CLI, API, or plain HTTP fetch when one answers the question; use this for rendered pages, logins, forms, and checking a running app.`

const browserInputSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(100_000)
    .describe('The body of an async function, using page and context.'),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(BROWSER_MAX_TIMEOUT_MS)
    .optional()
    .describe(
      `How long the script may run, in milliseconds. Default ${BROWSER_DEFAULT_TIMEOUT_MS}.`
    )
})

/** The browser tool for one worker; `key` keeps that worker on its own tab. */
export function browserTool(browser: WorkerBrowser, key: string, mode: BrowserRunMode): WorkerTool {
  return asyncWorkerTool(BROWSER_TOOL_NAME, BROWSER_TOOL_DESCRIPTION, browserInputSchema, (input) =>
    browser.run(key, input.code, input.timeoutMs ?? BROWSER_DEFAULT_TIMEOUT_MS, mode)
  )
}
