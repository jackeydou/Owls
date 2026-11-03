import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import test from 'node:test'

const backgroundTerminals = await import(
  `${new URL('../../src/main/background-terminals.ts', import.meta.url).href}?ts=${Date.now()}`
)

function createFakeChild(pid) {
  const child = new EventEmitter()
  child.pid = pid
  child.killSignals = []
  child.kill = (signal) => {
    child.killSignals.push(signal)
    return true
  }
  return child
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(predicate(), true)
}

function waitForChildClose(child) {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    child.once('close', resolve)
    child.once('error', reject)
  })
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function runIsolatedPollingScript({ closeBeforePoll }) {
  const moduleUrl = new URL('../../src/main/background-terminals.ts', import.meta.url).href
  const script = `
import { EventEmitter } from 'node:events'
const backgroundTerminals = await import(${JSON.stringify(`${moduleUrl}?isolated=${closeBeforePoll}`)})
const child = new EventEmitter()
child.pid = 2147483000
child.kill = () => true
const id = backgroundTerminals.registerBackgroundTerminal({
  child,
  command: 'isolated-poll',
  cwd: '/tmp',
  retainOnExit: true
})
if (${JSON.stringify(closeBeforePoll)}) child.emit('close', 0, null)
const snapshot = await backgroundTerminals.pollBackgroundTerminalOutput(id, {
  yieldTimeMs: 25
})
console.log(JSON.stringify(snapshot))
`
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', script],
    { encoding: 'utf8', timeout: 5000 }
  )
}

test('background terminals list only registered running commands', () => {
  const child = createFakeChild(2147483001)
  const id = backgroundTerminals.registerBackgroundTerminal({
    child,
    command: 'pnpm dev',
    cwd: '/tmp/project',
    sessionId: 'session_1'
  })

  assert.deepEqual(backgroundTerminals.listBackgroundTerminals(), [
    {
      id,
      command: 'pnpm dev',
      cwd: '/tmp/project',
      sessionId: 'session_1',
      pid: 2147483001,
      startedAt: backgroundTerminals.listBackgroundTerminals()[0].startedAt,
      status: 'running'
    }
  ])

  child.emit('close', 0)
  assert.deepEqual(backgroundTerminals.listBackgroundTerminals(), [])
})

test('background terminal terminate is scoped to registered ids', () => {
  const child = createFakeChild(2147483002)
  const id = backgroundTerminals.registerBackgroundTerminal({
    child,
    command: 'vite --host 127.0.0.1',
    cwd: '/tmp/site'
  })

  assert.equal(backgroundTerminals.terminateBackgroundTerminal('missing'), false)
  assert.equal(backgroundTerminals.terminateBackgroundTerminal(id), true)
  assert.equal(
    backgroundTerminals.listBackgroundTerminals().some((terminal) => terminal.id === id),
    true
  )
  assert.equal(
    backgroundTerminals.listBackgroundTerminals().find((terminal) => terminal.id === id)?.status,
    'terminating'
  )
  assert.equal(backgroundTerminals.terminateBackgroundTerminal(id), false)
  assert.deepEqual(child.killSignals, ['SIGTERM'])

  child.emit('close', null)
  assert.deepEqual(backgroundTerminals.listBackgroundTerminals(), [])
})

test('background terminal stdin only writes arbitrary input to PTY sessions', () => {
  const child = createFakeChild(2147483003)
  child.stdinWriteCount = 0
  child.stdin = {
    destroyed: false,
    writableEnded: false,
    write() {
      child.stdinWriteCount += 1
      return true
    }
  }
  const id = backgroundTerminals.registerBackgroundTerminal({
    child,
    command: 'cat',
    cwd: '/tmp'
  })

  assert.equal(backgroundTerminals.writeBackgroundTerminalStdin(id, 'hello'), 'closed')
  assert.equal(child.stdinWriteCount, 0)
  assert.equal(backgroundTerminals.writeBackgroundTerminalStdin(id, '\u0003'), 'ok')
  assert.deepEqual(child.killSignals, ['SIGINT'])

  child.emit('close', null)
})

test('background terminal polling keeps awaited timers active', () => {
  for (const closeBeforePoll of [false, true]) {
    const result = runIsolatedPollingScript({ closeBeforePoll })
    assert.equal(result.status, 0, result.stderr)
    const snapshot = JSON.parse(result.stdout)
    assert.equal(snapshot.running, !closeBeforePoll)
  }
})

