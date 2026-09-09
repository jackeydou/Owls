import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import signing from '../../scripts/prepare-mac-signing.cjs'

test('signing preflight grows beyond 65536 for a large bundle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'owls-large-signing-'))
  try {
    const framework = join(directory, 'framework')
    await mkdir(framework)
    for (let index = 0; index < 512; index += 1) {
      await writeFile(join(framework, `file-${index}`), 'resource')
    }
    // The signer follows directory aliases, so each alias contributes file probes.
    for (let index = 0; index < 128; index += 1) {
      await symlink('framework', join(directory, `alias-${index}`))
    }
    let requested
    await signing.prepareMacSigning(directory, (target) => {
      requested = target
      return { beforeSoft: 65_536, afterSoft: target, afterHard: 1_048_575 }
    })
    assert.equal(requested, 129 * 512 + 4096)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('signing preflight counts nested files and framework symlinks before raising limits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'owls-signing-'))
  try {
    await mkdir(join(directory, 'framework'))
    await writeFile(join(directory, 'framework', 'binary'), 'binary')
    await writeFile(join(directory, 'resource'), 'resource')
    await symlink('framework', join(directory, 'current'))
    let requested
    await signing.prepareMacSigning(directory, (target) => {
      requested = target
      return { beforeSoft: 256, afterSoft: target, afterHard: target }
    })
    assert.equal(requested, 65_536)
    await assert.rejects(
      signing.prepareMacSigning(directory, () => ({
        beforeSoft: 256,
        afterSoft: 256,
        afterHard: 256
      })),
      /Raise the build shell's hard limit/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
