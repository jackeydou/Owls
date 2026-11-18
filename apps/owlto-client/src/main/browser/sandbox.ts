import { createContext, runInContext } from 'node:vm'
import { type BrowserRunOutcome, formatOutcome, stripAnsi } from './run-code.js'

/**
 * Restricted runs, for workers without full access. The script runs in a fresh
 * `vm` context with no Node globals (`process`, `require`, `Buffer`), and sees
 * the Playwright objects only through a membrane:
 *
 * - Every host object or function it receives is a proxy that hides
 *   `constructor`, `__proto__`, `prototype` and underscored internals and has no
 *   prototype, so it cannot climb to the host's `Function` and back to Node.
 * - Plain data (evaluate results, arrays, records) is copied into the context's
 *   own realm; host promises and errors become context promises and errors.
 * - Functions the script passes in (event handlers, routes) are called with
 *   wrapped arguments, so the host never hands them a raw object.
 * - Calls that would read or write local files are refused: any `path`-like
 *   option, uploads, HAR and trace files, saving downloads or video, CDP
 *   sessions, and launching browsers.
 *
 * `vm` is not a hardened sandbox and a script that never yields can still hang
 * the host process (the main process restarts it), but nothing the script is
 * given reaches the file system or Node.
 */

const HIDDEN = new Set(['constructor', '__proto__', 'prototype', 'caller', 'callee', 'arguments'])
const BLOCKED_CALLS = new Set([
  'setInputFiles',
  'routeFromHAR',
  'newCDPSession',
  'saveAs',
  'createReadStream',
  'tracing',
  'video',
  'browser',
  'browserType',
  'launch',
  'launchPersistentContext',
  'launchServer',
  'connect',
  'connectOverCDP'
])
const FILE_OPTIONS = new Set([
  'path',
  'recordHar',
  'recordVideo',
  'tracesDir',
  'downloadsPath',
  'executablePath',
  'har'
])

const MARKER = Symbol('owlto.host')

type Realm = {
  list: (items: unknown[]) => unknown
  record: (keys: string[], values: unknown[]) => unknown
  then: (thenable: unknown, ok: unknown, bad: unknown) => void
  deferred: () => {
    promise: unknown
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
  }
  error: (message: string, name: string) => unknown
  isPlain: (value: unknown) => boolean
}

function refuse(name: string): never {
  throw new Error(
    `${name} is not available to this worker: browser scripts without full access cannot read or write local files.`
  )
}