test('background terminal poll returns exited for short commands with output', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Unix process groups are not available on Windows')
    return
  }

  const child = spawn('bash', ['-c', 'printf short-output'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const id = backgroundTerminals.registerBackgroundTerminal({
    child,
    command: 'printf short-output',
    cwd: '/tmp',
    retainOnExit: true,
    captureOutput: true
  })

  const snapshot = await backgroundTerminals.pollBackgroundTerminalOutput(id, {
    yieldTimeMs: 1000,
    advance: true
  })

  assert.ok(snapshot)
  assert.equal(snapshot.sessionId, null)
  assert.equal(snapshot.running, false)
  assert.equal(snapshot.status, 'exited')
  assert.equal(snapshot.exitCode, 0)
  assert.equal(snapshot.output, 'short-output')

  backgroundTerminals.releaseRetainedBackgroundTerminal(id)
  assert.deepEqual(backgroundTerminals.listBackgroundTerminals(), [])
})

test('background terminal snapshots keep original output length before truncation', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Unix process groups are not available on Windows')
    return
  }

  const child = spawn('bash', ['-c', 'printf abcdefghij'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const id = backgroundTerminals.registerBackgroundTerminal({
    child,
    command: 'printf abcdefghij',
    cwd: '/tmp',
    retainOnExit: true,
    captureOutput: true
  })

  const snapshot = await backgroundTerminals.pollBackgroundTerminalOutput(id, {
    yieldTimeMs: 1000,
    maxChars: 4,
    advance: true
  })

  assert.ok(snapshot)
  assert.equal(snapshot.output, 'ghij')
  assert.equal(snapshot.originalOutputLength, 10)

  backgroundTerminals.releaseRetainedBackgroundTerminal(id)
})

test('background terminal snapshots count output trimmed from the retained buffer', () => {
  const child = createFakeChild(2147483004)
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  const id = backgroundTerminals.registerBackgroundTerminal({
    child,
    command: 'large-output',
    cwd: '/tmp',
    captureOutput: true
  })

  const output = `${'a'.repeat(1024 * 1024)}tail`
  child.stdout.emit('data', output)

  const snapshot = backgroundTerminals.readBackgroundTerminalOutput(id, {
    maxChars: 4
  })

  assert.ok(snapshot)
  assert.equal(snapshot.output, 'tail')
  assert.equal(snapshot.originalOutputLength, output.length)

  child.emit('close', 0)
})

test('background terminals keep shell-launched process groups after the shell exits', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Unix process groups are not available on Windows')
    return
  }

  const child = spawn('bash', ['-c', 'sleep 30 &'], {
    detached: true,
    stdio: 'ignore'
  })
  const closePromise = waitForChildClose(child)
  const pid = child.pid
  assert.equal(typeof pid, 'number')
  const id = backgroundTerminals.registerBackgroundTerminal({
    child,
    command: 'sleep 30 &',
    cwd: '/tmp'
  })

  await closePromise
  await waitFor(() => processGroupExists(pid))

  assert.equal(
    backgroundTerminals.listBackgroundTerminals().some((terminal) => terminal.id === id),
    true
  )

  assert.equal(backgroundTerminals.terminateBackgroundTerminal(id), true)
  await waitFor(() => !processGroupExists(pid), 5000)
})

test('background terminals recognize child pids in registered process groups', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Unix process groups are not available on Windows')
    return
  }

  const childPidFile = `/tmp/pichu-background-terminal-child-${process.pid}-${Date.now()}`
  const child = spawn('bash', ['-c', `sleep 30 & echo $! > ${shellQuote(childPidFile)}; wait`], {
    detached: true,
    stdio: 'ignore'
  })
  const pid = child.pid
  assert.equal(typeof pid, 'number')
  const id = backgroundTerminals.registerBackgroundTerminal({
    child,
    command: 'sleep 30',
    cwd: '/tmp'
  })

  try {
    await waitFor(() => existsSync(childPidFile))
    const childPid = Number.parseInt(readFileSync(childPidFile, 'utf8'), 10)
    assert.equal(Number.isInteger(childPid), true)
    assert.equal(backgroundTerminals.isKnownBackgroundTerminalPid(childPid), true)
    assert.equal(
      backgroundTerminals.isKnownBackgroundTerminalPidForSession(childPid, 'session-1'),
      false
    )
  } finally {
    backgroundTerminals.terminateBackgroundTerminal(id, { force: true })
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // The registry may already have removed the process group.
    }
    rmSync(childPidFile, { force: true })
  }
})

