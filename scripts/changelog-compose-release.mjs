#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { releaseVersionPolicyMessage, validateReleaseVersion } from './release-version.mjs'

const fragmentDir = '.changelog/unreleased'
const archiveRoot = '.changelog/archive'
const sections = ['Highlights', 'Changes', 'Fixes']
const sectionSet = new Set(sections)
const fragmentTypes = new Set(['added', 'changed', 'fixed', 'security', 'removed', 'internal'])

function parseArgs(argv) {
  let version
  let skipReleaseNotes = false
  let includeInternal = false
  let force = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--version') {
      version = argv[++index]
      continue
    }
    if (arg === '--skip-release-notes') {
      skipReleaseNotes = true
      continue
    }
    if (arg === '--include-internal') {
      includeInternal = true
      continue
    }
    if (arg === '--force') {
      force = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!version) {
    throw new Error('Missing required --version <version>.')
  }

  return { version, skipReleaseNotes, includeInternal, force }
}

function emptyEntries() {
  return new Map(sections.map((section) => [section, []]))
}

function fragmentFiles() {
  if (!existsSync(fragmentDir)) {
    return []
  }

  return readdirSync(fragmentDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => join(fragmentDir, file))
    .sort((left, right) => left.localeCompare(right))
}

function fragmentType(file) {
  const match =
    /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.(added|changed|fixed|security|removed|internal)\.md$/.exec(
      basename(file)
    )
  return match?.[1]
}

function targetSection(type) {
  if (type === 'fixed') {
    return 'Fixes'
  }
  if (type === 'internal') {
    return undefined
  }
  return 'Changes'
}

function collectFragmentEntries(file, type, includeInternal) {
  const section = targetSection(type)
  if (!section && !includeInternal) {
    return []
  }

  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')

  if (lines.some((line) => !line.startsWith('- '))) {
    throw new Error(`${file} must contain only bullet lines starting with '- '.`)
  }

  if (type === 'internal' && includeInternal) {
    return lines.map((line) => ({ section: 'Changes', entry: [line] }))
  }

  return lines.map((line) => ({ section, entry: [line] }))
}

function collectLegacyUnreleasedEntries(lines, source) {
  const entries = []
  const errors = []
  let section
  let entryLines

  function flushEntry() {
    if (!entryLines) {
      return
    }
    if (section) {
      entries.push({ section, entry: entryLines })
    }
    entryLines = undefined
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const heading = /^###\s+(.+?)\s*$/.exec(line)
    if (heading) {
      flushEntry()
      section = heading[1]
      if (!sectionSet.has(section)) {
        errors.push(`${source}:${index + 1} uses unsupported section '${section}'.`)
      }
      continue
    }

    if (line.trim() === '') {
      flushEntry()
      continue
    }

    if (line.startsWith('- ')) {
      flushEntry()
      if (!section) {
        errors.push(`${source}:${index + 1} has an entry before a section heading.`)
      }
      entryLines = [line]
      continue
    }

    if (entryLines && /^\s+/.test(line)) {
      entryLines.push(line)
      continue
    }

    errors.push(`${source}:${index + 1} must contain only section headings and bullets.`)
  }

  flushEntry()
  return { entries, errors }
}

function addEntry(entries, section, entry) {
  entries.get(section).push(entry)
}

function unreleasedRange(lines) {
  const start = lines.findIndex((line) => line.trim() === '## Unreleased')
  if (start === -1) {
    throw new Error("CHANGELOG.md is missing '## Unreleased'.")
  }

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) {
      end = index
      break
    }
  }

  return { start, end }
}

function renderUnreleased() {
  return ['## Unreleased', '', '### Highlights', '', '### Changes', '', '### Fixes', '']
}

