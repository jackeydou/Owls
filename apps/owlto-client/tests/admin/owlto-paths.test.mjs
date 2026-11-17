import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

async function importSource(path) {
  return import(`${pathToFileURL(path).href}?ts=${Date.now()}-${Math.random()}`)
}

async function loadOwltoPathsForTest() {
  const moduleDir = mkdtempSync(join(tmpdir(), 'owlto-paths-module-'))
  const mainDir = join(moduleDir, 'main')
  const sharedDir = join(moduleDir, 'shared')
  mkdirSync(mainDir, { recursive: true })
  mkdirSync(sharedDir, { recursive: true })

  const source = readFileSync(new URL('../../src/main/owlto-paths.ts', import.meta.url), 'utf8')
    .replace(
      "import { app } from 'electron'\n",
      `const app = {
  getPath(name) {
    if (name !== 'userData') throw new Error('unexpected app path')
    return globalThis.__owltoPathsUserData
  }
}\n`
    )
    .replace('../shared/startup-args.js', '../shared/startup-args.ts')
    .replace("return join(homedir(), '.owlto')", 'return globalThis.__owltoPathsDefaultDataRoot')
    .replace(
      "return join(homedir(), 'Owlto', 'worktrees')",
      'return globalThis.__owltoPathsDefaultWorktreesRoot'
    )

  writeFileSync(join(mainDir, 'owlto-paths.ts'), source, 'utf8')
  writeFileSync(
    join(sharedDir, 'startup-args.ts'),
    readFileSync(new URL('../../src/shared/startup-args.ts', import.meta.url), 'utf8'),
    'utf8'
  )

  return {
    module: await importSource(join(mainDir, 'owlto-paths.ts')),
    cleanup: () => rmSync(moduleDir, { recursive: true, force: true })
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

test('getDataRoot prefers the startup arg, then the profile bootstrap, then its mirror', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owlto-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadOwltoPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    globalThis.__owltoPathsUserData = userData
    globalThis.__owltoPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']
    assert.equal(loaded.module.getDataRoot(), defaultRoot)

    writeJson(join(defaultRoot, 'owlto-bootstrap.json'), { dataRoot: join(root, 'mirror') })
    assert.equal(loaded.module.getDataRoot(), join(root, 'mirror'))

    writeJson(join(userData, 'owlto-bootstrap.json'), { dataRoot: join(root, 'profile-data') })
    assert.equal(loaded.module.getDataRoot(), join(root, 'profile-data'))

    process.argv = ['electron', '--owlto-data-root', join(root, 'arg-data')]
    assert.equal(loaded.module.getDataRoot(), join(root, 'arg-data'))
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owltoPathsUserData
    delete globalThis.__owltoPathsDefaultDataRoot
  }
})

test('a bootstrap pointing into a temporary folder is ignored', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owlto-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadOwltoPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    globalThis.__owltoPathsUserData = userData
    globalThis.__owltoPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']
    writeJson(join(userData, 'owlto-bootstrap.json'), {
      dataRoot: join(realpathSync(tmpdir()), 'owlto-temp-root')
    })
    assert.equal(loaded.module.getDataRoot(), defaultRoot)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owltoPathsUserData
    delete globalThis.__owltoPathsDefaultDataRoot
  }
})

test('workerWorktreesRoot uses the visible folder only for the default data root', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owlto-paths-test-'))
  const loaded = await loadOwltoPathsForTest()
  try {
    const defaultRoot = join(root, '.owlto')
    const visibleRoot = join(root, 'Owlto', 'worktrees')
    globalThis.__owltoPathsDefaultDataRoot = defaultRoot
    globalThis.__owltoPathsDefaultWorktreesRoot = visibleRoot

    assert.equal(loaded.module.workerWorktreesRoot(defaultRoot), visibleRoot)
    assert.equal(loaded.module.workerWorktreesRoot(`${defaultRoot}/`), visibleRoot)
    const isolated = join(root, 'isolated')
    assert.equal(loaded.module.workerWorktreesRoot(isolated), join(isolated, 'worktrees'))
  } finally {
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owltoPathsDefaultDataRoot
    delete globalThis.__owltoPathsDefaultWorktreesRoot
  }
})

test('workspaceHome is ~/Owlto/Workspace only for the default data root', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owlto-paths-test-'))
  const loaded = await loadOwltoPathsForTest()
  try {
    const defaultRoot = join(root, '.owlto')
    globalThis.__owltoPathsDefaultDataRoot = defaultRoot
    assert.equal(loaded.module.workspaceHome(defaultRoot), join(homedir(), 'Owlto', 'Workspace'))
    const isolated = join(root, 'isolated')
    assert.equal(loaded.module.workspaceHome(isolated), join(isolated, 'workspace'))
  } finally {
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owltoPathsDefaultDataRoot
  }
})
