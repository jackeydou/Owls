#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { createReleaseVersion, releaseVersionPolicyMessage } from './release-version.mjs'

const packagePaths = ['package.json', 'apps/owlto-client/package.json']

function readValue(argv, index, name) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}.`)
  }
  return value
}

function parsePositiveInteger(value, name) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return Number(value)
}

function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    throw new Error('Date must use YYYY-MM-DD format.')
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date: ${value}`)
  }

  return { year, month, day }
}

function localDateParts() {
  const date = new Date()
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  }
}

function parseArgs(argv) {
  let mode = null
  let date = null
  let betaNumber = null
  let correction = null
  let dryRun = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    }
    if (arg === '--stable') {
      mode = mode ?? 'stable'
      if (mode !== 'stable') throw new Error('Choose only one release mode.')
      continue
    }
    if (arg === '--beta') {
      mode = mode ?? 'beta'
      if (mode !== 'beta') throw new Error('Choose only one release mode.')
      continue
    }
    if (arg === '--correction') {
      mode = mode ?? 'correction'
      if (mode !== 'correction') throw new Error('Choose only one release mode.')
      correction = parsePositiveInteger(readValue(argv, index, arg), '--correction')
      index += 1
      continue
    }
    if (arg.startsWith('--correction=')) {
      mode = mode ?? 'correction'
      if (mode !== 'correction') throw new Error('Choose only one release mode.')
      correction = parsePositiveInteger(arg.slice('--correction='.length), '--correction')
      continue
    }
    if (arg === '--number') {
      betaNumber = parsePositiveInteger(readValue(argv, index, arg), '--number')
      index += 1
      continue
    }
    if (arg.startsWith('--number=')) {
      betaNumber = parsePositiveInteger(arg.slice('--number='.length), '--number')
      continue
    }
    if (arg === '--date') {
      date = parseDate(readValue(argv, index, arg))
      index += 1
      continue
    }
    if (arg.startsWith('--date=')) {
      date = parseDate(arg.slice('--date='.length))
      continue
    }
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!mode) {
    throw new Error('Choose one release mode: --stable, --beta, or --correction <number>.')
  }
  if (mode === 'beta' && betaNumber === null) {
    throw new Error('Beta releases require --number <N>.')
  }
  if (mode !== 'beta' && betaNumber !== null) {
    throw new Error('--number is only valid with --beta.')
  }
  if (mode !== 'correction' && correction !== null) {
    throw new Error('--correction cannot be combined with another release mode.')
  }

  return {
    mode,
    dryRun,
    date: date ?? localDateParts(),
    betaNumber: mode === 'beta' ? betaNumber : null,
    correction: mode === 'correction' ? correction : 0
  }
}

function writePackageVersion(path, version, dryRun) {
  const pkg = JSON.parse(readFileSync(path, 'utf8'))
  pkg.version = version
  const next = `${JSON.stringify(pkg, null, 2)}\n`
  if (!dryRun) {
    writeFileSync(path, next)
  }
}

try {
  const args = parseArgs(process.argv.slice(2))
  const version = createReleaseVersion({
    ...args.date,
    correction: args.correction,
    betaNumber: args.betaNumber
  })

  for (const path of packagePaths) {
    writePackageVersion(path, version, args.dryRun)
  }

  const action = args.dryRun ? 'Would set' : 'Set'
  console.log(`${action} release version to ${version}.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(releaseVersionPolicyMessage())
  process.exit(1)
}
