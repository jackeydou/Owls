// Lets a coding agent run and drive the dev app one shell command at a time. The app runs
// detached and every command reconnects to it, so nothing has to stay alive between commands.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageDirectory, '../..')
const SESSIONS_ROOT = join(repoRoot, '.owls-debug')
const START_TIMEOUT_MS = 120_000
const STOP_TIMEOUT_MS = 10_000
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_LOG_LINES = 50
// Chromium's --enable-logging format: [pid:MMDD/HHMMSS.micros:LEVEL:CONSOLE:line] text
const CONSOLE_LINE = /^\[\d+:\d{4}\/(\d{2})(\d{2})(\d{2})\.\d+:[A-Z]+:CONSOLE:\d+\] (.*)$/
// Printed each time the `main` command connects to the inspector.
const INSPECTOR_NOISE = /^(Debugger attached\.|Debugger ending on |For help, see: )/

const USAGE = `Usage: pnpm debug:app <command> [--name <session>]

Lifecycle
  start [--data-root <path>]     Launch the dev app, or report the one already running
  stop                           Quit the app
  restart                        Relaunch; main and preload changes need this, renderer hot reloads
  status                         Print the session as JSON

Inspect
  snapshot [selector]            Print the accessibility tree
  screenshot [path] [--selector <selector>]
                                 Save a PNG and print its path
  eval <expression>              Evaluate in the renderer and print the result
  main <expression>              Evaluate in the main process; \`electron\` and \`require\` are in scope
  logs [--lines <n>] [--grep <regex>]
                                 Main process and build output
  console [--lines <n>] [--grep <regex>]
                                 Renderer console output and uncaught errors

Act
  click <selector>
  fill <selector> <text>
  press <key>                    For example Enter or Meta+J
  wait <selector> [--hidden]
  run <script.mjs>               Run a default export that receives { page, context, browser, main }

Selectors are Playwright selectors, for example role=button[name="Add project"] or text=Owls.
--timeout <ms> limits waits (default ${DEFAULT_TIMEOUT_MS}).`

export function defaultSessionName(root = repoRoot) {
  return `Agent Debug ${basename(root)}`
}

export function sessionSlug(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || createHash('sha256').update(name).digest('hex').slice(0, 8)
}

/** The data root is isolated by default, so an agent never touches the user's real sessions. */
export function resolveDataRoot(input, slug) {
  if (!input) return join(homedir(), '.pichu-dev', slug)
  const expanded = input === '~' || input.startsWith('~/') ? join(homedir(), input.slice(1)) : input
  if (!isAbsolute(expanded)) throw new Error('--data-root must be absolute or start with ~/.')
  return expanded
}

export function devLaunchArgs({ cdpPort, inspectPort, name, dataRoot }) {
  return [
    'run',
    'dev',
    '--remoteDebuggingPort',
    String(cdpPort),
    '--inspect',
    String(inspectPort),
    '--enable-logging',
    '--pichu-dev-name',
    name,
    '--pichu-data-root',
    dataRoot
  ]
}

export function selectLogLines(text, { kind, grep = null, lines = DEFAULT_LOG_LINES }) {
  const pattern = grep ? new RegExp(grep) : null
  const selected = text
    .split('\n')
    .flatMap((line) => {
      const match = CONSOLE_LINE.exec(line)
      if (kind === 'console')
        return match ? [`${match[1]}:${match[2]}:${match[3]} ${match[4]}`] : []
      return match || !line || INSPECTOR_NOISE.test(line) ? [] : [line]
    })
    .filter((line) => !pattern || pattern.test(line))
  return selected.slice(-lines)
}

function sessionDirectory(slug) {
  return join(SESSIONS_ROOT, slug)
}

function readSession(slug) {
  try {
    return JSON.parse(readFileSync(join(sessionDirectory(slug), 'session.json'), 'utf8'))
  } catch {
    return null
  }
}

function writeSession(session) {
  writeFileSync(
    join(sessionDirectory(session.slug), 'session.json'),
    `${JSON.stringify(session, null, 2)}\n`
  )
}

async function fetchJson(session, path) {
  const response = await fetch(`http://127.0.0.1:${session.cdpPort}${path}`, {
    signal: AbortSignal.timeout(1500)
  })
  return response.json()
}

/** The User-Agent check keeps a stale session from adopting whatever reused its port. */
async function isRunning(session) {
  try {
    const version = await fetchJson(session, '/json/version')
    return version['User-Agent'].includes('Electron/')
  } catch {
    return false
  }
}

