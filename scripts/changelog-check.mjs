#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const fragmentDir = '.changelog/unreleased'
const fragmentTypes = new Set(['added', 'changed', 'fixed', 'security', 'removed', 'internal'])

function parseArgs(argv) {
  const args = {
    file: 'CHANGELOG.md',
    base: undefined,
    mr: undefined,
    changelogNa: false,
    fragments: []
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    }
    if (arg === '--file') {
      args.file = argv[++index]
      continue
    }
    if (arg === '--base') {
      args.base = argv[++index]
      continue
    }
    if (arg === '--fragment') {
      const next = argv[++index]
      if (!next) {
        throw new Error('Missing value for --fragment.')
      }
      args.fragments.push(next)
      continue
    }
    if (arg === '--mr') {
      args.mr = argv[++index]
      continue
    }
    if (arg === '--changelog-na') {
      args.changelogNa = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

function readLines(file) {
  const path = resolve(file)
  if (!existsSync(path)) {
    throw new Error(`Missing changelog: ${file}`)
  }
  return readFileSync(path, 'utf8').split('\n')
}

function readFragmentFiles(fragmentPaths) {
  if (fragmentPaths.length > 0) {
    return fragmentPaths
  }

  if (!existsSync(fragmentDir)) {
    return []
  }

  return readdirSync(fragmentDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => join(fragmentDir, file))
    .sort((left, right) => left.localeCompare(right))
}

function lineNumber(index) {
  return index + 1
}

function validateFragmentContent(file, lines) {
  const errors = []
  let hasEntry = false
  const fileName = file.split('/').at(-1) ?? file
  const match =
    /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.(added|changed|fixed|security|removed|internal)\.md$/.exec(
      fileName
    )

  if (!match) {
    errors.push(`${file} must match <date>-<scope>-<slug>.<type>.md.`)
  } else if (!fragmentTypes.has(match[1])) {
    errors.push(`${file} has unsupported fragment type '${match[1]}'.`)
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') {
      continue
    }

    if (line.startsWith('- ')) {
      hasEntry = true
      continue
    }

    errors.push(
      `${file}:${lineNumber(index)} must contain only changelog bullets starting with '- '.`
    )
  }

  if (!hasEntry) {
    errors.push(`${file} must contain at least one changelog bullet.`)
  }

  return errors
}

function validateFragments(fragmentFiles) {
  const errors = []
  for (const file of fragmentFiles) {
    errors.push(...validateFragmentContent(file, readLines(file)))
  }
  return errors
}

function validateStructure(lines) {
  const errors = []
  const unreleasedIndex = lines.findIndex((line) => line.trim() === '## Unreleased')
  if (unreleasedIndex === -1) {
    errors.push("CHANGELOG.md is missing '## Unreleased'.")
    return errors
  }

  const nextVersionIndex = lines.findIndex(
    (line, index) => index > unreleasedIndex && line.startsWith('## ')
  )
  const unreleasedEnd = nextVersionIndex === -1 ? lines.length : nextVersionIndex
  const unreleasedLines = lines.slice(unreleasedIndex + 1, unreleasedEnd)

  for (const section of ['### Highlights', '### Changes', '### Fixes']) {
    if (!unreleasedLines.some((line) => line.trim() === section)) {
      errors.push(`CHANGELOG.md is missing '${section}' under Unreleased.`)
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.startsWith('- ')) {
      continue
    }

    let releaseHeading
    let sectionHeading
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      if (!sectionHeading && lines[cursor].startsWith('### ')) {
        sectionHeading = lines[cursor]
      }
      if (lines[cursor].startsWith('## ')) {
        releaseHeading = lines[cursor]
        break
      }
    }

    if (!releaseHeading || !sectionHeading) {
      errors.push(
        `Changelog bullet at line ${lineNumber(index)} is not inside a release subsection.`
      )
    }
  }

  const versionHeadings = new Map()
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^##\s+([0-9]{4}\.[0-9]{1,2}\.[0-9]+(?:-\d+|-beta\.\d+)?)\s*$/.exec(lines[index])
    if (!match) {
      continue
    }
    const version = match[1]
    const previous = versionHeadings.get(version)
    if (previous !== undefined) {
      errors.push(
        `Duplicate changelog version '${version}' at lines ${lineNumber(previous)} and ${lineNumber(index)}.`
      )
    }
    versionHeadings.set(version, index)
  }

  return errors
}

