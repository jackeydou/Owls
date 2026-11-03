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

const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-coding-tools-test-'))
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
  ['./pichu-bash-sandbox.js', './pichu-bash-sandbox.ts']
])
writeModule(
  'main/background-terminals.ts',
  [
    'export async function pollBackgroundTerminalOutput(...args) { return globalThis.__pichuPollBackgroundTerminalOutput?.(...args) ?? null }',
    'export function readBackgroundTerminalOutput(...args) { return globalThis.__pichuReadBackgroundTerminalOutput?.(...args) ?? null }',
    'export function releaseRetainedBackgroundTerminal(...args) { return globalThis.__pichuReleaseRetainedBackgroundTerminal?.(...args) }',
    "export function writeBackgroundTerminalStdin(...args) { return globalThis.__pichuWriteBackgroundTerminalStdin?.(...args) ?? 'unknown' }"
  ].join('\n')
)
writeModule(
  'main/env.ts',
  [
    'export function removeUnsupportedNpmConfigEnv(env) { return env }',
    "export function withDefaultRuntimePackageManagerEnv(env) { return { ...env, NPM_CONFIG_CACHE: env.NPM_CONFIG_CACHE ?? '/tmp/pichu-data/runtimes/npm-cache', npm_config_cache: env.npm_config_cache ?? '/tmp/pichu-data/runtimes/npm-cache' } }"
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
  'main/tools/pichu-bash-sandbox.ts',
  [
    'export function createPichuSandboxedBashOperations() { return {} }',
    'export async function runPichuBashSandboxContext(_toolCallId, fn) { return fn() }',
    "export async function runPichuManagedExecCommand(...args) { return globalThis.__pichuRunPichuManagedExecCommand?.(...args) ?? { sessionId: null, exitCode: 0, signalCode: null, terminalStatus: 'exited', output: '' } }"
  ].join('\n')
)

const { createPichuCodingTools, createPichuReadOnlyTools, resolveCommandWorkdir } = await import(
  `${pathToFileURL(join(toolsDir, 'coding.ts')).href}?ts=${Date.now()}`
)

test('coding tools expose exec_command instead of legacy bash', () => {
  const tools = createPichuCodingTools(process.cwd())
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
  const tools = createPichuReadOnlyTools(process.cwd())
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
  globalThis.__pichuRunPichuManagedExecCommand = async (options) => {
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
    const execTool = createPichuCodingTools('/tmp', undefined, [], () => 'session_1').find(
      (tool) => tool.name === 'exec_command'
    )
    assert.ok(execTool)
    await execTool.execute('call_1', { cmd: 'npx shadcn@latest info --json' })

    assert.ok(observed)
    assert.equal(observed.env.NPM_CONFIG_CACHE, '/tmp/pichu-data/runtimes/npm-cache')
    assert.equal(observed.env.npm_config_cache, '/tmp/pichu-data/runtimes/npm-cache')
  } finally {
    delete globalThis.__pichuRunPichuManagedExecCommand
  }
})

test('exec_command does not seed auth for hidden Owls site projects', async () => {
  const siteRoot = mkdtempSync(join(tmpdir(), 'pichu-site-dev-auth-'))
  mkdirSync(join(siteRoot, 'lib', 'server'), { recursive: true })
  mkdirSync(join(siteRoot, 'app', 'api', 'pichu-dev-auth'), { recursive: true })
  writeFileSync(join(siteRoot, 'components.json'), '{}\n')
  writeFileSync(join(siteRoot, 'lib', 'server', 'dev-auth.ts'), 'export {}\n')
  writeFileSync(join(siteRoot, 'app', 'api', 'pichu-dev-auth', 'route.ts'), 'export {}\n')

  let observed
  globalThis.__pichuTestAuthToken = 'header.payload.signature'
  globalThis.__pichuTestAuthUser = { uid: 'user-1', username: 'tester' }
  globalThis.__pichuRunPichuManagedExecCommand = async (options) => {
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
    const execTool = createPichuCodingTools(siteRoot).find((tool) => tool.name === 'exec_command')
    assert.ok(execTool)
    await execTool.execute('call_1', { cmd: 'curl http://127.0.0.1:3000/api/example' })

    const authPath = join(siteRoot, '.pichu', 'dev-auth.json')
    assert.equal(existsSync(authPath), false)
    assert.equal(observed.env.PICHU_SITE_JWT, undefined)
  } finally {
    delete globalThis.__pichuTestAuthToken
    delete globalThis.__pichuTestAuthUser
    delete globalThis.__pichuRunPichuManagedExecCommand
    rmSync(siteRoot, { recursive: true, force: true })
  }
})

test('write_stdin reports closed stdin for non-tty sessions', async () => {
  globalThis.__pichuReadBackgroundTerminalOutput = () => ({ sessionId: null })
  globalThis.__pichuWriteBackgroundTerminalStdin = () => 'closed'

  try {
    const writeStdinTool = createPichuCodingTools('/tmp').find(
      (tool) => tool.name === 'write_stdin'
    )
    assert.ok(writeStdinTool)
    await assert.rejects(
      () => writeStdinTool.execute('call_1', { session_id: 1008, chars: 'n\n' }),
      /stdin is closed for this session; rerun exec_command with tty=true/
    )
  } finally {
    delete globalThis.__pichuReadBackgroundTerminalOutput
    delete globalThis.__pichuWriteBackgroundTerminalStdin
  }
})

test('write_stdin accepts string session ids from exec_command results', async () => {
  const observedWrites = []
  globalThis.__pichuReadBackgroundTerminalOutput = () => ({ sessionId: null })
  globalThis.__pichuWriteBackgroundTerminalStdin = (sessionId, chars) => {
    observedWrites.push({ sessionId, chars })
    return 'written'
  }
  globalThis.__pichuPollBackgroundTerminalOutput = async (sessionId) => ({
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
    const writeStdinTool = createPichuCodingTools('/tmp').find(
      (tool) => tool.name === 'write_stdin'
    )
    assert.ok(writeStdinTool)
    const result = await writeStdinTool.execute('call_1', { session_id: '1008', chars: 'n\n' })

    assert.equal(result.details.sessionId, '1008')
    assert.deepEqual(observedWrites, [{ sessionId: '1008', chars: 'n\n' }])
  } finally {
    delete globalThis.__pichuReadBackgroundTerminalOutput
    delete globalThis.__pichuWriteBackgroundTerminalStdin
    delete globalThis.__pichuPollBackgroundTerminalOutput
  }
})

test('write_stdin empty polls use Codex-compatible yield bounds', async () => {
  const observedYieldTimes = []
  globalThis.__pichuReadBackgroundTerminalOutput = () => ({ sessionId: null })
  globalThis.__pichuPollBackgroundTerminalOutput = async (_sessionId, options) => {
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
    const writeStdinTool = createPichuCodingTools('/tmp').find(
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
    delete globalThis.__pichuReadBackgroundTerminalOutput
    delete globalThis.__pichuPollBackgroundTerminalOutput
  }
})

test('write_stdin releases retained sessions after final snapshots', async () => {
  const releasedSessionIds = []
  globalThis.__pichuReadBackgroundTerminalOutput = () => ({ sessionId: null })
  globalThis.__pichuPollBackgroundTerminalOutput = async () => ({
    sessionId: null,
    exitCode: 0,
    signalCode: null,
    status: 'exited',
    running: false,
    command: 'printf done',
    output: 'done',
    originalOutputLength: 4
  })
  globalThis.__pichuReleaseRetainedBackgroundTerminal = (sessionId) => {
    releasedSessionIds.push(sessionId)
  }

  try {
    const writeStdinTool = createPichuCodingTools('/tmp').find(
      (tool) => tool.name === 'write_stdin'
    )
    assert.ok(writeStdinTool)
    const result = await writeStdinTool.execute('call_1', { session_id: 1008 })

    assert.equal(result.details.sessionId, null)
    assert.deepEqual(releasedSessionIds, ['1008'])
  } finally {
    delete globalThis.__pichuReadBackgroundTerminalOutput
    delete globalThis.__pichuPollBackgroundTerminalOutput
    delete globalThis.__pichuReleaseRetainedBackgroundTerminal
  }
})

test('write_stdin reports token count from untruncated output length', async () => {
  globalThis.__pichuReadBackgroundTerminalOutput = () => ({ sessionId: null })
  globalThis.__pichuPollBackgroundTerminalOutput = async () => ({
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
    const writeStdinTool = createPichuCodingTools('/tmp').find(
      (tool) => tool.name === 'write_stdin'
    )
    assert.ok(writeStdinTool)
    const result = await writeStdinTool.execute('call_1', { session_id: 1008 })

    assert.equal(result.details.output, 'tail')
    assert.equal(result.details.originalTokenCount, 100)
  } finally {
    delete globalThis.__pichuReadBackgroundTerminalOutput
    delete globalThis.__pichuPollBackgroundTerminalOutput
  }
})

test('resolveCommandWorkdir rejects symlink escapes outside the base cwd', () => {
  const base = mkdtempSync(join(tmpdir(), 'pichu-workdir-base-'))
  const outside = mkdtempSync(join(tmpdir(), 'pichu-workdir-outside-'))
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
  const base = mkdtempSync(join(tmpdir(), 'pichu-workdir-base-'))
  const child = join(base, 'child')
  mkdirSync(child)

  try {
    assert.equal(resolveCommandWorkdir(base, 'child'), child)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
