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

async function loadOwlsPathsForTest() {
  const moduleDir = mkdtempSync(join(tmpdir(), 'owls-paths-module-'))
  const mainDir = join(moduleDir, 'main')
  const sharedDir = join(moduleDir, 'shared')
  mkdirSync(mainDir, { recursive: true })
  mkdirSync(sharedDir, { recursive: true })

  const source = readFileSync(new URL('../../src/main/owls-paths.ts', import.meta.url), 'utf8')
    .replace(
      "import { app } from 'electron'\n",
      `const app = {
  getPath(name) {
    if (name !== 'userData') throw new Error('unexpected app path')
    return globalThis.__owlsPathsUserData
  },
  relaunch() {
    globalThis.__owlsPathsRelaunched = true
  },
  exit(code) {
    globalThis.__owlsPathsExitCode = code
  }
}\n`
    )
    .replace('../shared/startup-args.js', '../shared/startup-args.ts')
    .replace("return join(homedir(), '.owls')", 'return globalThis.__owlsPathsDefaultDataRoot')
    .replace(
      "return join(homedir(), 'Owls', 'worktrees')",
      'return globalThis.__owlsPathsDefaultWorktreesRoot'
    )

  writeFileSync(join(mainDir, 'owls-paths.ts'), source, 'utf8')
  writeFileSync(
    join(sharedDir, 'startup-args.ts'),
    readFileSync(new URL('../../src/shared/startup-args.ts', import.meta.url), 'utf8'),
    'utf8'
  )

  return {
    module: await importSource(join(mainDir, 'owls-paths.ts')),
    cleanup: () => rmSync(moduleDir, { recursive: true, force: true })
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

test('getDataRoot reads persisted bootstrap from Electron userData', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owls-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadOwlsPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    const persistedRoot = join(root, 'persisted-data')
    globalThis.__owlsPathsUserData = userData
    globalThis.__owlsPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    writeJson(join(userData, 'owls-bootstrap.json'), { dataRoot: persistedRoot })

    assert.equal(loaded.module.getDataRoot(), persistedRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.deepEqual(JSON.parse(readFileSync(join(userData, 'owls-bootstrap.json'), 'utf8')), {
      dataRoot: persistedRoot
    })
    assert.deepEqual(JSON.parse(readFileSync(join(defaultRoot, 'owls-bootstrap.json'), 'utf8')), {
      dataRoot: persistedRoot
    })
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owlsPathsUserData
    delete globalThis.__owlsPathsDefaultDataRoot
  }
})

test('writeBootstrapIfMissing migrates a non-temporary legacy bootstrap into userData', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owls-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadOwlsPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    const legacyRoot = join(root, 'legacy-data')
    globalThis.__owlsPathsUserData = userData
    globalThis.__owlsPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    writeJson(join(defaultRoot, 'owls-bootstrap.json'), { dataRoot: legacyRoot })

    assert.equal(loaded.module.getDataRoot(), legacyRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.deepEqual(JSON.parse(readFileSync(join(userData, 'owls-bootstrap.json'), 'utf8')), {
      dataRoot: legacyRoot
    })
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owlsPathsUserData
    delete globalThis.__owlsPathsDefaultDataRoot
  }
})

test('temporary legacy bootstrap roots are ignored instead of migrated', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owls-paths-test-'))
  const sideIpcRoot = mkdtempSync(join(tmpdir(), 'owls-side-ipc-'))
  const previousArgv = process.argv
  const loaded = await loadOwlsPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    globalThis.__owlsPathsUserData = userData
    globalThis.__owlsPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    writeJson(join(defaultRoot, 'owls-bootstrap.json'), {
      dataRoot: join(sideIpcRoot, 'data')
    })

    assert.equal(loaded.module.getDataRoot(), defaultRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.deepEqual(JSON.parse(readFileSync(join(userData, 'owls-bootstrap.json'), 'utf8')), {
      dataRoot: defaultRoot
    })
    assert.equal(existsSync(join(defaultRoot, 'owls-bootstrap.json')), false)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    rmSync(sideIpcRoot, { recursive: true, force: true })
    delete globalThis.__owlsPathsUserData
    delete globalThis.__owlsPathsDefaultDataRoot
  }
})

