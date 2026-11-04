// Simulation primitives for the Router M4 benchmark (RFC 17): a virtual clock,
// a seeded workload, the model latency and token meter, and the scripted policy
// that stands in for the model. Nothing here knows which architecture runs it.
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai'

export const SECOND = 1000
export const MINUTE = 60 * SECOND

/**
 * Discrete-event clock. Everything the benchmark waits on goes through it, so a
 * simulated hour runs in seconds and the same seed gives the same result.
 * Before each event the real event loop is drained, so promise chains started
 * by the previous event settle at the simulated time they belong to.
 */
export class Clock {
  now = 0
  #queue = []
  #count = 0

  at(time, fn) {
    this.#queue.push({ time: Math.max(time, this.now), n: this.#count++, fn })
  }
  after(ms, fn) {
    this.at(this.now + ms, fn)
  }
  sleep(ms) {
    return new Promise((resolve) => this.after(ms, resolve))
  }
  async run(limitMs) {
    while (true) {
      await drain()
      if (!this.#queue.length) return
      this.#queue.sort((a, b) => a.time - b.time || a.n - b.n)
      const next = this.#queue.shift()
      if (next.time > limitMs) throw new Error(`Simulation passed ${limitMs / MINUTE} minutes`)
      this.now = next.time
      next.fn()
    }
  }
}
async function drain() {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve))
}

/** 2026-01-01T00:00:00Z: the simulated wall clock starts here. */
const EPOCH = Date.UTC(2026, 0, 1)

/**
 * Points Date, performance.now, crypto.randomUUID, and Math.random at the clock
 * and the seed for one run (pi records tool durations with performance.now), so IDs, timestamps, and queue order repeat exactly. Returns a
 * function that restores the real globals.
 */
export function simulateGlobals(clock, seed) {
  const RealDate = globalThis.Date
  const realUuid = globalThis.crypto.randomUUID
  const realRandom = Math.random
  const realPerformanceNow = globalThis.performance.now
  class SimDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args)
      else super(EPOCH + clock.now)
    }
    static now() {
      return EPOCH + clock.now
    }
  }
  const rand = rng(seed ^ 0x5eed)
  let ids = 0
  globalThis.Date = SimDate
  globalThis.crypto.randomUUID = () => {
    // Owls IDs keep the first 8 characters (w_…, b_…), so the counter goes there.
    const hex = (++ids).toString(16).padStart(8, '0')
    return `${hex}-0000-4000-8000-000000000000`
  }
  Math.random = rand
  globalThis.performance.now = () => clock.now
  return () => {
    globalThis.performance.now = realPerformanceNow
    globalThis.Date = RealDate
    globalThis.crypto.randomUUID = realUuid
    Math.random = realRandom
  }
}

/** Caps concurrent work on the virtual clock; waiters start in arrival order. */
export class Slots {
  #free
  #waiting = []
  constructor(size) {
    this.#free = size
  }
  async take() {
    if (this.#free > 0) {
      this.#free--
      return
    }
    await new Promise((resolve) => this.#waiting.push(resolve))
  }
  release() {
    const next = this.#waiting.shift()
    if (next) next()
    else this.#free++
  }
}

/** mulberry32: small, fast, and identical on every platform. */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS =
  'build test review deploy config cache parser router worker queue schema index token session layout render settings migration release update plugin search history profile account sync merge branch commit lint format docs bundle startup memory latency timeout retry error path'.split(
    ' '
  )
function filler(rand, chars) {
  const words = []
  let length = 0
  while (length < chars) {
    const word = WORDS[Math.floor(rand() * WORDS.length)]
    words.push(word)
    length += word.length + 1
  }
  return words.join(' ')
}
function lognormal(rand, median, sigma) {
  const u = Math.max(rand(), 1e-9)
  const v = rand()
  return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v))
}
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const between = (rand, min, max) => min + rand() * (max - min)

/**
 * The §7.1 workload of the DeepSeek article, at its 1/4 time scale: about 300
 * messages in an hour, about 20 of them work requests. Each work request may
 * get follow-ups (review comments, CI results) after its result is visible.
 * Chatter needs a reply but no work.
 */
export function workload(seed, options = {}) {
  const rand = rng(seed)
  const span = options.spanMs ?? 60 * MINUTE
  const chatter = Array.from({ length: options.chatter ?? 260 }, (_, i) => ({
    id: `C${i + 1}`,
    at: Math.round(rand() * span),
    text: filler(rand, between(rand, 60, 360))
  }))
  const work = Array.from({ length: options.work ?? 20 }, (_, i) => {
    const id = `R${i + 1}`
    const count = rand() < 0.3 ? 0 : rand() < 0.57 ? 1 : 2
    return {
      id,
      at: Math.round(rand() * span * 0.75),
      workMs: Math.round(clamp(lognormal(rand, 6 * MINUTE, 0.5), 2 * MINUTE, 18 * MINUTE)),
      text: filler(rand, between(rand, 120, 400)),
      summary: filler(rand, between(rand, 240, 480)),
      followUps: Array.from({ length: count }, (_, k) => ({
        id: `F${i + 1}.${k + 1}`,
        parent: id,
        delayMs: Math.round(between(rand, 1, 5) * MINUTE),
        workMs: Math.round(between(rand, 1, 4) * MINUTE),
        text: filler(rand, between(rand, 80, 240)),
        summary: filler(rand, between(rand, 160, 360))
      }))
    }
  })
  chatter.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  work.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  const followUps = new Map(work.flatMap((w) => w.followUps.map((f) => [f.id, f])))
  const units = new Map([...work.map((w) => [w.id, w]), ...followUps])
  return { chatter, work, followUps, units }
}

