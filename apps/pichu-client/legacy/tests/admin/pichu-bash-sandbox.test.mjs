import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-bash-sandbox-test-'))
const mainDir = join(moduleDir, 'main')
const toolsDir = join(mainDir, 'tools')
const sharedDir = join(moduleDir, 'shared')
mkdirSync(toolsDir, { recursive: true })
mkdirSync(sharedDir, { recursive: true })
symlinkSync(new URL('../../node_modules', import.meta.url), join(moduleDir, 'node_modules'), 'dir')
writeFileSync(
  join(mainDir, 'background-terminals.ts'),
  readFileSync(new URL('../../src/main/background-terminals.ts', import.meta.url), 'utf8'),
  'utf8'
)
writeFileSync(
  join(sharedDir, 'tool-approval.ts'),
  readFileSync(new URL('../../src/shared/tool-approval.ts', import.meta.url), 'utf8'),
  'utf8'
)
writeFileSync(
  join(toolsDir, 'pichu-bash-sandbox.ts'),
  readFileSync(new URL('../../src/main/tools/pichu-bash-sandbox.ts', import.meta.url), 'utf8')
    .replaceAll('../../shared/tool-approval.js', '../../shared/tool-approval.ts')
    .replaceAll('../background-terminals.js', '../background-terminals.ts'),
  'utf8'
)

const {
  buildPichuBashSandboxConfig,
  buildPichuBashSandboxEscalationForApproval,
  createPichuSandboxedBashOperations,
  runPichuManagedExecCommand
} = await import(`${pathToFileURL(join(toolsDir, 'pichu-bash-sandbox.ts')).href}?ts=${Date.now()}`)
const { SandboxManager } = await import('@anthropic-ai/sandbox-runtime')
const backgroundTerminals = await import(
  pathToFileURL(join(mainDir, 'background-terminals.ts')).href
)

after(() => {
  rmSync(moduleDir, { recursive: true, force: true })
})