async function requireRunning(slug) {
  const session = readSession(slug)
  if (session && (await isRunning(session))) return session
  throw new Error(`The app is not running for "${slug}". Run: pnpm debug:app start`)
}

async function rendererUrl(session) {
  const targets = await fetchJson(session, '/json/list')
  return (
    targets.find((target) => target.type === 'page' && !target.url.startsWith('devtools://'))
      ?.url ?? null
  )
}

async function withPage(session, timeout, action) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${session.cdpPort}`)
  try {
    const context = browser.contexts()[0]
    const page = context?.pages().find((candidate) => !candidate.url().startsWith('devtools://'))
    if (!page) throw new Error('The app has no open window.')
    page.setDefaultTimeout(timeout)
    return await action({ browser, context, page })
  } finally {
    // Over CDP this only disconnects; the app keeps running.
    await browser.close()
  }
}

async function evaluateInMain(session, expression, timeout = DEFAULT_TIMEOUT_MS) {
  const response = await fetch(`http://127.0.0.1:${session.inspectPort}/json/list`)
  const [target] = await response.json()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  try {
    return await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`The main process did not answer within ${timeout} ms.`)),
        timeout
      )
      socket.onerror = () => reject(new Error('Could not reach the main process inspector.'))
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.id !== 1) return
        clearTimeout(timer)
        const failure = message.error?.message ?? message.result.exceptionDetails
        if (failure) {
          reject(new Error(failure.exception?.description ?? failure.text ?? failure))
        } else resolvePromise(message.result.result.value)
      }
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
              expression: `(async () => { const electron = require('electron'); return (${expression}\n) })()`,
              awaitPromise: true,
              returnByValue: true,
              // Only the inspector's command line API has `require` in the main process.
              includeCommandLineAPI: true
            }
          })
        )
    })
  } finally {
    socket.close()
  }
}

async function freePorts(count) {
  const servers = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise((resolvePromise, reject) => {
          const server = createServer()
          server.once('error', reject)
          server.listen(0, '127.0.0.1', () => resolvePromise(server))
        })
    )
  )
  const ports = servers.map((server) => server.address().port)
  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))))
  return ports
}

/** Commands of the session's process group; empty once every process has exited. */
function groupCommands(pid) {
  const { stdout } = spawnSync('ps', ['-A', '-o', 'pgid=,command='], { encoding: 'utf8' })
  return stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    return match && Number(match[1]) === pid ? [match[2]] : []
  })
}

function delay(milliseconds) {
  return new Promise((done) => setTimeout(done, milliseconds))
}

async function stopGroup(pid) {
  const commands = groupCommands(pid)
  // A reused pid must not be signaled: only a group that runs Electron is ours.
  if (!commands.some((command) => /electron/i.test(command))) return
  process.kill(-pid, 'SIGTERM')
  for (const deadline = Date.now() + STOP_TIMEOUT_MS; Date.now() < deadline; ) {
    if (groupCommands(pid).length === 0) return
    await delay(100)
  }
  // Quitting with active tasks waits on a native dialog that nobody can answer here.
  if (groupCommands(pid).length > 0) process.kill(-pid, 'SIGKILL')
}

function logTail(session) {
  return readFileSync(session.logPath, 'utf8').split('\n').slice(-20).join('\n')
}

async function launch({ name, slug, dataRoot }) {
  if (process.platform === 'win32') throw new Error('debug:app supports macOS and Linux.')
  const directory = sessionDirectory(slug)
  mkdirSync(directory, { recursive: true })
  const [cdpPort, inspectPort] = await freePorts(2)
  const logPath = join(directory, 'app.log')
  const log = openSync(logPath, 'w')
  const child = spawn('pnpm', devLaunchArgs({ cdpPort, inspectPort, name, dataRoot }), {
    cwd: packageDirectory,
    detached: true,
    stdio: ['ignore', log, log]
  })
  closeSync(log)
  child.unref()
  const session = { name, slug, dataRoot, pid: child.pid, cdpPort, inspectPort, logPath }
  writeSession(session)

  let exited = false
  child.once('exit', () => {
    exited = true
  })
  child.once('error', () => {
    exited = true
  })
  for (const deadline = Date.now() + START_TIMEOUT_MS; Date.now() < deadline; ) {
    if (exited) throw new Error(`The app exited during startup:\n${logTail(session)}`)
    const url = await rendererUrl(session).catch(() => null)
    if (url) {
      await withPage(session, START_TIMEOUT_MS, ({ page }) =>
        page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0)
      )
      return session
    }
    await delay(250)
  }
  await stopGroup(session.pid)
  throw new Error(`The app did not open a window in time:\n${logTail(session)}`)
}

