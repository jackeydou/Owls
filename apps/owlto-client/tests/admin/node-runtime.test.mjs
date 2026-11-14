import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

async function importSource(path) {
  const href = path instanceof URL ? path.href : pathToFileURL(path).href
  return import(`${href}?ts=${Date.now()}`)
}

function setTestResourcesPath(resourcesPath) {
  Object.defineProperty(process, 'resourcesPath', {
    value: resourcesPath,
    configurable: true,
    writable: true
  })
}

test('bundled node discovery ignores unusable resource candidates', async () => {
  const resourcesRoot = mkdtempSync(join(tmpdir(), 'owlto-node-runtime-test-'))
  const originalResourcesPath = process.resourcesPath

  try {
    const invalidNodePath = join(
      resourcesRoot,
      'node',
      `${process.platform}-${process.arch}`,
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node'
    )
    mkdirSync(dirname(invalidNodePath), { recursive: true })
    writeFileSync(
      invalidNodePath,
      ['version https://git-lfs.github.com/spec/v1', 'oid sha256:test', 'size 1', ''].join('\n'),
      'utf8'
    )
    chmodSync(invalidNodePath, 0o755)
    setTestResourcesPath(resourcesRoot)

    const nodeRuntime = await importSource(
      new URL('../../src/main/node-runtime.ts', import.meta.url)
    )
    const nodePath = nodeRuntime.findBundledNodePath()

    assert.notEqual(nodePath, invalidNodePath)
    if (nodePath) {
      assert.match(execFileSync(nodePath, ['--version'], { encoding: 'utf8' }).trim(), /^v\d+/)
    }
  } finally {
    if (originalResourcesPath === undefined) {
      delete process.resourcesPath
    } else {
      process.resourcesPath = originalResourcesPath
    }
    rmSync(resourcesRoot, { recursive: true, force: true })
  }
})

test('bundled node discovery times out hanging resource candidates', async () => {
  if (process.platform === 'win32') {
    return
  }

  const resourcesRoot = mkdtempSync(join(tmpdir(), 'owlto-node-runtime-hang-test-'))
  const originalResourcesPath = process.resourcesPath

  try {
    const hangingNodePath = join(
      resourcesRoot,
      'node',
      `${process.platform}-${process.arch}`,
      'bin',
      'node'
    )
    mkdirSync(dirname(hangingNodePath), { recursive: true })
    writeFileSync(hangingNodePath, '#!/bin/sh\nsleep 10\n', 'utf8')
    chmodSync(hangingNodePath, 0o755)
    setTestResourcesPath(resourcesRoot)

    const startedAt = Date.now()
    const nodeRuntime = await importSource(
      new URL('../../src/main/node-runtime.ts', import.meta.url)
    )
    const nodePath = nodeRuntime.findBundledNodePath()
    const elapsedMs = Date.now() - startedAt

    assert.notEqual(nodePath, hangingNodePath)
    assert.ok(
      elapsedMs < 4000,
      `expected hanging candidate to time out quickly, got ${elapsedMs}ms`
    )
  } finally {
    if (originalResourcesPath === undefined) {
      delete process.resourcesPath
    } else {
      process.resourcesPath = originalResourcesPath
    }
    rmSync(resourcesRoot, { recursive: true, force: true })
  }
})