function approvalRequest(command) {
  return {
    id: 'approval-1',
    sessionId: 'session-1',
    cwd: process.cwd(),
    toolName: 'exec_command',
    toolUseId: 'tool-1',
    toolInput: { cmd: command },
    approvalMode: 'prompt',
    description: command,
    autoReviewAction: { type: 'command', command },
    source: 'chat',
    createdAt: new Date(0).toISOString()
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(predicate(), true)
}

test('buildPichuBashSandboxConfig protects private files, scopes writes, and blocks network by default', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-sandbox-config-'))

  try {
    const normalizedWorkspaceRoot = realpathSync(workspaceRoot)
    const config = buildPichuBashSandboxConfig(workspaceRoot)
    assert.ok(config.filesystem)

    assert.ok(config.filesystem.denyRead.includes(join(homedir(), '.ssh')))
    assert.ok(config.filesystem.denyRead.includes(join(homedir(), '.aws')))
    assert.ok(!config.filesystem.denyRead.includes(join(homedir(), '.pichu')))
    assert.ok(!config.filesystem.denyRead.includes(join(homedir(), '.pichu', 'run')))
    assert.ok(config.filesystem.denyRead.includes(join(homedir(), '.pichu', 'pichu.db*')))
    assert.ok(!config.filesystem.denyRead.includes(join(homedir(), '.pichu', 'plugins', 'cache')))
    assert.ok(config.filesystem.denyRead.includes(join(normalizedWorkspaceRoot, '.env')))
    assert.ok(config.filesystem.denyRead.includes(`${normalizedWorkspaceRoot}/**/.env`))

    assert.ok(config.filesystem.allowWrite.includes(normalizedWorkspaceRoot))
    assert.ok(config.filesystem.allowWrite.includes('/tmp'))
    assert.ok(
      config.filesystem.allowWrite.includes(join(homedir(), '.pichu', 'runtimes', 'npm-cache'))
    )
    assert.ok(
      config.filesystem.allowWrite.includes(join(homedir(), '.pichu', 'runtimes', 'npm-global'))
    )
    assert.ok(!config.filesystem.allowWrite.includes(homedir()))

    assert.ok(config.filesystem.denyWrite.includes(join(normalizedWorkspaceRoot, '.env')))
    assert.ok(config.filesystem.denyWrite.includes(join(homedir(), '.ssh')))
    assert.ok(config.filesystem.denyWrite.includes(join(homedir(), '.pichu', 'pichu.db*')))
    assert.ok(config.filesystem.denyWrite.includes(join(normalizedWorkspaceRoot, '.git', 'hooks')))
    assert.ok(config.filesystem.denyWrite.includes(join(normalizedWorkspaceRoot, '.git', 'config')))
    assert.equal(config.filesystem.allowGitConfig, false)
    assert.deepEqual(config.network.allowedDomains, [])
    assert.deepEqual(config.network.deniedDomains, [])
    assert.ok(
      config.network.allowUnixSockets.includes(join(homedir(), '.pichu', 'run', 'pichu.sock'))
    )
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('buildPichuBashSandboxEscalationForApproval allows only explicit approved external write paths', () => {
  const target = join(homedir(), 'downloads', 'pichu-nba-video-performance')
  const escalation = buildPichuBashSandboxEscalationForApproval(
    approvalRequest(`rm -rf "${target}"`)
  )

  assert.ok(escalation)
  assert.equal(escalation.allowNetwork, false)
  assert.ok(escalation.allowWritePaths.includes(target))
  assert.ok(escalation.allowWritePaths.includes(join(homedir(), '.Trash')))
  assert.ok(!escalation.allowWritePaths.includes(homedir()))
})

test('buildPichuBashSandboxConfig applies one-shot approval escalation without dropping deny rules', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-sandbox-config-'))
  const externalPath = join(homedir(), 'downloads', 'approved-output.txt')

  try {
    const config = buildPichuBashSandboxConfig(workspaceRoot, {
      allowNetwork: true,
      allowWritePaths: [externalPath]
    })

    assert.equal(config.network, undefined)
    assert.ok(config.filesystem.allowWrite.includes(externalPath))
    assert.ok(config.filesystem.denyRead.includes(join(homedir(), '.ssh')))
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('buildPichuBashSandboxConfig can allow network by default without dropping filesystem rules', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-sandbox-config-'))

  try {
    const config = buildPichuBashSandboxConfig(workspaceRoot, undefined, {
      allowNetworkByDefault: true
    })

    assert.equal(config.network, undefined)
    assert.ok(config.filesystem.denyRead.includes(join(homedir(), '.ssh')))
    assert.ok(!config.filesystem.allowWrite.includes(homedir()))
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('macOS sandbox profile allows FSEvents for directory watchers', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('macOS sandbox profile is only generated on macOS')
    return
  }
  if (!SandboxManager.checkDependencies()) {
    t.skip('sandbox dependencies are not available')
    return
  }

  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-sandbox-fsevents-profile-'))

  try {
    const wrappedCommand = await SandboxManager.wrapWithSandbox(
      'printf ok',
      'bash',
      buildPichuBashSandboxConfig(workspaceRoot)
    )

    assert.match(wrappedCommand, /com\.apple\.FSEvents/)
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('directory fs.watch works under the Owls macOS sandbox', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('macOS seatbelt sandbox is only available on macOS')
    return
  }
  if (!SandboxManager.checkDependencies()) {
    t.skip('sandbox dependencies are not available')
    return
  }

  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pichu-sandbox-fsevents-watch-'))
  const nodeScript = `
const fs = require('node:fs')
const watcher = fs.watch(process.cwd())
let done = false
function finish(code, output) {
  if (done) return
  done = true
  try { watcher.close() } catch {}
  if (code === 0) console.log(output)
  else console.error(output)
  process.exit(code)
}
watcher.on('error', (error) => {
  finish(1, 'watch-error ' + error.code + ' ' + error.message)
})
setTimeout(() => finish(0, 'watch-ok'), 500)
`

  try {
    const result = await runPichuManagedExecCommand({
      command: `${shellQuote(process.execPath)} -e ${shellQuote(nodeScript)}`,
      cwd: workspaceRoot,
      timeoutSeconds: 5,
      yieldTimeMs: 6000,
      shouldSandbox: () => true
    })

    assert.equal(result.exitCode, 0)
    assert.match(result.output, /watch-ok/)
    assert.doesNotMatch(result.output, /EMFILE|watch-error/)
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('managed bash drains commands without onData handlers', async () => {
  const operations = createPichuSandboxedBashOperations({
    shouldSandbox: () => false
  })

  const result = await operations.exec('yes | head -c 1048576', tmpdir(), {
    timeout: 2
  })

  assert.equal(result.exitCode, 0)
})

test('managed exec completes short commands without a session id', async () => {
  const result = await runPichuManagedExecCommand({
    command: 'printf short-output',
    cwd: tmpdir(),
    yieldTimeMs: 1000,
    shouldSandbox: () => false
  })

  assert.deepEqual(result, {
    sessionId: null,
    output: 'short-output',
    originalOutputLength: 12,
    exitCode: 0,
    signalCode: null,
    terminalStatus: 'exited'
  })
})

test('managed exec passes the original command into the sandbox runtime', async () => {
  const originalCheckDependencies = SandboxManager.checkDependencies
  const originalWrapWithSandbox = SandboxManager.wrapWithSandbox
  let wrappedCommand = ''

  SandboxManager.checkDependencies = () => true
  SandboxManager.wrapWithSandbox = async (command) => {
    wrappedCommand = command
    return 'printf sandbox-output'
  }

  try {
    const result = await runPichuManagedExecCommand({
      command: 'printf original-output',
      cwd: tmpdir(),
      yieldTimeMs: 1000,
      shouldSandbox: () => true
    })

    assert.equal(wrappedCommand, 'printf original-output')
    assert.equal(result.output, 'sandbox-output')
    assert.equal(result.exitCode, 0)
  } finally {
    SandboxManager.checkDependencies = originalCheckDependencies
    SandboxManager.wrapWithSandbox = originalWrapWithSandbox
  }
})

test('managed exec waits until yield before returning a running session', async () => {
  const startedAt = Date.now()
  const result = await runPichuManagedExecCommand({
    command: 'printf ready; sleep 5',
    cwd: tmpdir(),
    yieldTimeMs: 300,
    shouldSandbox: () => false
  })

  try {
    assert.ok(Date.now() - startedAt >= 250)
    assert.equal(typeof result.sessionId, 'string')
    assert.equal(result.output, 'ready')
    assert.equal(result.exitCode, null)
    assert.equal(result.signalCode, null)
    assert.equal(result.terminalStatus, 'running')
  } finally {
    if (result.sessionId) {
      backgroundTerminals.terminateBackgroundTerminal(result.sessionId, { force: true })
      await waitFor(() =>
        backgroundTerminals
          .listBackgroundTerminals()
          .every((terminal) => terminal.id !== result.sessionId)
      )
    }
  }
})

test('managed exec timeout still applies after returning a running session', async () => {
  const result = await runPichuManagedExecCommand({
    command: "trap '' TERM; while :; do sleep 1; done",
    cwd: tmpdir(),
    timeoutSeconds: 0.2,
    yieldTimeMs: 50,
    shouldSandbox: () => false
  })

  assert.equal(typeof result.sessionId, 'string')
  const snapshot = await backgroundTerminals.pollBackgroundTerminalOutput(result.sessionId, {
    yieldTimeMs: 3000,
    advance: true
  })
  assert.ok(snapshot)
  assert.equal(snapshot.running, false)
  assert.equal(snapshot.status, 'terminated')
  assert.equal(typeof snapshot.output, 'string')
  backgroundTerminals.releaseRetainedBackgroundTerminal(result.sessionId)
})

test('managed exec uses pipes by default', async () => {
  const result = await runPichuManagedExecCommand({
    command: 'test -t 1 && printf tty || printf pipe',
    cwd: tmpdir(),
    yieldTimeMs: 1000,
    shouldSandbox: () => false
  })

  assert.equal(result.sessionId, null)
  assert.equal(result.output.replace(/\r/g, ''), 'pipe')
  assert.equal(result.exitCode, 0)
  assert.equal(result.signalCode, null)
  assert.equal(result.terminalStatus, 'exited')
})

test('managed exec can allocate a PTY', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Owls does not support Windows PTY sessions')
    return
  }

  const result = await runPichuManagedExecCommand({
    command: 'test -t 1 && printf tty || printf pipe',
    cwd: tmpdir(),
    yieldTimeMs: 1000,
    tty: true,
    shouldSandbox: () => false
  })

  assert.equal(result.sessionId, null)
  assert.equal(result.output.replace(/\r/g, ''), 'tty')
  assert.equal(result.exitCode, 0)
  assert.equal(result.signalCode, null)
  assert.equal(result.terminalStatus, 'exited')
})

test('managed exec does not spawn when already aborted', async () => {
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    runPichuManagedExecCommand({
      command: 'sleep 30',
      cwd: tmpdir(),
      yieldTimeMs: 1000,
      signal: controller.signal,
      shouldSandbox: () => false
    }),
    /aborted/
  )

  assert.deepEqual(backgroundTerminals.listBackgroundTerminals(), [])
})

test('managed exec abort terminates a spawned command before returning', async () => {
  const readyFile = join(tmpdir(), `pichu-managed-abort-${process.pid}-${Date.now()}`)
  const controller = new AbortController()
  const runPromise = runPichuManagedExecCommand({
    command: `touch ${shellQuote(readyFile)}; sleep 30`,
    cwd: tmpdir(),
    yieldTimeMs: 5000,
    signal: controller.signal,
    shouldSandbox: () => false
  })

  try {
    await waitFor(() => existsSync(readyFile))
    controller.abort()
    await assert.rejects(runPromise, /aborted/)
    await waitFor(() => backgroundTerminals.listBackgroundTerminals().length === 0)
  } finally {
    rmSync(readyFile, { force: true })
  }
})

test('managed bash does not register commands that fail to spawn', async () => {
  const operations = createPichuSandboxedBashOperations({
    shellPath: join(moduleDir, 'missing-bash'),
    shouldSandbox: () => false
  })

  await assert.rejects(
    operations.exec('echo ok', tmpdir(), {
      timeout: 1
    }),
    /ENOENT/
  )

  assert.deepEqual(backgroundTerminals.listBackgroundTerminals(), [])
})

test('managed bash timeout force terminates commands that ignore SIGTERM', async () => {
  const operations = createPichuSandboxedBashOperations({
    shouldSandbox: () => false
  })
  const startedAt = Date.now()

  await assert.rejects(
    operations.exec("trap '' TERM; while :; do sleep 1; done", tmpdir(), {
      timeout: 0.1
    }),
    /timeout:0.1/
  )

  assert.ok(Date.now() - startedAt < 1500)
})
