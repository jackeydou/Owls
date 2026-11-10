import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deltaBases,
  feedDate,
  feedEntry,
  planFeedUpdates
} from '../../scripts/release-update-feed.mjs'
import {
  isNewerRelease,
  parseReleaseVersion,
  releaseChannel,
  updateFeedEntrySchema,
  updateFeedUrl
} from '../../src/shared/updates.ts'

const sha = (character) => character.repeat(64)
const entry = (version) => ({
  version,
  name: `Owls ${version}`,
  notes: '',
  pub_date: '2026-11-09T00:00:00Z',
  url: `https://github.com/jackeydou/Owls/releases/download/${version}/Owls-${version}-arm64-mac.zip`,
  sha256: sha('a'),
  size: 1
})

test('isNewerRelease orders stable after its betas, unlike a numeric string compare', () => {
  assert.equal(isNewerRelease('2026.11.900', '2026.11.900-beta.1'), true)
  assert.equal(isNewerRelease('2026.11.900-beta.1', '2026.11.900'), false)
  assert.equal(isNewerRelease('2026.11.900-beta.2', '2026.11.900-beta.1'), true)
  assert.equal(isNewerRelease('2026.11.1000-beta.1', '2026.11.900'), true)
  assert.equal(isNewerRelease('2026.12.100', '2026.11.3100'), true)
  assert.equal(isNewerRelease('2027.1.100', '2026.12.3100'), true)
  assert.equal(isNewerRelease('2026.11.900', '2026.11.900'), false)
  assert.equal(isNewerRelease('2026.11.901', '2026.11.900'), true)
})

test('isNewerRelease never updates to or from an unrecognized version', () => {
  assert.equal(parseReleaseVersion('v2026.11.900'), null)
  assert.equal(parseReleaseVersion('2026.11.900-rc.1'), null)
  assert.equal(isNewerRelease('2027.1.100-rc.1', '2026.11.900'), false)
  assert.equal(isNewerRelease('2027.1.100', '0.0.0-dev'), false)
})

test('releaseChannel follows the beta suffix', () => {
  assert.equal(releaseChannel('2026.11.900-beta.1'), 'beta')
  assert.equal(releaseChannel('2026.11.900'), 'stable')
})

test('updateFeedUrl names one file per channel and architecture on the feed release', () => {
  assert.equal(
    updateFeedUrl('beta', 'arm64'),
    'https://github.com/jackeydou/Owls/releases/download/update-feed/owls-beta-darwin-arm64.json'
  )
})

test('a beta moves only the beta feed', () => {
  const updates = planFeedUpdates('2026.11.900-beta.2', {
    stable: entry('2026.9.801'),
    beta: entry('2026.11.900-beta.1')
  })
  assert.deepEqual(
    updates.map((u) => [u.channel, u.previous?.version]),
    [['beta', '2026.11.900-beta.1']]
  )
})

test('a stable release moves stable, and beta when it is newer than the beta there', () => {
  const updates = planFeedUpdates('2026.11.900', {
    stable: entry('2026.9.801'),
    beta: entry('2026.11.900-beta.2')
  })
  assert.deepEqual(
    updates.map((u) => [u.channel, u.previous?.version]),
    [
      ['stable', '2026.9.801'],
      ['beta', '2026.11.900-beta.2']
    ]
  )
  const behindBeta = planFeedUpdates('2026.11.901', {
    stable: entry('2026.11.900'),
    beta: entry('2026.12.100-beta.1')
  })
  assert.deepEqual(
    behindBeta.map((u) => u.channel),
    ['stable']
  )
})

test('the first feed release has nothing to patch from', () => {
  const updates = planFeedUpdates('2026.11.900-beta.2', { stable: null, beta: null })
  assert.deepEqual(updates, [{ channel: 'beta', previous: null }])
  assert.deepEqual(deltaBases(updates), [])
})

test('a release that is not newer than its channel is refused', () => {
  assert.throws(
    () =>
      planFeedUpdates('2026.11.900-beta.1', { stable: null, beta: entry('2026.11.900-beta.1') }),
    /not newer/
  )
})

test('deltaBases makes one patch per earlier version', () => {
  const bases = deltaBases([
    { channel: 'stable', previous: entry('2026.11.900') },
    { channel: 'beta', previous: entry('2026.11.900') }
  ])
  assert.deepEqual(
    bases.map((base) => base.version),
    ['2026.11.900']
  )
})

test('feedEntry writes a Squirrel.Mac update with an optional patch', () => {
  const zip = { name: 'Owls-2026.11.1000-arm64-mac.zip', sha256: sha('b'), size: 200 }
  const delta = {
    from_version: '2026.11.900',
    url: 'https://github.com/jackeydou/Owls/releases/download/2026.11.1000/Owls-2026.11.900-to-2026.11.1000-arm64.delta',
    sha256: sha('c'),
    size: 20
  }
  const pubDate = feedDate(new Date('2026-11-10T08:30:15.123Z'))
  assert.equal(pubDate, '2026-11-10T08:30:15Z')
  const value = feedEntry({ version: '2026.11.1000', zip, notes: 'Notes', pubDate, delta })
  assert.equal(
    value.url,
    'https://github.com/jackeydou/Owls/releases/download/2026.11.1000/Owls-2026.11.1000-arm64-mac.zip'
  )
  assert.deepEqual(value.delta, delta)
  assert.equal(updateFeedEntrySchema.safeParse(value).success, true)
  assert.equal(
    'delta' in feedEntry({ version: '2026.11.1000', zip, notes: '', pubDate, delta: undefined }),
    false
  )
})