function gitOutput(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function validateChangedFiles(base, changelogNa) {
  const errors = []
  const changedFiles = gitOutput(['diff', '--name-only', `${base}...HEAD`])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const legacyFragmentFiles = changedFiles.filter((file) => file.startsWith('changelog/fragments/'))
  if (legacyFragmentFiles.length > 0) {
    errors.push(`Unsupported changelog fragment files detected: ${legacyFragmentFiles.join(', ')}`)
  }

  const unreleasedFragmentFiles = changedFiles.filter((file) => file.startsWith(`${fragmentDir}/`))
  const hasUnreleasedFragment = unreleasedFragmentFiles.some((file) => file.endsWith('.md'))
  const isReleaseChange =
    changedFiles.includes('CHANGELOG.md') &&
    changedFiles.some((file) => file.startsWith('release-notes/')) &&
    changedFiles.includes('apps/owls-client/package.json')

  const exemptOnly = changedFiles.length > 0 && changedFiles.every(isFragmentExemptFile)

  if (!isReleaseChange && changedFiles.includes('CHANGELOG.md')) {
    errors.push(
      'Normal development MRs must add .changelog/unreleased fragments instead of editing CHANGELOG.md.'
    )
  }

  if (
    !exemptOnly &&
    !isReleaseChange &&
    !changelogNa &&
    changedFiles.length > 0 &&
    !hasUnreleasedFragment
  ) {
    errors.push('Missing .changelog/unreleased fragment for non-docs change.')
  }

  return errors
}

function isFragmentExemptFile(file) {
  return (
    file === 'CHANGELOG.md' ||
    file === 'AGENTS.md' ||
    file === '.gitlab-ci.yml' ||
    file.startsWith('.changelog/') ||
    file.startsWith('.github/') ||
    file.startsWith('.gitlab/') ||
    file.startsWith('docs/') ||
    file.startsWith('.agents/skills/') ||
    file.startsWith('tests/') ||
    file.includes('/tests/') ||
    file.endsWith('.md') ||
    file.endsWith('.mdx') ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
  )
}

function validateMrReference(lines, mr) {
  if (!mr) {
    return []
  }

  const pattern = new RegExp(`\\(#${mr}\\)`)
  if (lines.some((line) => pattern.test(line))) {
    return []
  }
  return [`CHANGELOG.md must reference MR #${mr} as (#${mr}).`]
}

try {
  const args = parseArgs(process.argv.slice(2))
  const fragmentFiles = readFragmentFiles(args.fragments)

  if (args.fragments.length > 0 && args.base) {
    throw new Error('--fragment validates selected files only; do not combine it with --base.')
  }
  if (args.fragments.length > 0 && args.changelogNa) {
    throw new Error(
      '--fragment validates selected files only; do not combine it with --changelog-na.'
    )
  }

  if (args.fragments.length > 0) {
    const fragmentLines = fragmentFiles.flatMap((file) => readLines(file))
    const errors = [
      ...validateFragments(fragmentFiles),
      ...validateMrReference(fragmentLines, args.mr)
    ]

    if (errors.length > 0) {
      for (const error of errors) {
        console.error(error)
      }
      process.exit(1)
    }

    console.log(
      fragmentFiles.length === 1
        ? 'Changelog fragment validated.'
        : `${fragmentFiles.length} changelog fragments validated.`
    )
    process.exit(0)
  }

  const lines = readLines(args.file)
  const fragmentLines = fragmentFiles.flatMap((file) => readLines(file))
  const errors = [
    ...validateStructure(lines),
    ...validateFragments(fragmentFiles),
    ...validateMrReference([...lines, ...fragmentLines], args.mr)
  ]

  if (args.base) {
    errors.push(...validateChangedFiles(args.base, args.changelogNa))
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error)
    }
    process.exit(1)
  }

  console.log('CHANGELOG.md validated.')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
