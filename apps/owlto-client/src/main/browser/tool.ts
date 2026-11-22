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
  /** Hands the caller's tab to the user for one step and waits for it to come back. */
  handoff(key: string, reason: string, timeoutMs: number): Promise<ReportToolResult>
}

export const BROWSER_TOOL_NAME = 'browser'

export const BROWSER_TOOL_DESCRIPTION = `Drive a real browser tab by running a Playwright script. The tab opens in Owlto's Browser panel, where the user can watch, and take over to sign in or solve a check before handing it back to you. Write the body of an async JavaScript function; it runs in Owlto, outside your sandbox, with the user's network. In scope: \`page\` (your own Playwright Page; it stays open between calls, so you can navigate once and keep working), \`context\` (a BrowserContext holding only your tabs; sign-ins persist and are shared with other workers), and \`console\` (its output comes back to you). There is no require, import, or Node API. \`return\` a JSON-serializable value, such as text or a list of links, and keep it small: the reply is cut at ${BROWSER_RESULT_LIMIT} characters. Files the page downloads are saved in a folder of your own, and the next call lists their paths. Returning the bytes of \`await page.screenshot()\` saves a PNG and returns its path; open that file with your own file or image viewer to see the page. Example: \`await page.goto('http://localhost:3000'); await page.getByRole('button', { name: 'Save' }).click(); return await page.locator('.toast').innerText()\`. While the user holds your tab, a call waits for them to hand it back. Never type the user's passwords; when a page needs a sign-in, a captcha, or a payment, call \`browser_handoff\` so the user does that step in the panel. Some sites ask the user before you open them or submit a form there, and a site they blocked fails to load. Unless you have full access, the script cannot read or write local files: options such as \`path\`, file uploads, saving downloads, and traces are refused, and \`setTimeout\` is the only timer. Prefer a CLI, API, or plain HTTP fetch when one answers the question; use this for rendered pages, logins, forms, and checking a running app.`

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

export const BROWSER_HANDOFF_TOOL_NAME = 'browser_handoff'
export const BROWSER_HANDOFF_DEFAULT_TIMEOUT_MS = 15 * 60_000
export const BROWSER_HANDOFF_MAX_TIMEOUT_MS = 60 * 60_000

export const BROWSER_HANDOFF_TOOL_DESCRIPTION = `Hand your browser tab to the user for one step only they should do, such as signing in, solving a captcha, approving a payment, or choosing something personal. Open the page with \`browser\` first. The tab shows your reason in Owlto's Browser panel and Owlto notifies the user; this call waits until they hand the tab back, close it, or the time runs out, then returns where the tab ended up. Keep the reason to one short sentence the user can act on, such as "Sign in to GitHub so I can read the private repo." Then carry on with \`browser\`.`

const handoffInputSchema = z.object({
  reason: z
    .string()
    .min(1)
    .max(300)
    .describe('One short sentence telling the user what to do in the tab.'),
  timeoutMs: z
    .number()
    .int()
    .min(10_000)
    .max(BROWSER_HANDOFF_MAX_TIMEOUT_MS)
    .optional()
    .describe(
      `How long to wait for the user, in milliseconds. Default ${BROWSER_HANDOFF_DEFAULT_TIMEOUT_MS}.`
    )
})

/** The browser tool for one worker; `key` keeps that worker on its own tab. */
export function browserTool(browser: WorkerBrowser, key: string, mode: BrowserRunMode): WorkerTool {
  return asyncWorkerTool(BROWSER_TOOL_NAME, BROWSER_TOOL_DESCRIPTION, browserInputSchema, (input) =>
    browser.run(key, input.code, input.timeoutMs ?? BROWSER_DEFAULT_TIMEOUT_MS, mode)
  )
}

/** The hand-off tool for one worker, beside its browser tool. */
export function browserHandoffTool(browser: WorkerBrowser, key: string): WorkerTool {
  return asyncWorkerTool(
    BROWSER_HANDOFF_TOOL_NAME,
    BROWSER_HANDOFF_TOOL_DESCRIPTION,
    handoffInputSchema,
    (input) =>
      browser.handoff(
        key,
        input.reason.replace(/\s+/g, ' ').trim(),
        input.timeoutMs ?? BROWSER_HANDOFF_DEFAULT_TIMEOUT_MS
      )
  )
}
