#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

function changelogHasVersion(version) {
  if (!existsSync('CHANGELOG.md')) {
    return false
  }
  const changelog = readFileSync('CHANGELOG.md', 'utf8')
  return new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(changelog)
}

function unreleasedFragments() {
  const fragmentDir = '.changelog/unreleased'
  if (!existsSync(fragmentDir)) {
    return []
  }

  return readdirSync(fragmentDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => `${fragmentDir}/${file}`)
    .sort((left, right) => left.localeCompare(right))
}

try {
  const { version: requestedVersion } = parseArgs(process.argv.slice(2))
  const rootPackage = readJson('package.json')
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

  if (rootPackage.version !== version) {
    errors.push(`package.json version is ${rootPackage.version}, expected ${version}.`)
  }

  if (!changelogHasVersion(version)) {
    errors.push(`CHANGELOG.md is missing release section '## ${version}'.`)
  }

  const fragments = unreleasedFragments()
  if (fragments.length > 0) {
    errors.push(
      `Unreleased changelog fragments remain. Run 'pnpm run changelog:compose -- --version ${version}' so consumed fragments move to .changelog/archive/${version}/: ${fragments.join(', ')}`
    )
  }

  execFileSync(process.execPath, ['scripts/changelog-check.mjs'], { stdio: 'inherit' })

  if (validateReleaseVersion(version)) {
    const releaseNotesCheck = spawnSync(
      process.execPath,
      ['scripts/release-notes-check.mjs', '--version', version],
      { stdio: 'inherit' }
    )
    if (releaseNotesCheck.status !== 0) {
      errors.push(`Release notes validation failed for ${version}.`)
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error)
    }
    process.exit(1)
  }

  console.log(`Release metadata validated for ${version}.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