function renderRelease(version, entries) {
  const lines = [`## ${version}`, '']
  for (const section of sections) {
    lines.push(`### ${section}`, '')
    for (const entry of entries.get(section)) {
      lines.push(...entry, '')
    }
  }
  while (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

function stripReleaseMetadata(entryLines) {
  return entryLines
    .join(' ')
    .replace(/^\s*-\s*/, '')
    .replace(/\s+\(#\d+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isInternalReleaseNote(text) {
  return /^(Build\/CI|Development workflow|Release|Docs):/.test(text)
}

function renderReleaseNotes(entries) {
  const featureBullets = [...entries.get('Highlights'), ...entries.get('Changes')]
    .map(stripReleaseMetadata)
    .filter((entry) => entry && !isInternalReleaseNote(entry))
  const fixBullets = entries
    .get('Fixes')
    .map(stripReleaseMetadata)
    .filter((entry) => entry && !isInternalReleaseNote(entry))
  const lines = []

  if (featureBullets.length > 0) {
    lines.push('## Features', '')
    for (const bullet of featureBullets) {
      lines.push(`- ${bullet}`)
    }
    lines.push('')
  }

  if (fixBullets.length > 0) {
    lines.push('## Bug Fixes', '')
    for (const bullet of fixBullets) {
      lines.push(`- ${bullet}`)
    }
    lines.push('')
  }

  if (lines.length === 0) {
    lines.push('## Features', '', '- This release includes maintenance updates.', '')
  }

  return `${lines.join('\n').trim()}\n`
}

function archiveFragments(files, version) {
  const archiveDir = join(archiveRoot, version)
  mkdirSync(archiveDir, { recursive: true })

  for (const file of files) {
    let target = join(archiveDir, basename(file))
    const extension = '.md'
    const stem = basename(file, extension)
    for (let counter = 2; existsSync(target); counter += 1) {
      target = join(archiveDir, `${stem}-${counter}${extension}`)
    }
    renameSync(file, target)
  }
}

try {
  const { version, skipReleaseNotes, includeInternal, force } = parseArgs(process.argv.slice(2))
  if (!validateReleaseVersion(version)) {
    throw new Error(`Invalid Owls release version: ${version}. ${releaseVersionPolicyMessage()}`)
  }

  const changelog = readFileSync('CHANGELOG.md', 'utf8')
  const changelogLines = changelog.split('\n')
  if (new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(changelog)) {
    throw new Error(`CHANGELOG.md already contains release section '## ${version}'.`)
  }

  const { start, end } = unreleasedRange(changelogLines)
  const entries = emptyEntries()
  const legacy = collectLegacyUnreleasedEntries(
    changelogLines.slice(start + 1, end),
    'CHANGELOG.md'
  )
  const errors = [...legacy.errors]
  for (const item of legacy.entries) {
    addEntry(entries, item.section, item.entry)
  }

  const files = fragmentFiles()
  for (const file of files) {
    const type = fragmentType(file)
    if (!type) {
      errors.push(`${file} must match <date>-<scope>-<slug>.<type>.md.`)
      continue
    }
    if (!fragmentTypes.has(type)) {
      errors.push(`${file} has unsupported fragment type '${type}'.`)
      continue
    }
    for (const item of collectFragmentEntries(file, type, includeInternal)) {
      addEntry(entries, item.section, item.entry)
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }

  const entryCount = sections.reduce((total, section) => total + entries.get(section).length, 0)
  if (entryCount === 0) {
    throw new Error('No unreleased changelog entries or fragments found.')
  }

  const releaseNotesPath = join('release-notes', `${version}.md`)
  if (!skipReleaseNotes && existsSync(releaseNotesPath) && !force) {
    throw new Error(`Release notes already exist: ${releaseNotesPath}. Pass --force to overwrite.`)
  }

  const nextLines = [
    ...changelogLines.slice(0, start),
    ...renderUnreleased(),
    '',
    ...renderRelease(version, entries),
    '',
    ...changelogLines.slice(end).filter((line, index) => index > 0 || line.trim() !== '')
  ]
  writeFileSync(
    'CHANGELOG.md',
    `${nextLines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()}\n`
  )

  if (!skipReleaseNotes) {
    writeFileSync(releaseNotesPath, renderReleaseNotes(entries))
  }

  archiveFragments(files, version)
  console.log(`Composed ${entryCount} changelog entries into ${version}.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