export async function runRestrictedBrowserCode(
  code: string,
  scope: Record<string, unknown>,
  timeoutMs: number,
  saveImage: (bytes: Uint8Array) => Promise<string>
): Promise<BrowserRunOutcome> {
  const logs: string[] = []
  const context = createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false }
  })
  // Realm helpers are built before the script runs, so it cannot replace their intrinsics.
  const realm = runInContext(
    `(() => {
      const P = Promise, E = Error, getProto = Object.getPrototypeOf
      const OP = Object.prototype, isArray = Array.isArray, define = Object.defineProperty
      const own = (value) => ({ value, writable: true, enumerable: true, configurable: true })
      return {
        list: (items) => { const out = []; for (let i = 0; i < items.length; i++) define(out, i, own(items[i])); return out },
        record: (keys, values) => { const out = {}; for (let i = 0; i < keys.length; i++) define(out, keys[i], own(values[i])); return out },
        then: (p, ok, bad) => { p.then(ok, bad) },
        deferred: () => { let resolve, reject; const promise = new P((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } },
        error: (message, name) => { const e = new E(message); e.name = name; return e },
        isPlain: (v) => v !== null && typeof v === 'object' && (isArray(v) || getProto(v) === OP || getProto(v) === null)
      }
    })()`,
    context
  ) as Realm

  const proxies = new WeakMap<object, object>()
  const toSandbox = (value: unknown, depth = 0): unknown => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
    if (value instanceof Promise) {
      const { promise, resolve, reject } = realm.deferred()
      value.then(
        (v) => resolve(toSandbox(v)),
        (e) => reject(toSandboxError(e))
      )
      return promise
    }
    if (value instanceof Error) return toSandboxError(value)
    if (depth < 8 && Array.isArray(value))
      return realm.list(value.map((item) => toSandbox(item, depth + 1)))
    if (depth < 8 && isHostPlain(value)) {
      const keys = Object.keys(value)
      return realm.record(
        keys,
        keys.map((key) => toSandbox((value as Record<string, unknown>)[key], depth + 1))
      )
    }
    return membrane(value as object)
  }
  const toSandboxError = (error: unknown) =>
    error instanceof Error
      ? realm.error(stripAnsi(error.message), error.name)
      : realm.error(String(error), 'Error')

  const toHost = (value: unknown, depth = 0): unknown => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
    const target = (value as { [MARKER]?: object })[MARKER]
    if (target) return target
    if (typeof value === 'function') {
      const fn = value as (...args: unknown[]) => unknown
      // Playwright serializes evaluate callbacks with toString, so keep the source.
      const wrapped = (...args: unknown[]) => toHost(fn(...args.map((a) => toSandbox(a))))
      wrapped.toString = () => Function.prototype.toString.call(fn)
      return wrapped
    }
    if (typeof (value as { then?: unknown }).then === 'function') {
      // A promise from the script: settle it through the membrane, never with raw host callbacks.
      return new Promise((resolve, reject) =>
        realm.then(
          value,
          membrane((v: unknown) => resolve(toHost(v))),
          membrane((e: unknown) => reject(new Error(errorText(e))))
        )
      )
    }
    if (depth > 8) return undefined
    if (Array.isArray(value)) return value.map((v) => toHost(v, depth + 1))
    if (realm.isPlain(value)) {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(value as object)) {
        if (FILE_OPTIONS.has(key)) refuse(`The ${key} option`)
        out[key] = toHost((value as Record<string, unknown>)[key], depth + 1)
      }
      return out
    }
    return value
  }

  function membrane(target: object): object {
    const known = proxies.get(target)
    if (known) return known
    const proxy = new Proxy(target, {
      get(obj, key) {
        if (key === MARKER) return obj
        if (typeof key === 'symbol' || HIDDEN.has(key) || key.startsWith('_')) return undefined
        if (BLOCKED_CALLS.has(key)) return () => refuse(key)
        const value = Reflect.get(obj, key)
        return typeof value === 'function'
          ? membrane((value as (...args: unknown[]) => unknown).bind(obj))
          : toSandbox(value)
      },
      apply(fn, _this, args) {
        try {
          return toSandbox(
            Reflect.apply(
              fn as (...a: unknown[]) => unknown,
              undefined,
              args.map((a) => toHost(a))
            )
          )
        } catch (error) {
          throw toSandboxError(error)
        }
      },
      construct: () => refuse('new'),
      getPrototypeOf: () => null,
      setPrototypeOf: () => false,
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
      getOwnPropertyDescriptor: () => undefined,
      ownKeys: () => [],
      has: (obj, key) => typeof key === 'string' && !HIDDEN.has(key) && key in obj
    })
    proxies.set(target, proxy)
    return proxy
  }

  const record =
    (level: string) =>
    (...args: unknown[]) => {
      logs.push(`[${level}] ${args.map(showSandbox).join(' ')}`)
    }
  const sandboxConsole = membrane({
    log: record('log'),
    info: record('info'),
    warn: record('warn'),
    error: record('error')
  })
  const sandboxTimeout = membrane((fn: unknown, ms: unknown) => {
    const callback = toHost(fn)
    if (typeof callback !== 'function') return
    setTimeout(() => callback(), Math.min(Math.max(Number(ms) || 0, 0), timeoutMs))
  })
  const names = Object.keys(scope)
  let timer: NodeJS.Timeout | undefined
  try {
    const result = await new Promise<unknown>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`The script did not finish within ${timeoutMs} ms.`)),
        timeoutMs
      )
      const done = membrane((value: unknown) => resolve(toHost(value)))
      const fail = membrane((error: unknown) => reject(new Error(errorText(error))))
      const run = runInContext(
        `(async (${[...names, 'console', 'setTimeout'].join(', ')}) => {\n${code}\n})`,
        context,
        { timeout: timeoutMs }
      ) as (...args: unknown[]) => { then: (ok: unknown, bad: unknown) => unknown }
      const started = run(
        ...names.map((name) => membrane(scope[name] as object)),
        sandboxConsole,
        sandboxTimeout
      )
      realm.then(started, done, fail)
    })
    const value = result instanceof Uint8Array ? { image: await saveImage(result) } : result
    return { ok: true, text: formatOutcome(toJsonValue(value), logs) }
  } catch (error) {
    return { ok: false, text: formatOutcome(undefined, logs, errorText(error)) }
  } finally {
    clearTimeout(timer)
  }
}

function isHostPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return Array.isArray(value) || proto === Object.prototype || proto === null
}

/** Reads a value the script produced with JSON only, which never hands it a host object. */
function toJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    const json = JSON.stringify(value)
    return json === undefined ? String(value) : JSON.parse(json)
  } catch {
    return '[a value that cannot be shown as JSON]'
  }
}

function showSandbox(value: unknown): string {
  if (typeof value === 'string') return value
  const shown = toJsonValue(value)
  return typeof shown === 'string' ? shown : JSON.stringify(shown, null, 2)
}

function errorText(error: unknown): string {
  if (error === null || typeof error !== 'object') return String(error)
  const target = (error as { [MARKER]?: object })[MARKER] ?? error
  const name = String((target as { name?: unknown }).name ?? 'Error')
  const message = stripAnsi(String((target as { message?: unknown }).message ?? ''))
  return `${name === 'Error' ? '' : `${name}: `}${message}`
}
