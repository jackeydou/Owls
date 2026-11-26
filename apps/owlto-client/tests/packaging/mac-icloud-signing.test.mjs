import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import icloud from '../../scripts/mac-icloud-signing.cjs'

const base = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../build/entitlements.mac.plist'),
  'utf8'
)

test('iCloud entitlements keep the base ones and name the team, app, and container', () => {
  const plist = icloud.icloudEntitlements(base, 'ABCDE12345', 'dev.owlto.app')
  assert.ok(plist.includes('<key>com.apple.security.cs.allow-jit</key>'))
  assert.ok(plist.includes('<string>ABCDE12345.dev.owlto.app</string>'))
  assert.match(
    plist,
    /<key>com\.apple\.developer\.ubiquity-container-identifiers<\/key>\s*<array><string>iCloud\.dev\.owlto\.app<\/string><\/array>/
  )
  assert.match(plist, /<string>CloudDocuments<\/string>/)
  assert.equal(plist.trim().endsWith('</plist>'), true)
  assert.equal(plist.match(/<dict>/g).length, 1, 'keys go into the one top-level dict')
  assert.throws(() => icloud.icloudEntitlements(base, 'not a team', 'dev.owlto.app'))
})

test('a build without a provisioning profile signs as before', () => {
  assert.equal(
    icloud.icloudSigning({ profile: undefined, teamId: 'ABCDE12345', appId: 'dev.owlto.app' }),
    null
  )
  assert.equal(
    icloud.icloudSigning({ profile: '/x', teamId: undefined, appId: 'dev.owlto.app' }),
    null
  )
  assert.throws(() =>
    icloud.icloudSigning({ profile: '/nope.provisionprofile', teamId: 'ABCDE12345', appId: 'a' })
  )
})

test('the container in the Info.plist is the one the app asks iCloud for', () => {
  const runtime = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/main/cards/icloud.ts'),
    'utf8'
  )
  assert.ok(runtime.includes(`'${icloud.ICLOUD_CONTAINER}'`))
  assert.ok(icloud.icloudInfoPlist().NSUbiquitousContainers[icloud.ICLOUD_CONTAINER])
})

test('the packaged app carries the iCloud helper, which electron-builder skips by itself', async () => {
  const { default: config } = await import('../../scripts/electron-builder-config.cjs')
  const helper = config.files.find(
    (entry) => typeof entry === 'object' && entry.to === 'node_modules/@owlto/mac-icloud'
  )
  assert.ok(helper, 'files must copy @owlto/mac-icloud into the app')
  assert.deepEqual(helper.filter, ['package.json', 'index.js', '*.node'])
  assert.ok(config.asarUnpack.includes('**/*.node'))
})

test('Info.plist keys sit at the top level, where macOS reads them', async () => {
  const { default: config } = await import('../../scripts/electron-builder-config.cjs')
  const extendInfo = config.mac.extendInfo
  // electron-builder merges extendInfo with Object.assign: an array would add keys "0", "1", ...
  assert.ok(extendInfo && typeof extendInfo === 'object' && !Array.isArray(extendInfo))
  assert.equal(extendInfo.LSMultipleInstancesProhibited, true)
  assert.equal(typeof extendInfo.NSLocalNetworkUsageDescription, 'string')
  assert.deepEqual(
    extendInfo.NSUbiquitousContainers,
    icloud.icloudInfoPlist().NSUbiquitousContainers
  )
})