test('background terminal pid lookup can be scoped to a session', () => {
  const child = createFakeChild(2147483010)
  const id = backgroundTerminals.registerBackgroundTerminal({
    child,
    command: 'pnpm dev',
    cwd: '/tmp/project',
    sessionId: 'session-1'
  })

  assert.equal(backgroundTerminals.isKnownBackgroundTerminalPid(child.pid), true)
  assert.equal(
    backgroundTerminals.isKnownBackgroundTerminalPidForSession(child.pid, 'session-1'),
    true
  )
  assert.equal(
    backgroundTerminals.isKnownBackgroundTerminalPidForSession(child.pid, 'session-2'),
    false
  )
  assert.equal(backgroundTerminals.isKnownBackgroundTerminalPidForSession(child.pid, null), false)

  child.emit('close', 0)
  assert.equal(backgroundTerminals.terminateBackgroundTerminal(id, { force: true }), false)
})

test('background terminal SIGKILL fallback survives shell close after SIGTERM', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Unix process groups are not available on Windows')
    return
  }

  const readyFile = `/tmp/pichu-background-terminal-${process.pid}-${Date.now()}`
  const command = `trap 'exit 0' TERM; bash -c 'trap "" TERM HUP; touch "$1"; while :; do sleep 1; done' bash ${shellQuote(readyFile)} & wait`
  const child = spawn('bash', ['-c', command], {
    detached: true,
    stdio: 'ignore'
  })
  const pid = child.pid
  assert.equal(typeof pid, 'number')
  const id = backgroundTerminals.registerBackgroundTerminal({
    child,
    command,
    cwd: '/tmp'
  })

  try {
    await waitFor(() => processGroupExists(pid))
    await waitFor(() => existsSync(readyFile))

    const closePromise = waitForChildClose(child)
    assert.equal(backgroundTerminals.terminateBackgroundTerminal(id), true)
    await closePromise
    assert.equal(processGroupExists(pid), true)
    assert.equal(
      backgroundTerminals.listBackgroundTerminals().find((terminal) => terminal.id === id)?.status,
      'terminating'
    )

    await waitFor(() => !processGroupExists(pid), 5000)
    assert.equal(
      backgroundTerminals.listBackgroundTerminals().some((terminal) => terminal.id === id),
      false
    )
  } finally {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // The fallback may already have removed the process group.
    }
    rmSync(readyFile, { force: true })
  }
})

test('force terminate kills a background terminal immediately', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Unix process groups are not available on Windows')
    return
  }

  const readyFile = `/tmp/pichu-background-terminal-force-${process.pid}-${Date.now()}`
  const command = `bash -c 'trap "" TERM HUP; touch "$1"; while :; do sleep 1; done' bash ${shellQuote(readyFile)}`
  const child = spawn('bash', ['-c', command], {
    detached: true,
    stdio: 'ignore'
  })
  const pid = child.pid
  assert.equal(typeof pid, 'number')
  const id = backgroundTerminals.registerBackgroundTerminal({
    child,
    command,
    cwd: '/tmp'
  })

  try {
    await waitFor(() => processGroupExists(pid))
    await waitFor(() => existsSync(readyFile))

    assert.equal(backgroundTerminals.terminateBackgroundTerminal(id, { force: true }), true)
    await waitFor(() => !processGroupExists(pid), 1000)
    await waitFor(
      () => !backgroundTerminals.listBackgroundTerminals().some((terminal) => terminal.id === id)
    )
  } finally {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // The force terminate path may already have removed the process group.
    }
    rmSync(readyFile, { force: true })
  }
})

test('terminateAllBackgroundTerminals terminates active registered commands', () => {
  const first = createFakeChild(2147483003)
  const second = createFakeChild(2147483004)
  backgroundTerminals.registerBackgroundTerminal({
    child: first,
    command: 'next dev',
    cwd: '/tmp/next'
  })
  backgroundTerminals.registerBackgroundTerminal({
    child: second,
    command: 'python -m http.server',
    cwd: '/tmp/static'
  })

  assert.equal(backgroundTerminals.terminateAllBackgroundTerminals(), 2)
  assert.deepEqual(first.killSignals, ['SIGTERM'])
  assert.deepEqual(second.killSignals, ['SIGTERM'])

  first.emit('close', null)
  second.emit('close', null)
  assert.deepEqual(backgroundTerminals.listBackgroundTerminals(), [])
})