test('profile bootstrap default removes stale legacy bootstrap mirrors', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owls-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadOwlsPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    const staleRoot = join(root, 'stale-data')
    globalThis.__owlsPathsUserData = userData
    globalThis.__owlsPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    writeJson(join(userData, 'owls-bootstrap.json'), { dataRoot: defaultRoot })
    writeJson(join(defaultRoot, 'owls-bootstrap.json'), { dataRoot: staleRoot })

    assert.equal(loaded.module.getDataRoot(), defaultRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.equal(existsSync(join(defaultRoot, 'owls-bootstrap.json')), false)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owlsPathsUserData
    delete globalThis.__owlsPathsDefaultDataRoot
  }
})

test('startup data-root args are process-local and are not persisted', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owls-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadOwlsPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    const argRoot = join(tmpdir(), 'owls-side-ipc-test', 'data')
    globalThis.__owlsPathsUserData = userData
    globalThis.__owlsPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron', '--owls-data-root', argRoot]

    assert.equal(loaded.module.getDataRoot(), argRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.equal(existsSync(join(userData, 'owls-bootstrap.json')), false)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owlsPathsUserData
    delete globalThis.__owlsPathsDefaultDataRoot
  }
})

test('applyNewDataRoot rejects temporary folders before writing bootstrap', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owls-paths-test-'))
  const tempRoot = mkdtempSync(join(tmpdir(), 'owls-settings-root-'))
  const previousArgv = process.argv
  const loaded = await loadOwlsPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    globalThis.__owlsPathsUserData = userData
    globalThis.__owlsPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    assert.throws(
      () => loaded.module.applyNewDataRoot(join(tempRoot, 'data')),
      /Temporary folders cannot be saved as the Owls data root/
    )
    assert.equal(existsSync(join(userData, 'owls-bootstrap.json')), false)
    assert.equal(globalThis.__owlsPathsRelaunched, undefined)
    assert.equal(globalThis.__owlsPathsExitCode, undefined)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    rmSync(tempRoot, { recursive: true, force: true })
    delete globalThis.__owlsPathsUserData
    delete globalThis.__owlsPathsDefaultDataRoot
    delete globalThis.__owlsPathsRelaunched
    delete globalThis.__owlsPathsExitCode
  }
})

test('applyNewDataRoot rejects realpath aliases of temporary folders', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owls-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadOwlsPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    globalThis.__owlsPathsUserData = userData
    globalThis.__owlsPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    assert.throws(
      () =>
        loaded.module.applyNewDataRoot(join(realpathSync(tmpdir()), 'owls-settings-root-alias')),
      /Temporary folders cannot be saved as the Owls data root/
    )
    assert.equal(existsSync(join(userData, 'owls-bootstrap.json')), false)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owlsPathsUserData
    delete globalThis.__owlsPathsDefaultDataRoot
  }
})

test('workerWorktreesRoot uses the visible folder only for the default data root', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owls-paths-test-'))
  const loaded = await loadOwlsPathsForTest()
  try {
    const defaultRoot = join(root, '.owls')
    const visibleRoot = join(root, 'Owls', 'worktrees')
    globalThis.__owlsPathsDefaultDataRoot = defaultRoot
    globalThis.__owlsPathsDefaultWorktreesRoot = visibleRoot

    assert.equal(loaded.module.workerWorktreesRoot(defaultRoot), visibleRoot)
    assert.equal(loaded.module.workerWorktreesRoot(`${defaultRoot}/`), visibleRoot)
    const isolated = join(root, 'isolated')
    assert.equal(loaded.module.workerWorktreesRoot(isolated), join(isolated, 'worktrees'))
  } finally {
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owlsPathsDefaultDataRoot
    delete globalThis.__owlsPathsDefaultWorktreesRoot
  }
})

test('workspaceHome is ~/Owls/Workspace only for the default data root', async () => {
  const root = mkdtempSync(join(process.cwd(), '.owls-paths-test-'))
  const loaded = await loadOwlsPathsForTest()
  try {
    const defaultRoot = join(root, '.owls')
    globalThis.__owlsPathsDefaultDataRoot = defaultRoot
    assert.equal(loaded.module.workspaceHome(defaultRoot), join(homedir(), 'Owls', 'Workspace'))
    const isolated = join(root, 'isolated')
    assert.equal(loaded.module.workspaceHome(isolated), join(isolated, 'workspace'))
  } finally {
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__owlsPathsDefaultDataRoot
  }
})
