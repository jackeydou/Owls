import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-background-terminals-ipc-test-'))
const mainDir = join(moduleDir, 'main')
const ipcHandlersDir = join(mainDir, 'ipc-handlers')
const sharedDir = join(moduleDir, 'shared')
const electronDir = join(moduleDir, 'node_modules', 'electron')
mkdirSync(ipcHandlersDir, { recursive: true })
mkdirSync(sharedDir, { recursive: true })
mkdirSync(electronDir, { recursive: true })
writeFileSync(
  join(electronDir, 'package.json'),
  JSON.stringify({ name: 'electron', type: 'module', main: 'index.js' }),
  'utf8'
)
writeFileSync(join(electronDir, 'index.js'), 'export const ipcMain = { handle() {} }\n', 'utf8')
writeFileSync(
  join(sharedDir, 'background-terminals.ts'),
  readFileSync(new URL('../../src/shared/background-terminals.ts', import.meta.url), 'utf8'),
  'utf8'
)
writeFileSync(
  join(mainDir, 'background-terminals.ts'),
  `globalThis.__pichuBackgroundTerminalIpcCalls ??= []
export const calls = globalThis.__pichuBackgroundTerminalIpcCalls
export function resetCalls() {
  calls.length = 0
}
export function listBackgroundTerminals(options = {}) {
  calls.push(['list', options])
  return [
    {
      id: '1000',
      command: 'pnpm dev',
      cwd: '/tmp/project',
      sessionId: options.sessionId ?? null,
      pid: 1234,
      startedAt: '2026-06-20T00:00:00.000Z',
      status: 'running'
    }
  ]
}
export function terminateBackgroundTerminal(id, options = {}) {
  calls.push(['terminate', id, options])
  return true
}
export function forceTerminateAllBackgroundTerminals(options = {}) {
  calls.push(['clean', options])
  return 1
}
`,
  'utf8'
)
writeFileSync(
  join(ipcHandlersDir, 'background-terminals-ipc-handler.ts'),
  readFileSync(
    new URL('../../src/main/ipc-handlers/background-terminals-ipc-handler.ts', import.meta.url),
    'utf8'
  )
    .replaceAll('../../shared/background-terminals.js', '../../shared/background-terminals.ts')
    .replaceAll('../background-terminals.js', '../background-terminals.ts'),
  'utf8'
)

const backgroundTerminals = await import(
  `${pathToFileURL(join(mainDir, 'background-terminals.ts')).href}?ts=${Date.now()}`
)
const ipcHandler = await import(
  `${pathToFileURL(join(ipcHandlersDir, 'background-terminals-ipc-handler.ts')).href}?ts=${Date.now()}`
)

after(() => {
  rmSync(moduleDir, { recursive: true, force: true })
})

test('renderer background terminal IPC defaults omitted sessionId to null scope', () => {
  backgroundTerminals.resetCalls()

  ipcHandler.listBackgroundTerminalsForRenderer()
  ipcHandler.terminateBackgroundTerminalForRenderer({ id: '1000' })
  ipcHandler.cleanBackgroundTerminalsForRenderer()

  assert.deepEqual(backgroundTerminals.calls, [
    ['list', { sessionId: null }],
    ['terminate', '1000', { force: true, sessionId: null }],
    ['clean', { sessionId: null }]
  ])
})

test('renderer background terminal IPC ignores renderer-provided session scope', () => {
  backgroundTerminals.resetCalls()

  ipcHandler.listBackgroundTerminalsForRenderer({ sessionId: 'session-a' })
  ipcHandler.terminateBackgroundTerminalForRenderer({ id: '1000', sessionId: 'session-a' })
  ipcHandler.cleanBackgroundTerminalsForRenderer({ sessionId: 'session-a' })

  assert.deepEqual(backgroundTerminals.calls, [
    ['list', { sessionId: null }],
    ['terminate', '1000', { force: true, sessionId: null }],
    ['clean', { sessionId: null }]
  ])
})

test('trusted background terminal calls can explicitly use global session scope', () => {
  backgroundTerminals.resetCalls()
  const trustedOptions = { allowGlobalSessionScope: true }

  ipcHandler.listBackgroundTerminalsForRenderer(undefined, trustedOptions)
  ipcHandler.terminateBackgroundTerminalForRenderer({ id: '1000' }, trustedOptions)
  ipcHandler.cleanBackgroundTerminalsForRenderer(undefined, trustedOptions)

  assert.deepEqual(backgroundTerminals.calls, [
    ['list', { sessionId: undefined }],
    ['terminate', '1000', { force: true, sessionId: undefined }],
    ['clean', { sessionId: undefined }]
  ])
})
