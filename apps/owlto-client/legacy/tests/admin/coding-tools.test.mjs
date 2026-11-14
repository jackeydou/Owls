import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

const moduleDir = mkdtempSync(join(tmpdir(), 'owls-coding-tools-test-'))
const mainDir = join(moduleDir, 'main')
const toolsDir = join(mainDir, 'tools')
mkdirSync(toolsDir, { recursive: true })
symlinkSync(new URL('../../node_modules', import.meta.url), join(moduleDir, 'node_modules'), 'dir')

function writeModule(relativePath, source) {
  const path = join(moduleDir, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source, 'utf8')
}

function copySource(relativePath, replacements = []) {
  let source = readFileSync(new URL(`../../src/${relativePath}`, import.meta.url), 'utf8')
  for (const [from, to] of replacements) {
    source = source.replaceAll(from, to)
  }
  writeModule(relativePath, source)
}

after(() => {
  rmSync(moduleDir, { recursive: true, force: true })
})

copySource('main/tools/coding.ts', [
  ['../background-terminals.js', '../background-terminals.ts'],
  ['../env.js', '../env.ts'],
  ['../node-runtime.js', '../node-runtime.ts'],
  ['../runtime-certs.js', '../runtime-certs.ts'],
  ['../stores/settings-store.js', '../stores/settings-store.ts'],
  ['./owls-bash-sandbox.js', './owls-bash-sandbox.ts']
])
writeModule(
  'main/background-terminals.ts',
  [
    'export async function pollBackgroundTerminalOutput(...args) { return globalThis.__owlsPollBackgroundTerminalOutput?.(...args) ?? null }',
    'export function readBackgroundTerminalOutput(...args) { return globalThis.__owlsReadBackgroundTerminalOutput?.(...args) ?? null }',
    'export function releaseRetainedBackgroundTerminal(...args) { return globalThis.__owlsReleaseRetainedBackgroundTerminal?.(...args) }',
    "export function writeBackgroundTerminalStdin(...args) { return globalThis.__owlsWriteBackgroundTerminalStdin?.(...args) ?? 'unknown' }"
  ].join('\n')
)
writeModule(
  'main/env.ts',
  [
    'export function removeUnsupportedNpmConfigEnv(env) { return env }',
    "export function withDefaultRuntimePackageManagerEnv(env) { return { ...env, NPM_CONFIG_CACHE: env.NPM_CONFIG_CACHE ?? '/tmp/owls-data/runtimes/npm-cache', npm_config_cache: env.npm_config_cache ?? '/tmp/owls-data/runtimes/npm-cache' } }"
  ].join('\n')
)
writeModule('main/node-runtime.ts', 'export function findBundledNodeBinPath() { return null }\n')
writeModule(
  'main/runtime-certs.ts',
  'export function findDefaultRuntimeCaBundlePath() { return null }\n'
)
writeModule(
  'main/stores/settings-store.ts',
  "export function getAgentTrustProfile() { return 'prompt' }\n"
)
writeModule(
  'main/tools/owls-bash-sandbox.ts',
  [
    'export function createOwlsSandboxedBashOperations() { return {} }',
    'export async function runOwlsBashSandboxContext(_toolCallId, fn) { return fn() }',
    "export async function runOwlsManagedExecCommand(...args) { return globalThis.__owlsRunOwlsManagedExecCommand?.(...args) ?? { sessionId: null, exitCode: 0, signalCode: null, terminalStatus: 'exited', output: '' } }"
  ].join('\n')
)

const { createOwlsCodingTools, createOwlsReadOnlyTools, resolveCommandWorkdir } = await import(
  `${pathToFileURL(join(toolsDir, 'coding.ts')).href}?ts=${Date.now()}`
)

test('coding tools expose exec_command instead of legacy bash', () => {
  const tools = createOwlsCodingTools(process.cwd())
  assert.equal(
    tools.some((tool) => tool.name === 'exec_command'),
    true
  )
  assert.equal(
    tools.some((tool) => tool.name === 'write_stdin'),
    true
  )
  assert.equal(
    tools.some((tool) => tool.name === 'bash'),
    false
  )
})

test('read-only tools expose exec_command instead of legacy bash', () => {
  const tools = createOwlsReadOnlyTools(process.cwd())
  assert.equal(
    tools.some((tool) => tool.name === 'exec_command'),
    true
  )
  assert.equal(
    tools.some((tool) => tool.name === 'write_stdin'),
    true
  )
  assert.equal(
    tools.some((tool) => tool.name === 'bash'),
    false
  )
})

