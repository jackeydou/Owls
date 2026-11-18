import { z } from 'zod'
import type { ReportToolResult } from '../router/report.js'
import { asyncWorkerTool, type WorkerTool } from '../router/worker-tools.js'
import {
  BROWSER_DEFAULT_TIMEOUT_MS,
  BROWSER_MAX_TIMEOUT_MS,
  BROWSER_RESULT_LIMIT
} from './run-code.js'

/** Runs worker scripts in Owlto's browser; the Electron app backs it with a utility process. */
export interface WorkerBrowser {
  /** `key` names the caller's tab: runs with the same key share one page. */
  run(key: string, code: string, timeoutMs: number): Promise<ReportToolResult>
}

export const BROWSER_TOOL_NAME = 'browser'

export const BROWSER_TOOL_DESCRIPTION = `Drive a real Chrome window by running a Playwright script. Write the body of an async JavaScript function; it runs in Owlto, outside your sandbox, with the user's network. In scope: \`page\` (your own Playwright Page; it stays open between calls, so you can navigate once and keep working), \`context\` (the BrowserContext of Owlto's Chrome profile, shared with other workers; sign-ins persist), and \`console\` (its output comes back to you). There is no require or import. \`return\` a JSON-serializable value, such as text or a list of links, and keep it small: the reply is cut at ${BROWSER_RESULT_LIMIT} characters. Returning the bytes of \`await page.screenshot()\` saves a PNG and returns its path; open that file with your own file or image viewer to see the page. Example: \`await page.goto('http://localhost:3000'); await page.getByRole('button', { name: 'Save' }).click(); return await page.locator('.toast').innerText()\`. Prefer a CLI, API, or plain HTTP fetch when one answers the question; use this for rendered pages, logins, forms, and checking a running app.`

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
export function browserTool(browser: WorkerBrowser, key: string): WorkerTool {
  return asyncWorkerTool(BROWSER_TOOL_NAME, BROWSER_TOOL_DESCRIPTION, browserInputSchema, (input) =>
    browser.run(key, input.code, input.timeoutMs ?? BROWSER_DEFAULT_TIMEOUT_MS)
  )
}
