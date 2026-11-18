/**
 * The browser host: an Electron utility process that owns one Chrome window
 * through Playwright and runs worker scripts against it. It lives outside the
 * main process so a script that hangs or crashes only takes this process down,
 * and outside every agent's sandbox so pages load with the user's network.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type BrowserContext, chromium, type Page } from 'playwright-core'
import type { BrowserHostReply, BrowserHostRequest } from './protocol.js'
import { runBrowserCode } from './run-code.js'

/** Installed browsers Playwright can drive without a download, most preferred first. */
const CHANNELS = ['chrome', 'msedge'] as const
const PAGE_IDLE_MS = 30 * 60_000
const CONTEXT_IDLE_MS = 10 * 60_000

type Slot = { page: Page | null; used: number; queue: Promise<unknown> }

let context: Promise<BrowserContext> | null = null
let contextUsed = Date.now()
const slots = new Map<string, Slot>()
let shotSeq = 0

function launch(profileDir: string): Promise<BrowserContext> {
  context ??= (async () => {
    await mkdir(profileDir, { recursive: true })
    const failures: string[] = []
    for (const channel of CHANNELS) {
      try {
        const opened = await chromium.launchPersistentContext(profileDir, {
          channel,
          headless: false,
          viewport: null
        })
        // The user closed the window, or Chrome quit: the next run opens a new one.
        opened.on('close', () => {
          context = null
          for (const slot of slots.values()) slot.page = null
        })
        return opened
      } catch (error) {
        failures.push(
          `${channel}: ${error instanceof Error ? error.message.split('\n')[0] : error}`
        )
      }
    }
    context = null
    throw new Error(
      `Owlto could not open Google Chrome or Microsoft Edge. Install Google Chrome and try again. (${failures.join('; ')})`
    )
  })()
  return context
}

async function pageFor(key: string, opened: BrowserContext): Promise<Page> {
  const slot = slots.get(key)
  if (slot?.page && !slot.page.isClosed()) return slot.page
  const page = await opened.newPage()
  if (slot) slot.page = page
  return page
}

async function run(request: BrowserHostRequest): Promise<BrowserHostReply> {
  try {
    const opened = await launch(request.profileDir)
    contextUsed = Date.now()
    const page = await pageFor(request.key, opened)
    const outcome = await runBrowserCode(
      request.code,
      { page, context: opened },
      request.timeoutMs,
      async (bytes) => {
        await mkdir(request.shotsDir, { recursive: true })
        shotSeq += 1
        const path = join(request.shotsDir, `${Date.now()}-${shotSeq}.png`)
        await writeFile(path, bytes)
        return path
      }
    )
    contextUsed = Date.now()
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
    slot = { page: null, used: Date.now(), queue: Promise.resolve() }
    slots.set(request.key, slot)
  }
  slot.used = Date.now()
  const next = slot.queue.then(() => run(request))
  slot.queue = next.catch(() => {})
  void next.then((reply) => process.parentPort.postMessage(reply))
}

async function release(key: string): Promise<void> {
  const slot = slots.get(key)
  slots.delete(key)
  if (slot?.page && !slot.page.isClosed()) await slot.page.close().catch(() => {})
}

// Closes pages a worker left behind, then the window once nothing uses it.
setInterval(() => {
  const now = Date.now()
  for (const [key, slot] of slots) if (now - slot.used > PAGE_IDLE_MS) void release(key)
  if (context && !slots.size && now - contextUsed > CONTEXT_IDLE_MS) {
    const closing = context
    context = null
    void closing.then((opened) => opened.close()).catch(() => {})
  }
}, 60_000).unref()

process.parentPort.on('message', (event) => {
  const request = event.data as BrowserHostRequest
  if (request.type === 'run') enqueue(request)
})