test('exec_command uses Owls npm cache defaults for npx', async () => {
  let observed
  globalThis.__owlsRunOwlsManagedExecCommand = async (options) => {
    observed = options
    return {
      sessionId: null,
      exitCode: 0,
      signalCode: null,
      terminalStatus: 'exited',
      output: 'ok'
    }
  }

  try {
    const execTool = createOwlsCodingTools('/tmp', undefined, [], () => 'session_1').find(
      (tool) => tool.name === 'exec_command'
    )
    assert.ok(execTool)
    await execTool.execute('call_1', { cmd: 'npx shadcn@latest info --json' })

    assert.ok(observed)
    assert.equal(observed.env.NPM_CONFIG_CACHE, '/tmp/owls-data/runtimes/npm-cache')
    assert.equal(observed.env.npm_config_cache, '/tmp/owls-data/runtimes/npm-cache')
  } finally {
    delete globalThis.__owlsRunOwlsManagedExecCommand
  }
})

test('exec_command does not seed auth for hidden Owls site projects', async () => {
  const siteRoot = mkdtempSync(join(tmpdir(), 'owls-site-dev-auth-'))
  mkdirSync(join(siteRoot, 'lib', 'server'), { recursive: true })
  mkdirSync(join(siteRoot, 'app', 'api', 'owls-dev-auth'), { recursive: true })
  writeFileSync(join(siteRoot, 'components.json'), '{}\n')
  writeFileSync(join(siteRoot, 'lib', 'server', 'dev-auth.ts'), 'export {}\n')
  writeFileSync(join(siteRoot, 'app', 'api', 'owls-dev-auth', 'route.ts'), 'export {}\n')

  let observed
  globalThis.__owlsTestAuthToken = 'header.payload.signature'
  globalThis.__owlsTestAuthUser = { uid: 'user-1', username: 'tester' }
  globalThis.__owlsRunOwlsManagedExecCommand = async (options) => {
    observed = options
    return {
      sessionId: null,
      exitCode: 0,
      signalCode: null,
      terminalStatus: 'exited',
      output: 'ok'
    }
  }

  try {
    const execTool = createOwlsCodingTools(siteRoot).find((tool) => tool.name === 'exec_command')
    assert.ok(execTool)
    await execTool.execute('call_1', { cmd: 'curl http://127.0.0.1:3000/api/example' })

    const authPath = join(siteRoot, '.owls', 'dev-auth.json')
    assert.equal(existsSync(authPath), false)
    assert.equal(observed.env.OWLS_SITE_JWT, undefined)
  } finally {
    delete globalThis.__owlsTestAuthToken
    delete globalThis.__owlsTestAuthUser
    delete globalThis.__owlsRunOwlsManagedExecCommand
    rmSync(siteRoot, { recursive: true, force: true })
  }
})

test('write_stdin reports closed stdin for non-tty sessions', async () => {
  globalThis.__owlsReadBackgroundTerminalOutput = () => ({ sessionId: null })
  globalThis.__owlsWriteBackgroundTerminalStdin = () => 'closed'

  try {
    const writeStdinTool = createOwlsCodingTools('/tmp').find(
      (tool) => tool.name === 'write_stdin'
    )
    assert.ok(writeStdinTool)
    await assert.rejects(
      () => writeStdinTool.execute('call_1', { session_id: 1008, chars: 'n\n' }),
      /stdin is closed for this session; rerun exec_command with tty=true/
    )
  } finally {
    delete globalThis.__owlsReadBackgroundTerminalOutput
    delete globalThis.__owlsWriteBackgroundTerminalStdin
  }
})

test('write_stdin accepts string session ids from exec_command results', async () => {
  const observedWrites = []
  globalThis.__owlsReadBackgroundTerminalOutput = () => ({ sessionId: null })
  globalThis.__owlsWriteBackgroundTerminalStdin = (sessionId, chars) => {
    observedWrites.push({ sessionId, chars })
    return 'written'
  }
  globalThis.__owlsPollBackgroundTerminalOutput = async (sessionId) => ({
    sessionId,
    exitCode: null,
    signalCode: null,
    status: 'running',
    running: true,
    command: 'npm install',
    output: 'ok',
    originalOutputLength: 2
  })

  try {
    const writeStdinTool = createOwlsCodingTools('/tmp').find(
      (tool) => tool.name === 'write_stdin'
    )
    assert.ok(writeStdinTool)
    const result = await writeStdinTool.execute('call_1', { session_id: '1008', chars: 'n\n' })

    assert.equal(result.details.sessionId, '1008')
    assert.deepEqual(observedWrites, [{ sessionId: '1008', chars: 'n\n' }])
  } finally {
    delete globalThis.__owlsReadBackgroundTerminalOutput
    delete globalThis.__owlsWriteBackgroundTerminalStdin
    delete globalThis.__owlsPollBackgroundTerminalOutput
  }
})

