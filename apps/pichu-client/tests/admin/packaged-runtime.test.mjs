import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import runtime from '../../scripts/verify-packaged-runtime.cjs'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'owls-runtime-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'app')
  async function manifest(relative, data) {
    const filename = join(root, relative, 'package.json')
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename, JSON.stringify(data))
  }
  return { root, manifest }
}

test('rejects a missing transitive dependency even when it exists outside the app', async (t) => {
  const { root, manifest } = await fixture(t)
  await manifest('.', { name: 'app', dependencies: { sdk: '1' } })
  await manifest('node_modules/sdk', { name: 'sdk', dependencies: { schema: '1' } })
  await manifest('../node_modules/schema', { name: 'schema' })
  assert.throws(() => runtime.verifyDependencyClosure(root), /sdk -> schema/)
  await manifest('node_modules/schema', { name: 'schema' })
  assert.equal(runtime.verifyDependencyClosure(root), 2)
})

test('handles nested dependencies and cycles without requiring absent optional packages', async (t) => {
  const { root, manifest } = await fixture(t)
  await manifest('.', { name: 'app', dependencies: { sdk: '1' } })
  await manifest('node_modules/sdk', {
    name: 'sdk',
    dependencies: { schema: '1', platform: '1' },
    optionalDependencies: { platform: '1' }
  })
  await manifest('node_modules/sdk/node_modules/schema', {
    name: 'schema',
    dependencies: { sdk: '1' }
  })
  assert.equal(runtime.verifyDependencyClosure(root), 2)
  await manifest('node_modules/platform', {
    name: 'platform',
    dependencies: { missing: '1' }
  })
  assert.throws(() => runtime.verifyDependencyClosure(root), /platform -> missing/)
})

test('rejects dependency symlinks pointing outside the packaged app', async (t) => {
  const { root, manifest } = await fixture(t)
  await manifest('.', { name: 'app', dependencies: { sdk: '1' } })
  await manifest('../sdk', { name: 'sdk' })
  await mkdir(join(root, 'node_modules'))
  await symlink('../../sdk', join(root, 'node_modules/sdk'))
  assert.throws(() => runtime.verifyDependencyClosure(root), /escapes the app: sdk/)
})

test('the pinned packager retains MCP dependencies from the real pnpm dependency graph', async () => {
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'))
  const { PnpmNodeModulesCollector } = builderRequire(
    'app-builder-lib/out/node-module-collector/pnpmNodeModulesCollector.js'
  )
  const { TmpDir } = libraryRequire('temp-file')
  const temporary = new TmpDir()
  try {
    const appRoot = fileURLToPath(new URL('../../', import.meta.url))
    const collector = new PnpmNodeModulesCollector(appRoot, temporary)
    const { nodeModules } = await collector.getNodeModules({ packageName: 'pichu-client' })
    const names = new Set()
    function collect(modules) {
      for (const module of modules) {
        names.add(module.name)
        collect(module.dependencies || [])
      }
    }
    collect(nodeModules)
    for (const name of ['@modelcontextprotocol/sdk', 'zod-to-json-schema', 'ajv', 'express']) {
      assert.ok(names.has(name), `Production dependency collector omitted ${name}`)
    }
  } finally {
    await temporary.cleanup()
  }
})
