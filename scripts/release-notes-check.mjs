#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { releaseVersionPolicyMessage, validateReleaseVersion } from './release-version.mjs'

function parseArgs(argv) {
  let version

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--version') {
      version = argv[++index]
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return { version }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

try {
  const { version: requestedVersion } = parseArgs(process.argv.slice(2))
  const appPackage = readJson('apps/pichu-client/package.json')
  const version = requestedVersion ?? appPackage.version
  const errors = []

  if (!validateReleaseVersion(version)) {
    errors.push(`Invalid Owls release version: ${version}. ${releaseVersionPolicyMessage()}`)
  }

  if (appPackage.version !== version) {
    errors.push(
      `apps/pichu-client/package.json version is ${appPackage.version}, expected ${version}.`
    )
  }

  const releaseNotesPath = join('release-notes', `${version}.md`)
  if (!existsSync(releaseNotesPath)) {
    errors.push(`Missing release notes file: ${releaseNotesPath}`)
  } else {
    const releaseNotes = readFileSync(releaseNotesPath, 'utf8').trim()
    if (!releaseNotes) {
      errors.push(`Release notes file is empty: ${releaseNotesPath}`)
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error)
    }
    process.exit(1)
  }

  console.log(`Release notes validated for ${version}.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
