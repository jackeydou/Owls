import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { fetchGitHubAvatar, UserProfile } = require('../../out/main/app/runtime.js')

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const owlProfile = () => ({ name: null, avatar: { kind: 'owl' }, avatarChanged: false })

/** A profile over an in-memory settings record, with a fake GitHub avatar request. */
function profileHarness({ token = 'token', avatar = { login: 'octo', src: PNG } } = {}) {
  let settings = { theme: 'system', profile: owlProfile() }
  const changes = []
  let requests = 0
  const profile = new UserProfile({
    settings: () => settings,
    save: (next) => {
      settings = next
      return next
    },
    gitHubToken: async () => token,
    fetchAvatar: async () => {
      requests++
      if (avatar instanceof Error) throw avatar
      return avatar
    },
    changed: (value) => changes.push(value)
  })
  return {
    profile,
    changes,
    settings: () => settings,
    requests: () => requests
  }
}

test('a GitHub connection replaces the untouched default owl once', async () => {
  const harness = profileHarness()
  await harness.profile.gitHubConnected()
  assert.deepEqual(harness.settings().profile.avatar, { kind: 'github', login: 'octo', src: PNG })
  assert.equal(harness.settings().profile.avatarChanged, false)
  assert.equal(harness.changes.length, 1)
  assert.equal(harness.settings().theme, 'system')
  await harness.profile.gitHubConnected()
  assert.equal(harness.requests(), 1)
})

test('a GitHub connection leaves an uploaded or reset avatar alone', async () => {
  const uploaded = profileHarness()
  uploaded.profile.update({ avatar: { kind: 'upload', src: PNG } })
  await uploaded.profile.gitHubConnected()
  assert.equal(uploaded.settings().profile.avatar.kind, 'upload')

  const reset = profileHarness()
  reset.profile.update({ avatar: { kind: 'owl' } })
  assert.equal(reset.settings().profile.avatarChanged, true)
  await reset.profile.gitHubConnected()
  assert.equal(reset.settings().profile.avatar.kind, 'owl')
  assert.equal(reset.requests(), 0)
})

test('a failed GitHub request keeps the owl and tries again later', async () => {
  const harness = profileHarness({ avatar: new Error('offline') })
  await harness.profile.gitHubConnected()
  assert.equal(harness.settings().profile.avatar.kind, 'owl')
  await harness.profile.gitHubConnected()
  assert.equal(harness.requests(), 2)
  assert.equal(harness.changes.length, 0)
})

test('asking for the GitHub avatar counts as the user choosing it', async () => {
  const harness = profileHarness()
  harness.profile.update({ avatar: { kind: 'upload', src: PNG } })
  const saved = await harness.profile.applyGitHubAvatar()
  assert.equal(saved.profile.avatar.kind, 'github')
  assert.equal(saved.profile.avatarChanged, true)

  const signedOut = profileHarness({ token: null })
  await assert.rejects(signedOut.profile.applyGitHubAvatar(), { code: 'avatar_unavailable' })
})

test('names are trimmed, blank goes back to the default, and bad input is refused', () => {
  const harness = profileHarness()
  harness.profile.update({ name: '  Yan  ' })
  assert.equal(harness.settings().profile.name, 'Yan')
  harness.profile.update({ name: '   ' })
  assert.equal(harness.settings().profile.name, null)
  assert.throws(() => harness.profile.update({ name: 'x'.repeat(41) }))
  assert.throws(() =>
    harness.profile.update({ avatar: { kind: 'upload', src: 'https://x/y.png' } })
  )
  assert.throws(() => harness.profile.update({ avatar: { kind: 'github', login: 'a', src: PNG } }))
})

test('the GitHub avatar is read from the API and fetched without the token', async () => {
  const calls = []
  const http = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.Authorization ?? null })
    if (String(url) === 'https://api.github.com/user')
      return new Response(
        JSON.stringify({
          login: 'octo',
          avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4'
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { 'content-type': 'image/png' }
    })
  }
  const avatar = await fetchGitHubAvatar('secret', http)
  assert.equal(avatar.login, 'octo')
  assert.equal(avatar.src, 'data:image/png;base64,iVBORw==')
  assert.equal(calls[0].auth, 'Bearer secret')
  assert.equal(calls[1].url, 'https://avatars.githubusercontent.com/u/1?v=4&s=128')
  assert.equal(calls[1].auth, null)
})

test('an avatar URL off GitHub is refused', async () => {
  const http = async () =>
    new Response(JSON.stringify({ login: 'octo', avatar_url: 'https://example.com/a.png' }), {
      headers: { 'content-type': 'application/json' }
    })
  await assert.rejects(fetchGitHubAvatar('secret', http), /Unexpected avatar host/)
})
