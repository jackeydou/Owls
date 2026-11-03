import assert from 'node:assert/strict'
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { readFileChangePreviews } from '../../src/main/tools/auto-review-actions.ts'

test('readFileChangePreviews includes scoped diff preview for workspace writes', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pichu-auto-review-actions-'))
  const filePath = join(cwd, 'data.txt')
  writeFileSync(filePath, 'old value\n', 'utf8')

  const changes = readFileChangePreviews(
    'write',
    {
      path: 'data.txt',
      content: 'new value\n'
    },
    cwd
  )

  assert.equal(changes.length, 1)
  assert.equal(changes[0].pathScope, 'insideCwd')
  assert.equal(changes[0].resolvedPath, filePath)
  assert.match(changes[0].diffPreview ?? '', /-old value/)
  assert.match(changes[0].diffPreview ?? '', /\+new value/)
})

test('readFileChangePreviews does not read existing symlink targets for diff previews', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pichu-auto-review-actions-'))
  const outside = mkdtempSync(join(tmpdir(), 'pichu-auto-review-outside-'))
  const outsideFile = join(outside, 'secret.txt')
  writeFileSync(outsideFile, 'outside secret\n', 'utf8')
  symlinkSync(outsideFile, join(cwd, 'linked-secret.txt'))

  const changes = readFileChangePreviews(
    'write',
    {
      path: 'linked-secret.txt',
      content: 'new value\n'
    },
    cwd
  )

  assert.equal(changes.length, 1)
  assert.equal(changes[0].pathScope, 'insideCwd')
  assert.equal(changes[0].diffPreview, undefined)
  assert.equal(changes[0].diffUnavailableReason, 'Existing file is a symbolic link.')
})
