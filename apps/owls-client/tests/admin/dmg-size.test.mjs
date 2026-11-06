import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import sizing from '../../scripts/prepare-dmg-size.cjs'

test('DMG sizing counts sparse logical bytes and empty directories without following symlinks', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'owls-dmg-size-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'empty'))
  await writeFile(join(directory, 'sparse'), '')
  await truncate(join(directory, 'sparse'), 512 * 1024 * 1024)
  await symlink('.', join(directory, 'cycle'))
  const measured = await sizing.measureBundle(directory)
  assert.equal(measured.entries, 4)
  assert.equal(measured.allocatedBytes, 512 * 1024 * 1024 + 3 * 4096)
})

test('DMG capacity grows for metadata-heavy bundles and is recalculated after signing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'owls-dmg-capacity-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const app = join(directory, 'Owls.app')
  await mkdir(app)
  for (let index = 0; index < 512; index += 1) {
    await writeFile(join(app, `${index}`), 'small file')
  }
  const context = {
    electronPlatformName: 'darwin',
    appOutDir: directory,
    packager: {
      appInfo: { productFilename: 'Owls' },
      config: { dmg: { icon: null, backgroundColor: '#ffffff', shrink: true } }
    }
  }
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const { DmgTarget } = builderRequire('dmg-builder/out/dmg')
  // Targets are created before packaging hooks run. Verify they see the new size.
  const target = new DmgTarget(context.packager, directory)
  await sizing.prepareDmgSize(context)
  const before = Number.parseInt(context.packager.config.dmg.size, 10)
  assert.ok(before > 256 + (512 * 4096) / (1024 * 1024))
  await mkdir(join(app, '_CodeSignature'))
  await writeFile(join(app, '_CodeSignature', 'CodeResources'), '')
  await truncate(join(app, '_CodeSignature', 'CodeResources'), 32 * 1024 * 1024)
  await sizing.prepareDmgSize(context)
  assert.ok(Number.parseInt(context.packager.config.dmg.size, 10) >= before + 40)
  assert.equal(context.packager.config.dmg.shrink, true)
  const specification = await target.computeDmgOptions(app)
  assert.equal(specification.size, context.packager.config.dmg.size)
  await sizing.prepareDmgSize({ electronPlatformName: 'win32' })
})
