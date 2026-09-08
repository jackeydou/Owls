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
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

async function importSource(path) {
  return import(`${pathToFileURL(path).href}?ts=${Date.now()}-${Math.random()}`)
}

async function loadPichuPathsForTest() {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-paths-module-'))
  const mainDir = join(moduleDir, 'main')
  const sharedDir = join(moduleDir, 'shared')
  mkdirSync(mainDir, { recursive: true })
  mkdirSync(sharedDir, { recursive: true })

  const source = readFileSync(new URL('../../src/main/pichu-paths.ts', import.meta.url), 'utf8')
    .replace(
      "import { app } from 'electron'\n",
      `const app = {
  getPath(name) {
    if (name !== 'userData') throw new Error('unexpected app path')
    return globalThis.__pichuPathsUserData
  },
  relaunch() {
    globalThis.__pichuPathsRelaunched = true
  },
  exit(code) {
    globalThis.__pichuPathsExitCode = code
  }
}\n`
    )
    .replace('../shared/startup-args.js', '../shared/startup-args.ts')
    .replace("return join(homedir(), '.pichu')", 'return globalThis.__pichuPathsDefaultDataRoot')

  writeFileSync(join(mainDir, 'pichu-paths.ts'), source, 'utf8')
  writeFileSync(
    join(sharedDir, 'startup-args.ts'),
    readFileSync(new URL('../../src/shared/startup-args.ts', import.meta.url), 'utf8'),
    'utf8'
  )

  return {
    module: await importSource(join(mainDir, 'pichu-paths.ts')),
    cleanup: () => rmSync(moduleDir, { recursive: true, force: true })
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

test('getDataRoot reads persisted bootstrap from Electron userData', async () => {
  const root = mkdtempSync(join(process.cwd(), '.pichu-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadPichuPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    const persistedRoot = join(root, 'persisted-data')
    globalThis.__pichuPathsUserData = userData
    globalThis.__pichuPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    writeJson(join(userData, 'pichu-bootstrap.json'), { dataRoot: persistedRoot })

    assert.equal(loaded.module.getDataRoot(), persistedRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.deepEqual(JSON.parse(readFileSync(join(userData, 'pichu-bootstrap.json'), 'utf8')), {
      dataRoot: persistedRoot
    })
    assert.deepEqual(JSON.parse(readFileSync(join(defaultRoot, 'pichu-bootstrap.json'), 'utf8')), {
      dataRoot: persistedRoot
    })
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__pichuPathsUserData
    delete globalThis.__pichuPathsDefaultDataRoot
  }
})

test('migrateLegacyDataRoot copies existing data and renames persisted product files', async () => {
  const root = mkdtempSync(join(process.cwd(), '.pichu-paths-test-'))
  const loaded = await loadPichuPathsForTest()
  try {
    const legacyRoot = join(root, 'legacy-data')
    const currentRoot = join(root, 'current-data')
    mkdirSync(legacyRoot, { recursive: true })
    writeFileSync(join(legacyRoot, 'pix.db'), 'database')
    writeFileSync(join(legacyRoot, 'pix-settings.json'), '{}')
    writeFileSync(join(legacyRoot, 'attachment.txt'), 'kept')

    loaded.module.migrateLegacyDataRoot(legacyRoot, currentRoot)

    assert.equal(readFileSync(join(currentRoot, 'pichu.db'), 'utf8'), 'database')
    assert.equal(readFileSync(join(currentRoot, 'pichu-settings.json'), 'utf8'), '{}')
    assert.equal(readFileSync(join(currentRoot, 'attachment.txt'), 'utf8'), 'kept')
    assert.equal(existsSync(join(currentRoot, 'pix.db')), false)
    assert.equal(existsSync(join(currentRoot, 'pix-settings.json')), false)
  } finally {
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
  }
})

test('writeBootstrapIfMissing migrates a non-temporary legacy bootstrap into userData', async () => {
  const root = mkdtempSync(join(process.cwd(), '.pichu-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadPichuPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    const legacyRoot = join(root, 'legacy-data')
    globalThis.__pichuPathsUserData = userData
    globalThis.__pichuPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    writeJson(join(defaultRoot, 'pichu-bootstrap.json'), { dataRoot: legacyRoot })

    assert.equal(loaded.module.getDataRoot(), legacyRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.deepEqual(JSON.parse(readFileSync(join(userData, 'pichu-bootstrap.json'), 'utf8')), {
      dataRoot: legacyRoot
    })
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__pichuPathsUserData
    delete globalThis.__pichuPathsDefaultDataRoot
  }
})

test('temporary legacy bootstrap roots are ignored instead of migrated', async () => {
  const root = mkdtempSync(join(process.cwd(), '.pichu-paths-test-'))
  const sideIpcRoot = mkdtempSync(join(tmpdir(), 'pichu-side-ipc-'))
  const previousArgv = process.argv
  const loaded = await loadPichuPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    globalThis.__pichuPathsUserData = userData
    globalThis.__pichuPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    writeJson(join(defaultRoot, 'pichu-bootstrap.json'), {
      dataRoot: join(sideIpcRoot, 'data')
    })

    assert.equal(loaded.module.getDataRoot(), defaultRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.deepEqual(JSON.parse(readFileSync(join(userData, 'pichu-bootstrap.json'), 'utf8')), {
      dataRoot: defaultRoot
    })
    assert.equal(existsSync(join(defaultRoot, 'pichu-bootstrap.json')), false)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    rmSync(sideIpcRoot, { recursive: true, force: true })
    delete globalThis.__pichuPathsUserData
    delete globalThis.__pichuPathsDefaultDataRoot
  }
})

test('profile bootstrap default removes stale legacy bootstrap mirrors', async () => {
  const root = mkdtempSync(join(process.cwd(), '.pichu-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadPichuPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    const staleRoot = join(root, 'stale-data')
    globalThis.__pichuPathsUserData = userData
    globalThis.__pichuPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    writeJson(join(userData, 'pichu-bootstrap.json'), { dataRoot: defaultRoot })
    writeJson(join(defaultRoot, 'pichu-bootstrap.json'), { dataRoot: staleRoot })

    assert.equal(loaded.module.getDataRoot(), defaultRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.equal(existsSync(join(defaultRoot, 'pichu-bootstrap.json')), false)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__pichuPathsUserData
    delete globalThis.__pichuPathsDefaultDataRoot
  }
})

test('startup data-root args are process-local and are not persisted', async () => {
  const root = mkdtempSync(join(process.cwd(), '.pichu-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadPichuPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    const argRoot = join(tmpdir(), 'pichu-side-ipc-test', 'data')
    globalThis.__pichuPathsUserData = userData
    globalThis.__pichuPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron', '--pichu-data-root', argRoot]

    assert.equal(loaded.module.getDataRoot(), argRoot)
    loaded.module.writeBootstrapIfMissing()
    assert.equal(existsSync(join(userData, 'pichu-bootstrap.json')), false)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__pichuPathsUserData
    delete globalThis.__pichuPathsDefaultDataRoot
  }
})

test('applyNewDataRoot rejects temporary folders before writing bootstrap', async () => {
  const root = mkdtempSync(join(process.cwd(), '.pichu-paths-test-'))
  const tempRoot = mkdtempSync(join(tmpdir(), 'pichu-settings-root-'))
  const previousArgv = process.argv
  const loaded = await loadPichuPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    globalThis.__pichuPathsUserData = userData
    globalThis.__pichuPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    assert.throws(
      () => loaded.module.applyNewDataRoot(join(tempRoot, 'data')),
      /Temporary folders cannot be saved as the Owls data root/
    )
    assert.equal(existsSync(join(userData, 'pichu-bootstrap.json')), false)
    assert.equal(globalThis.__pichuPathsRelaunched, undefined)
    assert.equal(globalThis.__pichuPathsExitCode, undefined)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    rmSync(tempRoot, { recursive: true, force: true })
    delete globalThis.__pichuPathsUserData
    delete globalThis.__pichuPathsDefaultDataRoot
    delete globalThis.__pichuPathsRelaunched
    delete globalThis.__pichuPathsExitCode
  }
})

test('applyNewDataRoot rejects realpath aliases of temporary folders', async () => {
  const root = mkdtempSync(join(process.cwd(), '.pichu-paths-test-'))
  const previousArgv = process.argv
  const loaded = await loadPichuPathsForTest()
  try {
    const userData = join(root, 'profile')
    const defaultRoot = join(root, 'default-data')
    globalThis.__pichuPathsUserData = userData
    globalThis.__pichuPathsDefaultDataRoot = defaultRoot
    process.argv = ['electron']

    assert.throws(
      () =>
        loaded.module.applyNewDataRoot(join(realpathSync(tmpdir()), 'pichu-settings-root-alias')),
      /Temporary folders cannot be saved as the Owls data root/
    )
    assert.equal(existsSync(join(userData, 'pichu-bootstrap.json')), false)
  } finally {
    process.argv = previousArgv
    loaded.cleanup()
    rmSync(root, { recursive: true, force: true })
    delete globalThis.__pichuPathsUserData
    delete globalThis.__pichuPathsDefaultDataRoot
  }
})
