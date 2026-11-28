#!/usr/bin/env node
/**
 * Ships the iOS app to TestFlight external testers in one command: archive, upload, wait for
 * Apple to process the build, fill in "What to Test", submit it for Beta App Review, and add it
 * to the external group.
 *
 *   pnpm ios:testflight --notes "What changed in this build"
 *   pnpm ios:testflight --build 12 --notes "..."   # distribute a build that is already uploaded
 *   pnpm ios:testflight --upload-only               # stop after the upload
 *
 * Signing and the upload use the Apple ID that Xcode is signed in to (Xcode → Settings →
 * Accounts), with automatic cloud signing. An API key cannot do that part unless it has the
 * Admin role, so the key here only drives the App Store Connect API. Setup, once:
 *
 *   1. App Store Connect → Users and Access → Integrations → App Store Connect API: create a
 *      key with the App Manager role and save it as
 *      ~/.appstoreconnect/private_keys/AuthKey_<KEY ID>.p8
 *   2. Write ~/.appstoreconnect/owlto-testflight.json:
 *      { "keyId": "...", "issuerId": "...", "group": "<external group name>" }
 *
 * The build number is not stored in the project: each run takes the highest build number
 * App Store Connect has for the app, adds one, and passes it to xcodebuild.
 */
import { spawnSync } from 'node:child_process'
import { createPrivateKey, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const BUNDLE_ID = 'app.owlto.mobile'
const TEAM_ID = '9SS2Q95YZN'
const SCHEME = 'Owlto'
const API = 'https://api.appstoreconnect.apple.com'
const POLL_INTERVAL_MS = 30_000
const PROCESSING_TIMEOUT_MS = 45 * 60_000
const REVIEW_STATE_TIMEOUT_MS = 5 * 60_000
const GET_ATTEMPTS = 5
const RETRY_DELAY_MS = 5_000

const here = dirname(fileURLToPath(import.meta.url))
const project = resolve(here, '../Owlto.xcodeproj')
const configDir = join(homedir(), '.appstoreconnect')
const configPath = join(configDir, 'owlto-testflight.json')

const HELP = `Usage: pnpm ios:testflight [options]

  --notes <text>     "What to Test" for this build (default: "Bug fixes and improvements.")
  --group <name>     External tester group (default: "group" in ${configPath})
  --build <number>   Skip archive and upload; distribute this already uploaded build number
  --upload-only      Archive and upload, then stop
  --no-review        Do not submit for Beta App Review or add to the group
  --help             Show this help`

function fail(message) {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

function step(message) {
  console.log(`\n▸ ${message}`)
}

function readConfig(groupOverride) {
  if (!existsSync(configPath)) {
    fail(
      `Missing ${configPath}. Create it with:\n  { "keyId": "...", "issuerId": "...", "group": "<external group name>" }`
    )
  }
  let raw
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (error) {
    fail(`${configPath} is not valid JSON: ${error.message}`)
  }
  const text = (name) => (typeof raw?.[name] === 'string' ? raw[name].trim() : '')
  const keyId = text('keyId')
  const issuerId = text('issuerId')
  const group = groupOverride ?? text('group')
  if (!keyId || !issuerId) fail(`${configPath} needs string "keyId" and "issuerId".`)
  const keyPath = join(configDir, 'private_keys', `AuthKey_${keyId}.p8`)
  if (!existsSync(keyPath)) fail(`Missing API key file ${keyPath}.`)
  return { keyId, issuerId, group, keyPath }
}

/** App Store Connect tokens are ES256 JWTs that live at most 20 minutes; mint one per request. */
export function createToken({ keyId, issuerId, privateKeyPem, now = Date.now() }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const issuedAt = Math.floor(now / 1000)
  const header = encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })
  const payload = encode({
    iss: issuerId,
    iat: issuedAt,
    exp: issuedAt + 10 * 60,
    aud: 'appstoreconnect-v1'
  })
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(privateKeyPem),
    dsaEncoding: 'ieee-p1363'
  })
  return `${header}.${payload}.${signature.toString('base64url')}`
}