async function describe(slug) {
  const session = readSession(slug)
  if (!session || !(await isRunning(session))) return { running: false, session: slug }
  const { name, pid, dataRoot, cdpPort, inspectPort, logPath } = session
  return {
    running: true,
    session: slug,
    name,
    pid,
    window: await rendererUrl(session).catch(() => null),
    dataRoot,
    cdpPort,
    inspectPort,
    logPath
  }
}

function print(value) {
  console.log(typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? 'undefined'))
}

function required(value, label) {
  if (value === undefined) throw new Error(`Missing ${label}.\n\n${USAGE}`)
  return value
}

/** User scripts are only known at run time, so this is the one dynamic import here. */
async function loadDebugScript(path) {
  const script = await import(pathToFileURL(resolve(path)).href)
  if (typeof script.default !== 'function') {
    throw new Error(`${path} must have a default export function.`)
  }
  return script.default
}

const OPTIONS = {
  name: { type: 'string' },
  'data-root': { type: 'string' },
  selector: { type: 'string' },
  lines: { type: 'string' },
  grep: { type: 'string' },
  timeout: { type: 'string' },
  hidden: { type: 'boolean' },
  help: { type: 'boolean' }
}

export async function runCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true
  })
  const [command, first, second] = positionals
  if (!command || values.help) return print(USAGE)

  const name = values.name ?? defaultSessionName()
  const slug = sessionSlug(name)
  const timeout = Number(values.timeout ?? DEFAULT_TIMEOUT_MS)
  const onPage = async (action) => withPage(await requireRunning(slug), timeout, action)

  switch (command) {
    case 'start': {
      const existing = readSession(slug)
      const dataRoot = resolveDataRoot(values['data-root'] ?? existing?.dataRoot, slug)
      if (existing && (await isRunning(existing))) {
        if (existing.dataRoot !== dataRoot) {
          throw new Error(`"${slug}" is running on ${existing.dataRoot}. Stop it first.`)
        }
      } else await launch({ name, slug, dataRoot })
      return print(await describe(slug))
    }
    case 'stop': {
      const session = readSession(slug)
      if (session) await stopGroup(session.pid)
      return print(await describe(slug))
    }
    case 'restart': {
      const session = required(readSession(slug), 'a session; run start first')
      await stopGroup(session.pid)
      await launch({ name: session.name, slug, dataRoot: session.dataRoot })
      return print(await describe(slug))
    }
    case 'status':
      return print(await describe(slug))
    case 'snapshot':
      return print(await onPage(({ page }) => page.locator(first ?? 'body').ariaSnapshot()))
    case 'screenshot': {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const path = resolve(first ?? join(sessionDirectory(slug), 'screenshots', `${stamp}.png`))
      mkdirSync(dirname(path), { recursive: true })
      await onPage(({ page }) =>
        (values.selector ? page.locator(values.selector) : page).screenshot({ path })
      )
      return print(path)
    }
    case 'eval':
      return print(await onPage(({ page }) => page.evaluate(required(first, 'an expression'))))
    case 'main':
      return print(
        await evaluateInMain(await requireRunning(slug), required(first, 'an expression'), timeout)
      )
    case 'logs':
    case 'console': {
      const session = required(readSession(slug), 'a session; run start first')
      const lines = Number(values.lines ?? DEFAULT_LOG_LINES)
      const text = readFileSync(session.logPath, 'utf8')
      return print(
        selectLogLines(text, { kind: command, grep: values.grep, lines }).join('\n') || '(empty)'
      )
    }
    case 'click':
      await onPage(({ page }) => page.locator(required(first, 'a selector')).click())
      return print(`clicked ${first}`)
    case 'fill':
      await onPage(({ page }) =>
        page.locator(required(first, 'a selector')).fill(required(second, 'text'))
      )
      return print(`filled ${first}`)
    case 'press':
      await onPage(({ page }) => page.keyboard.press(required(first, 'a key')))
      return print(`pressed ${first}`)
    case 'wait': {
      const state = values.hidden ? 'hidden' : 'visible'
      await onPage(({ page }) => page.locator(required(first, 'a selector')).waitFor({ state }))
      return print(`${first} is ${state}`)
    }
    case 'run': {
      const session = await requireRunning(slug)
      const script = await loadDebugScript(required(first, 'a script path'))
      const result = await withPage(session, timeout, (handles) =>
        script({ ...handles, main: (expression) => evaluateInMain(session, expression, timeout) })
      )
      if (result !== undefined) print(result)
      return
    }
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  )
}