test('forceTerminateAllBackgroundTerminals upgrades terminating commands to SIGKILL', async () => {
  const child = createFakeChild(2147483007)
  const id = backgroundTerminals.registerBackgroundTerminal({
    child,
    command: 'next dev',
    cwd: '/tmp/next'
  })

  assert.equal(backgroundTerminals.terminateBackgroundTerminal(id), true)
  assert.deepEqual(child.killSignals, ['SIGTERM'])
  assert.equal(backgroundTerminals.forceTerminateAllBackgroundTerminals(), 1)
  assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL'])
  child.emit('close', null)
  await waitFor(() => backgroundTerminals.listBackgroundTerminals().length === 0)
})

test('forceTerminateAllBackgroundTerminals force terminates active registered commands', async () => {
  const first = createFakeChild(2147483005)
  const second = createFakeChild(2147483006)
  backgroundTerminals.registerBackgroundTerminal({
    child: first,
    command: 'next dev',
    cwd: '/tmp/next'
  })
  backgroundTerminals.registerBackgroundTerminal({
    child: second,
    command: 'python -m http.server',
    cwd: '/tmp/static'
  })

  assert.equal(backgroundTerminals.forceTerminateAllBackgroundTerminals(), 2)
  assert.deepEqual(first.killSignals, ['SIGKILL'])
  assert.deepEqual(second.killSignals, ['SIGKILL'])
  first.emit('close', null)
  second.emit('close', null)
  await waitFor(() => backgroundTerminals.listBackgroundTerminals().length === 0)
})

test('background terminals can be listed and cleaned by session', async () => {
  const first = createFakeChild(2147483008)
  const second = createFakeChild(2147483009)
  backgroundTerminals.registerBackgroundTerminal({
    child: first,
    command: 'next dev',
    cwd: '/tmp/next',
    sessionId: 'session-a'
  })
  backgroundTerminals.registerBackgroundTerminal({
    child: second,
    command: 'python -m http.server',
    cwd: '/tmp/static',
    sessionId: 'session-b'
  })

  assert.equal(backgroundTerminals.listBackgroundTerminals({ sessionId: 'session-a' }).length, 1)
  assert.equal(
    backgroundTerminals.forceTerminateAllBackgroundTerminals({ sessionId: 'session-a' }),
    1
  )
  assert.deepEqual(first.killSignals, ['SIGKILL'])
  assert.deepEqual(second.killSignals, [])
  first.emit('close', null)

  await waitFor(
    () => backgroundTerminals.listBackgroundTerminals({ sessionId: 'session-a' }).length === 0
  )
  assert.equal(backgroundTerminals.listBackgroundTerminals({ sessionId: 'session-b' }).length, 1)

  second.emit('close', null)
  assert.deepEqual(backgroundTerminals.listBackgroundTerminals(), [])
})

test('background terminal registry prunes the oldest tasks when the cap is exceeded', async () => {
  const children = []
  for (let index = 0; index < 65; index += 1) {
    const child = createFakeChild(2147484000 + index)
    children.push(child)
    backgroundTerminals.registerBackgroundTerminal({
      child,
      command: `task ${index}`,
      cwd: '/tmp'
    })
  }

  assert.deepEqual(children[0].killSignals, ['SIGKILL'])
  children[0].emit('close', null)
  await waitFor(() => backgroundTerminals.listBackgroundTerminals().length <= 64)

  for (const child of children.slice(1)) {
    child.emit('close', null)
  }
  assert.deepEqual(backgroundTerminals.listBackgroundTerminals(), [])
})

test('background terminal process exit cleanup force terminates visible tasks synchronously', () => {
  const child = createFakeChild(2147485001)
  backgroundTerminals.registerBackgroundTerminal({
    child,
    command: 'vite --host 127.0.0.1',
    cwd: '/tmp/site'
  })

  assert.equal(backgroundTerminals.terminateBackgroundTerminalsOnProcessExit(), 1)
  assert.deepEqual(child.killSignals, ['SIGKILL'])

  child.emit('close', null)
  assert.deepEqual(backgroundTerminals.listBackgroundTerminals(), [])
})