function createClient(config) {
  const privateKeyPem = readFileSync(config.keyPath, 'utf8')
  async function send(method, path, body) {
    const token = createToken({ ...config, privateKeyPem })
    try {
      return await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      })
    } catch (error) {
      const reason = error.cause?.code ?? error.cause?.message ?? error.message
      throw new Error(
        `${method} ${path.split('?')[0]} could not reach App Store Connect (${reason})`
      )
    }
  }

  return async function request(method, path, body) {
    // The wait for processing makes dozens of reads over many minutes, so one dropped
    // connection must not end the run. Only reads are retried: they are safe to repeat.
    const attempts = method === 'GET' ? GET_ATTEMPTS : 1
    let response
    for (let attempt = 1; ; attempt += 1) {
      const last = attempt === attempts
      try {
        response = await send(method, path, body)
      } catch (error) {
        if (last) throw error
        await sleep(RETRY_DELAY_MS * attempt)
        continue
      }
      if (last || (response.status !== 429 && response.status < 500)) break
      await sleep(RETRY_DELAY_MS * attempt)
    }
    const text = await response.text()
    const json = text ? JSON.parse(text) : null
    if (!response.ok) {
      const details = (json?.errors ?? [])
        .map((error) => `${error.title}: ${error.detail}`)
        .join('\n  ')
      const hint =
        response.status === 403
          ? '\n  The API key needs the App Manager role (a team key, not an individual one) to submit builds for review and manage external groups.'
          : ''
      throw new Error(
        `${method} ${path.split('?')[0]} → ${response.status}\n  ${details || text}${hint}`
      )
    }
    return json
  }
}

function query(params) {
  return new URLSearchParams(params).toString()
}

function readMarketingVersion() {
  const pbxproj = readFileSync(join(project, 'project.pbxproj'), 'utf8')
  const versions = new Set(
    [...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1].trim())
  )
  if (versions.size !== 1) {
    fail(`Expected one MARKETING_VERSION in the project, found: ${[...versions].join(', ')}`)
  }
  return [...versions][0]
}

/** Highest numeric build number among the given builds, plus one. */
export function nextBuildNumber(buildVersions) {
  const numbers = buildVersions.map(Number).filter((value) => Number.isInteger(value) && value > 0)
  return Math.max(0, ...numbers) + 1
}

function xcodebuild(args) {
  // A clean environment: variables that pnpm and Node add can break xcodebuild's toolchain.
  const result = spawnSync('/usr/bin/xcodebuild', args, {
    stdio: 'inherit',
    env: {
      HOME: homedir(),
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      USER: process.env.USER ?? ''
    }
  })
  if (result.error) fail(`Could not run xcodebuild: ${result.error.message}`)
  if (result.status !== 0) fail(`xcodebuild exited with status ${result.status}.`)
}

