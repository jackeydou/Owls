import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  defaultSessionName,
  devLaunchArgs,
  resolveDataRoot,
  selectLogLines,
  sessionSlug
} from '../../scripts/debug-app.mjs'
import { splitDevArgs } from '../../scripts/dev.mjs'

test('sessions are scoped to the checkout and get a path-safe slug', () => {
  assert.equal(defaultSessionName('/work/worktrees/search-fix'), 'Agent Debug search-fix')
  assert.equal(sessionSlug('Agent Debug search-fix'), 'agent-debug-search-fix')
  assert.match(sessionSlug('调试'), /^[0-9a-f]{8}$/)
})

test('the default data root stays out of the real ~/.pichu', () => {
  const root = resolveDataRoot(undefined, 'agent-debug-owls')
  assert.equal(root, join(homedir(), '.pichu-dev', 'agent-debug-owls'))
  assert.equal(resolveDataRoot('~/qa', 'x'), join(homedir(), 'qa'))
  assert.equal(resolveDataRoot('/data/qa', 'x'), '/data/qa')
  assert.throws(() => resolveDataRoot('relative/path', 'x'), /absolute/)
})

test('debug launch args reach electron-vite and the app on the right side of the separator', () => {
  const [run, script, ...rest] = devLaunchArgs({
    cdpPort: 19222,
    inspectPort: 19223,
    name: 'Agent Debug',
    dataRoot: '/data/qa'
  })
  assert.deepEqual([run, script], ['run', 'dev'])
  assert.deepEqual(splitDevArgs(rest), [
    'dev',
    '--remoteDebuggingPort',
    '19222',
    '--inspect',
    '19223',
    '--',
    '--enable-logging',
    '--pichu-dev-name',
    'Agent Debug',
    '--pichu-data-root',
    '/data/qa'
  ])
})

test('logs and console split one log file by source', () => {
  const log = [
    'starting electron app...',
    '[20954:1105/171141.306950:INFO:CONSOLE:1] "render failed", source: http://localhost:5173/x (1)',
    'main: connected',
    'Debugger attached.',
    '[20954:1105/171142.306950:INFO:CONSOLE:9] "Uncaught Error: boom", source:  (9)',
    ''
  ].join('\n')

  assert.deepEqual(selectLogLines(log, { kind: 'logs' }), [
    'starting electron app...',
    'main: connected'
  ])
  assert.deepEqual(selectLogLines(log, { kind: 'console', grep: 'Uncaught' }), [
    '17:11:42 "Uncaught Error: boom", source:  (9)'
  ])
  assert.deepEqual(selectLogLines(log, { kind: 'logs', lines: 1 }), ['main: connected'])
})
