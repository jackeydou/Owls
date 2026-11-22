/**
 * The browser host: an Electron utility process that runs worker scripts with Playwright
 * against Owlto's own browser tabs, reached through the main process's CDP gate. It lives
 * outside the main process so a script that hangs or crashes only takes this process down.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core'
import type { BrowserHostReply, BrowserHostRequest } from './protocol.js'
import { runBrowserCode } from './run-code.js'
import { runRestrictedBrowserCode } from './sandbox.js'

const PAGE_IDLE_MS = 30 * 60_000

/** One worker: its connection to the gate, its page, and its queue of scripts. */
type Slot = {
  browser: Promise<Browser> | null
  page: Page | null
  used: number
  queue: Promise<unknown>
}

const slots = new Map<string, Slot>()
let shotSeq = 0

function connect(slot: Slot, endpoint: string): Promise<Browser> {
  slot.browser ??= chromium.connectOverCDP(endpoint).then(
    (browser) => {
      browser.on('disconnected', () => {
        slot.browser = null
        slot.page = null
      })
      return browser
    },
    (error: unknown) => {
      slot.browser = null
      throw error
    }
  )
  return slot.browser
}

async function pageFor(
  slot: Slot,
  endpoint: string
): Promise<{ page: Page; context: BrowserContext }> {
  const browser = await connect(slot, endpoint)
  const context = browser.contexts()[0]
  if (!context) throw new Error('Owlto’s browser is not ready. Try again.')
  if (!slot.page || slot.page.isClosed())
    slot.page = context.pages()[0] ?? (await context.newPage())
  return { page: slot.page, context }
}

async function run(slot: Slot, request: BrowserHostRequest): Promise<BrowserHostReply> {
  try {
    const { page, context } = await pageFor(slot, request.endpoint)
    const runCode = request.mode === 'full' ? runBrowserCode : runRestrictedBrowserCode
    const outcome = await runCode(
      request.code,
      { page, context },
      request.timeoutMs,
      async (bytes) => {
        await mkdir(request.shotsDir, { recursive: true })
        shotSeq += 1
        const path = join(request.shotsDir, `${Date.now()}-${shotSeq}.png`)
        await writeFile(path, bytes)
        return path
      }
    )
    return { type: 'result', id: request.id, ...outcome }
  } catch (error) {
    return {
      type: 'result',
      id: request.id,
      ok: false,
      text: error instanceof Error ? error.message : String(error)
    }
  }
}

/** Runs one worker's scripts in order, so two calls never race on the same page. */
function enqueue(request: BrowserHostRequest): void {
  let slot = slots.get(request.key)
  if (!slot) {
    slot = { browser: null, page: null, used: Date.now(), queue: Promise.resolve() }
    slots.set(request.key, slot)
  }
  const current = slot
  current.used = Date.now()
  const next = current.queue.then(() => run(current, request))
  current.queue = next.catch(() => {})
  void next.then((reply) => {
    current.used = Date.now()
    process.parentPort.postMessage(reply)
  })
}

/** Closes a worker's page, which closes its tab in the panel, and drops its connection. */
async function release(key: string): Promise<void> {
  const slot = slots.get(key)
  slots.delete(key)
  if (slot?.page && !slot.page.isClosed()) await slot.page.close().catch(() => {})
  const browser = await slot?.browser?.catch(() => null)
  await browser?.close().catch(() => {})
}

setInterval(() => {
  const now = Date.now()
  for (const [key, slot] of slots) if (now - slot.used > PAGE_IDLE_MS) void release(key)
}, 60_000).unref()

process.parentPort.on('message', (event) => {
  const request = event.data as BrowserHostRequest
  if (request.type === 'run') enqueue(request)
})