function archiveAndUpload(buildNumber) {
  const workDir = join(tmpdir(), 'owlto-ios-testflight')
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  const archivePath = join(workDir, 'Owlto.xcarchive')
  const exportOptionsPath = join(workDir, 'ExportOptions.plist')
  writeFileSync(
    exportOptionsPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>upload</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>${TEAM_ID}</string>
</dict>
</plist>
`
  )
  step(`Archiving build ${buildNumber} (Release)`)
  xcodebuild([
    '-project',
    project,
    '-scheme',
    SCHEME,
    '-configuration',
    'Release',
    '-destination',
    'generic/platform=iOS',
    '-archivePath',
    archivePath,
    '-quiet',
    '-allowProvisioningUpdates',
    'archive',
    `CURRENT_PROJECT_VERSION=${buildNumber}`
  ])

  step('Uploading to App Store Connect')
  xcodebuild([
    '-exportArchive',
    '-archivePath',
    archivePath,
    '-exportOptionsPlist',
    exportOptionsPath,
    '-exportPath',
    join(workDir, 'export'),
    '-allowProvisioningUpdates'
  ])
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function waitForProcessing(request, appId, marketingVersion, buildNumber) {
  step(`Waiting for Apple to process ${marketingVersion} (${buildNumber})`)
  const path = `/v1/builds?${query({
    'filter[app]': appId,
    'filter[version]': String(buildNumber),
    'filter[preReleaseVersion.version]': marketingVersion,
    'fields[builds]': 'version,processingState,usesNonExemptEncryption,expired'
  })}`
  const deadline = Date.now() + PROCESSING_TIMEOUT_MS
  let lastState = ''
  while (Date.now() < deadline) {
    const build = (await request('GET', path)).data[0]
    const state = build?.attributes.processingState ?? 'not listed yet'
    if (state !== lastState) console.log(`  ${state}`)
    lastState = state
    if (state === 'VALID') return build
    if (state === 'FAILED' || state === 'INVALID') {
      fail(`Apple rejected the build (${state}). Check the email from App Store Connect.`)
    }
    await sleep(POLL_INTERVAL_MS)
  }
  fail(
    `Build ${buildNumber} was not processed in time. Rerun with --build ${buildNumber} once it is.`
  )
}

async function setWhatToTest(request, buildId, notes) {
  step('Setting "What to Test"')
  const existing = (await request('GET', `/v1/builds/${buildId}/betaBuildLocalizations`)).data
  for (const localization of existing) {
    await request('PATCH', `/v1/betaBuildLocalizations/${localization.id}`, {
      data: {
        type: 'betaBuildLocalizations',
        id: localization.id,
        attributes: { whatsNew: notes }
      }
    })
    console.log(`  ${localization.attributes.locale}`)
  }
  if (existing.length === 0) {
    await request('POST', '/v1/betaBuildLocalizations', {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale: 'en-US', whatsNew: notes },
        relationships: { build: { data: { type: 'builds', id: buildId } } }
      }
    })
    console.log('  en-US')
  }
}

async function findExternalGroup(request, appId, name) {
  const groups = (
    await request(
      'GET',
      `/v1/betaGroups?${query({ 'filter[app]': appId, 'filter[name]': name, limit: '50' })}`
    )
  ).data.filter((group) => group.attributes.name === name)
  if (groups.length === 0) fail(`No TestFlight group named "${name}" for ${BUNDLE_ID}.`)
  const group = groups[0]
  if (group.attributes.isInternalGroup) {
    fail(`"${name}" is an internal group; this script distributes to an external group.`)
  }
  return group
}

async function submitForBetaReview(request, buildId) {
  step('Submitting for Beta App Review')
  const deadline = Date.now() + REVIEW_STATE_TIMEOUT_MS
  while (true) {
    const detail = (await request('GET', `/v1/builds/${buildId}/buildBetaDetail`)).data
    const state = detail.attributes.externalBuildState
    if (state === 'READY_FOR_BETA_SUBMISSION') {
      await request('POST', '/v1/betaAppReviewSubmissions', {
        data: {
          type: 'betaAppReviewSubmissions',
          relationships: { build: { data: { type: 'builds', id: buildId } } }
        }
      })
      console.log('  submitted')
      return
    }
    if (state === 'MISSING_EXPORT_COMPLIANCE') {
      fail(
        'The build is missing export compliance. Answer it once in App Store Connect, or set ITSAppUsesNonExemptEncryption in the build settings (see APP_STORE.md).'
      )
    }
    // A short wait covers the gap between "processed" and "ready to submit".
    if (state !== 'PROCESSING' || Date.now() > deadline) {
      console.log(`  nothing to submit (state: ${state})`)
      return
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      notes: { type: 'string', default: 'Bug fixes and improvements.' },
      group: { type: 'string' },
      build: { type: 'string' },
      'upload-only': { type: 'boolean', default: false },
      'no-review': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false }
    }
  })
  if (args.help) {
    console.log(HELP)
    return
  }
  if (args.build !== undefined && !/^[1-9]\d*$/.test(args.build)) {
    fail('--build must be a positive integer.')
  }
  const distribute = !args['upload-only'] && !args['no-review']
  const config = readConfig(args.group)
  if (distribute && !config.group) {
    fail(`No external group: pass --group or set "group" in ${configPath}.`)
  }
  const request = createClient(config)
  const marketingVersion = readMarketingVersion()

  const app = (
    await request('GET', `/v1/apps?${query({ 'filter[bundleId]': BUNDLE_ID, limit: '1' })}`)
  ).data[0]
  if (!app) fail(`This API key cannot see an app with bundle id ${BUNDLE_ID}.`)
  // Look the group up before the slow part, so a typo fails in seconds.
  const group = distribute ? await findExternalGroup(request, app.id, config.group) : null

  let buildNumber
  if (args.build !== undefined) {
    buildNumber = Number(args.build)
  } else {
    const recent = (
      await request(
        'GET',
        `/v1/builds?${query({
          'filter[app]': app.id,
          sort: '-uploadedDate',
          limit: '200',
          'fields[builds]': 'version'
        })}`
      )
    ).data
    buildNumber = nextBuildNumber(recent.map((build) => build.attributes.version))
    archiveAndUpload(buildNumber)
  }
  if (args['upload-only']) {
    console.log(`\n✓ Uploaded ${marketingVersion} (${buildNumber}).`)
    return
  }

  const build = await waitForProcessing(request, app.id, marketingVersion, buildNumber)
  await setWhatToTest(request, build.id, args.notes)
  if (!group) {
    console.log(`\n✓ ${marketingVersion} (${buildNumber}) is processed; not distributed.`)
    return
  }
  await submitForBetaReview(request, build.id)
  step(`Adding the build to "${group.attributes.name}"`)
  await request('POST', `/v1/betaGroups/${group.id}/relationships/builds`, {
    data: [{ type: 'builds', id: build.id }]
  })
  console.log(
    `\n✓ ${marketingVersion} (${buildNumber}) is on its way to "${group.attributes.name}". Testers get it once Beta App Review approves it.`
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error.message))
}
