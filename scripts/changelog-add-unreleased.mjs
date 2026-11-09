#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const fragmentTypes = new Set(['added', 'changed', 'fixed', 'security', 'removed', 'internal'])

function parseArgs(argv) {
  let fragmentDir = resolve('.changelog/unreleased')
  let type
  let scope
  let name
  const entryParts = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    // `pnpm run changelog:add -- ...` forwards the `--` separator verbatim.
    if (arg === '--') {
      continue
    }
    if (arg === '--dir') {
      const next = argv[index + 1]
      if (!next) {
        throw new Error('Missing value for --dir.')
      }
      fragmentDir = resolve(next)
      index += 1
      continue
    }
    if (arg === '--type') {
      const next = argv[index + 1]
      if (!fragmentTypes.has(next)) {
        throw new Error(
          'Missing or invalid value for --type <added|changed|fixed|security|removed|internal>.'
        )
      }
      type = next
      index += 1
      continue
    }
    if (arg === '--scope') {
      const next = argv[index + 1]
      if (!next) {
        throw new Error('Missing value for --scope.')
      }
      scope = next
      index += 1
      continue
    }
    if (arg === '--name') {
      const next = argv[index + 1]
      if (!next) {
        throw new Error('Missing value for --name.')
      }
      name = next
      index += 1
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`)
    }
    entryParts.push(arg)
  }

  const entry = entryParts.join(' ').trim()
  if (!type) {
    throw new Error('Missing required --type <added|changed|fixed|security|removed|internal>.')
  }
  if (!entry) {
    throw new Error('Missing changelog entry text.')
  }

  return { fragmentDir, type, scope, entry, name }
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function localDateStamp(date) {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function inferScope(entry) {
  const match = /^([A-Za-z0-9][A-Za-z0-9 /_-]*):/.exec(entry)
  return match ? match[1] : 'general'
}

try {
  const { fragmentDir, type, scope, entry, name } = parseArgs(process.argv.slice(2))
  mkdirSync(fragmentDir, { recursive: true })

  const dateStamp = localDateStamp(new Date())
  const scopeSlug = slugify(scope ?? inferScope(entry)) || 'general'
  const nameSlug = slugify(name ?? entry) || 'entry'
  const baseName = `${dateStamp}-${scopeSlug}-${nameSlug}`
  let fragmentPath = join(fragmentDir, `${baseName}.${type}.md`)
  for (let counter = 2; existsSync(fragmentPath); counter += 1) {
    fragmentPath = join(fragmentDir, `${baseName}-${counter}.${type}.md`)
  }

  const bullet = entry.startsWith('- ') ? entry : `- ${entry}`
  writeFileSync(fragmentPath, `${bullet}\n`)
  console.log(`Created ${fragmentPath}.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
