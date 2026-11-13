import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { OPEN_IN_CATALOG, OpenInApps, settingsSchema } = require('../../out/main/app/runtime.js')

/** A fake Mac: `files` are the app bundles on disk, `spotlight` maps bundle ids to paths. */
function fakeMac({ files = [], spotlight = {}, folders = ['/repo'], platform = 'darwin' } = {}) {
  const opened = []
  const os = {
    platform,
    home: '/Users/me',
    exists: async (path) => files.includes(path),
    spotlight: async (bundleId) => spotlight[bundleId] ?? [],
    icon: async (path) => `data:image/png;base64,${Buffer.from(path).toString('base64')}`,
    isFolder: async (path) => folders.includes(path),
    open: async (appPath, folder) => {
      opened.push([appPath, folder])
    }
  }
  return { os, opened }
}

test('only installed apps are listed, in catalog order, with their own icons', async () => {
  const { os } = fakeMac({
    files: [
      '/System/Library/CoreServices/Finder.app',
      '/Applications/Cursor.app',
      '/Users/me/Applications/Zed.app',
      '/System/Applications/Utilities/Terminal.app'
    ],
    spotlight: { 'com.jetbrains.goland': ['/Users/me/Applications/JetBrains Toolbox/GoLand.app'] }
  })
  const apps = await new OpenInApps(os).list()
  assert.deepEqual(
    apps.map((app) => app.id),
    ['cursor', 'zed', 'goland', 'finder', 'terminal']
  )
  assert.deepEqual(
    apps.map((app) => app.kind),
    ['editor', 'editor', 'editor', 'files', 'terminal']
  )
  assert.ok(apps.every((app) => app.icon?.startsWith('data:image/png;base64,')))
})

test('other platforms get no apps', async () => {
  const { os } = fakeMac({ files: ['/Applications/Cursor.app'], platform: 'linux' })
  assert.deepEqual(await new OpenInApps(os).list(), [])
})

test('opens the folder with the installed app bundle', async () => {
  const { os, opened } = fakeMac({ files: ['/Applications/Ghostty.app'] })
  await new OpenInApps(os).open('ghostty', '/repo')
  assert.deepEqual(opened, [['/Applications/Ghostty.app', '/repo']])
})

test('refuses a missing folder or an app that is not installed', async () => {
  const { os, opened } = fakeMac({ files: ['/Applications/Cursor.app'] })
  const apps = new OpenInApps(os)
  await assert.rejects(apps.open('cursor', '/gone'), { code: 'request_unavailable' })
  await assert.rejects(apps.open('xcode', '/repo'), { code: 'request_unavailable' })
  assert.deepEqual(opened, [])
})

test('an app installed after the first scan is found when it is picked', async () => {
  const files = []
  const { os, opened } = fakeMac({ files })
  const apps = new OpenInApps(os)
  assert.deepEqual(await apps.list(), [])
  files.push('/Applications/Visual Studio Code.app')
  await apps.open('vscode', '/repo')
  assert.deepEqual(opened, [['/Applications/Visual Studio Code.app', '/repo']])
})

test('catalog ids are unique', () => {
  const ids = OPEN_IN_CATALOG.map((entry) => entry.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('saved settings without a choice, or with an unknown app, fall back to none', () => {
  const field = settingsSchema.shape.openInApp
  assert.equal(field.parse(undefined), null)
  assert.equal(field.parse('notepad'), null)
  assert.equal(field.parse('zed'), 'zed')
})