/**
 * Model cost assumptions, shared by every architecture. The base matches the
 * article's 2.5 s for a one-event Router request; prefill and decode rates are
 * typical hosted-model figures. Tokens are estimated as JSON characters / 4.
 */
export const LATENCY = { baseMs: 1800, inputTokenMs: 0.06, outputTokenMs: 1000 / 60 }

const tokens = (text) => Math.ceil(text.length / 4)

/** Counts requests, tokens, and the cached prefix for one model session. */
export class Meter {
  requests = 0
  input = 0
  cached = 0
  output = 0
  busyMs = 0
  maxPrompt = 0
  #previous = null

  /** Tokens of the system prompt and tool declarations in the last request. */
  fixed = 0

  /**
   * `overhead(fixed)` is context the engine adds outside Owls' control (RFC 4.3),
   * given the request's own fixed context. It is a stable prefix, so it counts
   * as cached after the first request.
   */
  measure(context, message, overheadFn = () => 0) {
    const parts = [
      JSON.stringify({ systemPrompt: context.systemPrompt ?? '', tools: context.tools ?? [] }),
      ...context.messages.map((m) => JSON.stringify(m))
    ]
    let shared = 0
    if (this.#previous)
      while (shared < parts.length && parts[shared] === this.#previous[shared]) shared++
    this.#previous = parts
    this.fixed = tokens(parts[0])
    const overhead = overheadFn(this.fixed)
    const prompt = tokens(parts.join('')) + overhead
    const cached =
      tokens(parts.slice(0, shared).join('')) + (this.requests > 0 || shared > 0 ? overhead : 0)
    const output = tokens(
      message.content
        .map((c) => (c.type === 'text' ? c.text : `${c.name}${JSON.stringify(c.arguments)}`))
        .join('')
    )
    const latency =
      LATENCY.baseMs +
      (prompt - cached) * LATENCY.inputTokenMs +
      cached * LATENCY.inputTokenMs * 0.1 +
      output * LATENCY.outputTokenMs
    this.requests++
    this.input += prompt
    this.cached += Math.min(cached, prompt)
    this.output += output
    this.busyMs += latency
    this.maxPrompt = Math.max(this.maxPrompt, prompt)
    return Math.round(latency)
  }
}

const TAG = /<([CRF])(\d+(?:\.\d+)?)>|<done ([RF]\d+(?:\.\d+)?)>/g
function textOf(message) {
  const { content } = message
  if (typeof content === 'string') return content
  return (content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('')
}

/**
 * Stands in for the model. It reads every user message and tool result in the
 * request, acts once on each tag it has not handled, and always takes the
 * cheapest correct action, so the architectures differ only in what reaches
 * the model and when. Replies carry `ack <id>` or `[[result <id>]]`, which the
 * benchmark reads to time responses.
 */
export class Policy {
  #handled = new Set()
  #workers = new Map()
  #calls = new Map()

  /** `role` is 'router' (Owls tools) or 'single' (one session with a task tool). */
  constructor(role, permission = 'read-only') {
    this.role = role
    this.permission = permission
  }

  respond(context) {
    this.#learn(context.messages)
    const texts = []
    const calls = []
    for (const message of context.messages) {
      if (message.role !== 'user' && message.role !== 'toolResult') continue
      for (const match of textOf(message).matchAll(TAG)) {
        const key = match[3] ? `done ${match[3]}` : `${match[1]}${match[2]}`
        if (this.#handled.has(key)) continue
        const action = this.#act(key, match)
        if (!action) continue
        this.#handled.add(key)
        if (action.text) texts.push(action.text)
        if (action.call) calls.push(action.call)
      }
    }
    const content = []
    if (texts.length) content.push(fauxText(texts.join('\n')))
    content.push(...calls)
    if (!content.length) content.push(fauxText('Noted.'))
    return fauxAssistantMessage(content, { stopReason: calls.length ? 'toolUse' : 'stop' })
  }

  #act(key, match) {
    if (match[3]) return { text: `[[result ${match[3]}]]` }
    const id = key
    if (match[1] === 'C') return { text: `ack ${id}` }
    if (this.role === 'single')
      return { call: fauxToolCall('task', { id, prompt: `Handle <${id}>.` }) }
    if (match[1] === 'R')
      return {
        call: fauxToolCall('dispatch_task', {
          goal: `<${id}> Handle this work request.`,
          permission: this.permission
        })
      }
    // A follow-up that reached the Router: forward it to the worker that owns the request.
    const workerId = this.#workers.get(id.slice(1).split('.')[0])
    if (!workerId) return null
    return { call: fauxToolCall('message_worker', { workerId, text: `<${id}> Follow-up.` }) }
  }

  /** Remembers which worker each dispatched request went to. */
  #learn(messages) {
    for (const message of messages) {
      if (message.role === 'assistant')
        for (const c of message.content)
          if (c.type === 'toolCall' && c.name === 'dispatch_task')
            this.#calls.set(c.id, /<R(\d+)>/.exec(c.arguments.goal)?.[1])
      if (message.role === 'toolResult' && this.#calls.has(message.toolCallId)) {
        const workerId = /"workerId":"([^"]+)"/.exec(textOf(message))?.[1]
        if (workerId) this.#workers.set(this.#calls.get(message.toolCallId), workerId)
      }
    }
  }
}

/** Nearest-rank percentile. */
export function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}
