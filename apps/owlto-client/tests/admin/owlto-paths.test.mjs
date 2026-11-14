import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
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
  },
  relaunch() {
    globalThis.__owltoPathsRelaunched = true
  },
  exit(code) {
    globalThis.__owltoPathsExitCode = code
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

test('getDataRoot reads persisted bootstrap from Electron userData', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owlto-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadOwltoPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    const persistedRoot = join(root, 'persisted-data')
    globalThis.__owltoPathsUserData = userData
    globalThis.__owltoPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    writeJson(join(userData, 'owlto-bootstrap.json'), { dataRoot: persistedRoot })

    assert.equal(loaded.module.getDataRoot(), persistedRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.deepEqual(JSON.parse(readFileSync(join(userData, 'owlto-bootstrap.json'), 'utf8')), {
      dataRoot: persistedRoot
    })
    assert.deepEqual(JSON.parse(readFileSync(join(defaultRoot, 'owlto-bootstrap.json'), 'utf8')), {
      dataRoot: persistedRoot
    })
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owltoPathsUserData
    delete globalThis.__owltoPathsDefaultDataRoot
  }
})

test('writeBootstrapIfMissing migrates a non-temporary legacy bootstrap into userData', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owlto-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadOwltoPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    const legacyRoot = join(root, 'legacy-data')
    globalThis.__owltoPathsUserData = userData
    globalThis.__owltoPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    writeJson(join(defaultRoot, 'owlto-bootstrap.json'), { dataRoot: legacyRoot })

    assert.equal(loaded.module.getDataRoot(), legacyRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.deepEqual(JSON.parse(readFileSync(join(userData, 'owlto-bootstrap.json'), 'utf8')), {
      dataRoot: legacyRoot
    })
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owltoPathsUserData
    delete globalThis.__owltoPathsDefaultDataRoot
  }
})

test('temporary legacy bootstrap roots are ignored instead of migrated', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owlto-paths-test-'))
  const sideIpcRoot = mkdtempSync(join(tmpdir(), 'owlto-side-ipc-'))
  const previousArgv = process.argv
  const loaded = await loadOwltoPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    globalThis.__owltoPathsUserData = userData
    globalThis.__owltoPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    writeJson(join(defaultRoot, 'owlto-bootstrap.json'), {
      dataRoot: join(sideIpcRoot, 'data')
    })

    assert.equal(loaded.module.getDataRoot(), defaultRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.deepEqual(JSON.parse(readFileSync(join(userData, 'owlto-bootstrap.json'), 'utf8')), {
      dataRoot: defaultRoot
    })
    assert.equal(existsSync(join(defaultRoot, 'owlto-bootstrap.json')), false)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    rmSync(sideIpcRoot, { recursive: true, force: true })
    delete globalThis.__owltoPathsUserData
    delete globalThis.__owltoPathsDefaultDataRoot
  }
})

test('profile bootstrap default removes stale legacy bootstrap mirrors', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owlto-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadOwltoPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    const staleRoot = join(root, 'stale-data')
    globalThis.__owltoPathsUserData = userData
    globalThis.__owltoPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    writeJson(join(userData, 'owlto-bootstrap.json'), { dataRoot: defaultRoot })
    writeJson(join(defaultRoot, 'owlto-bootstrap.json'), { dataRoot: staleRoot })

    assert.equal(loaded.module.getDataRoot(), defaultRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.equal(existsSync(join(defaultRoot, 'owlto-bootstrap.json')), false)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owltoPathsUserData
    delete globalThis.__owltoPathsDefaultDataRoot
  }
})

test('startup data-root args are process-local and are not persisted', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owlto-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadOwltoPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    const argRoot = join(tmpdir(), 'owlto-side-ipc-test', 'data')
    globalThis.__owltoPathsUserData = userData
    globalThis.__owltoPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron', '--owlto-data-root', argRoot]

    assert.equal(loaded.module.getDataRoot(), argRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.equal(existsSync(join(userData, 'owlto-bootstrap.json')), false)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owltoPathsUserData
    delete globalThis.__owltoPathsDefaultDataRoot
  }
})

test('applyNewDataRoot rejects temporary folders before writing bootstrap', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owlto-paths-test-'))
  const tempRoot = mkdtempSync(join(tmpdir(), 'owlto-settings-root-'))
  const previousArgv = process.argv
  const loaded = await loadOwltoPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    globalThis.__owltoPathsUserData = userData
    globalThis.__owltoPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    assert.throws(
      () => loaded.module.applyNewDataRoot(join(tempRoot, 'data')),
      /Temporary folders cannot be saved as the Owlto data root/
    )
    assert.equal(existsSync(join(userData, 'owlto-bootstrap.json')), false)
    assert.equal(globalThis.__owltoPathsRelaunched, undefined)
    assert.equal(globalThis.__owltoPathsExitCode, undefined)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    rmSync(tempRoot, { recursive: true, force: true })
    delete globalThis.__owltoPathsUserData
    delete globalThis.__owltoPathsDefaultDataRoot
    delete globalThis.__owltoPathsRelaunched
    delete globalThis.__owltoPathsExitCode
  }
})

test('applyNewDataRoot rejects realpath aliases of temporary folders', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owlto-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadOwltoPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    globalThis.__owltoPathsUserData = userData
    globalThis.__owltoPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    assert.throws(
      () =>
        loaded.module.applyNewDataRoot(join(realpathSync(tmpdir()), 'owlto-settings-root-alias')),
      /Temporary folders cannot be saved as the Owlto data root/
    )
    assert.equal(existsSync(join(userData, 'owlto-bootstrap.json')), false)
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
