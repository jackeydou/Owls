import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { mergePaths, parseShellPath, readLoginShellPath } = require('../../out/main/app/runtime.js')

/** A stand-in login shell: prints what a noisy shell config might, then runs the probe. */
function fakeShell(dir, body) {
  const path = join(dir, 'fake-shell')
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

test('the login shell PATH is read between markers and merged first', () => {
  assert.equal(
    parseShellPath('Welcome!\n__OWLTO_PATH__/opt/homebrew/bin:/usr/bin__OWLTO_PATH__\nbye'),
    '/opt/homebrew/bin:/usr/bin'
  )
  assert.equal(parseShellPath('no markers here'), null)
  assert.equal(parseShellPath('__OWLTO_PATH____OWLTO_PATH__'), null)
  assert.equal(
    mergePaths('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin:/owlto/only', undefined),
    '/opt/homebrew/bin:/usr/bin:/bin:/owlto/only'
  )
})

test('the login shell probe runs the command, survives noise, and gives up on a stuck shell', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'owlto-shell-path-'))
  try {
    const shell = fakeShell(
      dir,
      'echo "banner from .zshrc"\n[ "$1" = "-ilc" ] || exit 3\nPATH=/fake/brew/bin:/usr/bin\neval "$2"'
    )
    assert.equal(await readLoginShellPath(shell), '/fake/brew/bin:/usr/bin')

    const stuck = fakeShell(dir, 'sleep 5')
    const started = Date.now()
    assert.equal(await readLoginShellPath(stuck, 200), null)
    assert.ok(Date.now() - started < 2000)

    assert.equal(await readLoginShellPath(join(dir, 'missing-shell')), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