test('write_stdin empty polls use Codex-compatible yield bounds', async () => {
  const observedYieldTimes = []
  globalThis.__owlsReadBackgroundTerminalOutput = () => ({ sessionId: null })
  globalThis.__owlsPollBackgroundTerminalOutput = async (_sessionId, options) => {
    observedYieldTimes.push(options.yieldTimeMs)
    return {
      sessionId: null,
      exitCode: null,
      signalCode: null,
      status: 'running',
      running: true,
      command: 'npm install',
      output: '',
      originalOutputLength: 0
    }
  }

  try {
    const writeStdinTool = createOwlsCodingTools('/tmp').find(
      (tool) => tool.name === 'write_stdin'
    )
    assert.ok(writeStdinTool)

    await writeStdinTool.execute('call_1', { session_id: 1008, chars: '', yield_time_ms: 1000 })
    await writeStdinTool.execute('call_2', {
      session_id: 1008,
      chars: '',
      yield_time_ms: 600_000
    })

    assert.deepEqual(observedYieldTimes, [5000, 300000])
  } finally {
    delete globalThis.__owlsReadBackgroundTerminalOutput
    delete globalThis.__owlsPollBackgroundTerminalOutput
  }
})

test('write_stdin releases retained sessions after final snapshots', async () => {
  const releasedSessionIds = []
  globalThis.__owlsReadBackgroundTerminalOutput = () => ({ sessionId: null })
  globalThis.__owlsPollBackgroundTerminalOutput = async () => ({
    sessionId: null,
    exitCode: 0,
    signalCode: null,
    status: 'exited',
    running: false,
    command: 'printf done',
    output: 'done',
    originalOutputLength: 4
  })
  globalThis.__owlsReleaseRetainedBackgroundTerminal = (sessionId) => {
    releasedSessionIds.push(sessionId)
  }

  try {
    const writeStdinTool = createOwlsCodingTools('/tmp').find(
      (tool) => tool.name === 'write_stdin'
    )
    assert.ok(writeStdinTool)
    const result = await writeStdinTool.execute('call_1', { session_id: 1008 })

    assert.equal(result.details.sessionId, null)
    assert.deepEqual(releasedSessionIds, ['1008'])
  } finally {
    delete globalThis.__owlsReadBackgroundTerminalOutput
    delete globalThis.__owlsPollBackgroundTerminalOutput
    delete globalThis.__owlsReleaseRetainedBackgroundTerminal
  }
})

test('write_stdin reports token count from untruncated output length', async () => {
  globalThis.__owlsReadBackgroundTerminalOutput = () => ({ sessionId: null })
  globalThis.__owlsPollBackgroundTerminalOutput = async () => ({
    sessionId: null,
    exitCode: null,
    signalCode: null,
    status: 'running',
    running: true,
    command: 'yes',
    output: 'tail',
    originalOutputLength: 400
  })

  try {
    const writeStdinTool = createOwlsCodingTools('/tmp').find(
      (tool) => tool.name === 'write_stdin'
    )
    assert.ok(writeStdinTool)
    const result = await writeStdinTool.execute('call_1', { session_id: 1008 })

    assert.equal(result.details.output, 'tail')
    assert.equal(result.details.originalTokenCount, 100)
  } finally {
    delete globalThis.__owlsReadBackgroundTerminalOutput
    delete globalThis.__owlsPollBackgroundTerminalOutput
  }
})

test('resolveCommandWorkdir rejects symlink escapes outside the base cwd', () => {
  const base = mkdtempSync(join(tmpdir(), 'owls-workdir-base-'))
  const outside = mkdtempSync(join(tmpdir(), 'owls-workdir-outside-'))
  const link = join(base, 'external')
  symlinkSync(outside, link, 'dir')

  try {
    assert.throws(
      () => resolveCommandWorkdir(base, 'external'),
      /Working directory must stay inside/
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('resolveCommandWorkdir accepts real child directories inside the base cwd', () => {
  const base = mkdtempSync(join(tmpdir(), 'owls-workdir-base-'))
  const child = join(base, 'child')
  mkdirSync(child)

  try {
    assert.equal(resolveCommandWorkdir(base, 'child'), child)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
