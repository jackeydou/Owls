import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const addScript = join(repoRoot, 'scripts/changelog-add-unreleased.mjs')
const checkScript = join(repoRoot, 'scripts/changelog-check.mjs')
const composeScript = join(repoRoot, 'scripts/changelog-compose-release.mjs')

function runScript(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' })
}

async function tempDir(t) {
  const directory = await mkdtemp(join(tmpdir(), 'owls-changelog-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function readOnlyFragment(directory) {
  const files = await readdir(directory)
  assert.equal(files.length, 1)
  return readFile(join(directory, files[0]), 'utf8')
}

test('changelog:add drops the pnpm `--` separator from the entry text', async (t) => {
  const directory = await tempDir(t)
  // Mirrors `pnpm run changelog:add -- --type fixed --scope x "..."`.
  const result = runScript(
    addScript,
    ['--', '--dir', directory, '--type', 'fixed', '--scope', 'x', 'Area: change. (#7)'],
    directory
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await readOnlyFragment(directory), '- Area: change. (#7)\n')
})

test('changelog:add ignores a standalone `--` between options and entry text', async (t) => {
  const directory = await tempDir(t)
  const result = runScript(
    addScript,
    ['--dir', directory, '--type', 'changed', '--', 'Area:', 'change.'],
    directory
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await readOnlyFragment(directory), '- Area: change.\n')
})

test('changelog:add rejects unknown options instead of writing them as entry text', async (t) => {
  const directory = await tempDir(t)
  const result = runScript(
    addScript,
    ['--dir', directory, '--typo', 'fixed', 'Area: change.'],
    directory
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unknown argument: --typo/)
  assert.deepEqual(await readdir(directory), [])
})

test('changelog:check rejects a fragment bullet that starts with `- -- `', async (t) => {
  const directory = await tempDir(t)
  const fragment = join(directory, '2026-11-09-x-change.fixed.md')
  await writeFile(fragment, '- -- Area: change. (#7)\n')

  const result = runScript(checkScript, ['--fragment', fragment], directory)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /stray '--' argument separator/)

  await writeFile(fragment, '- Area: change. (#7)\n')
  const fixed = runScript(checkScript, ['--fragment', fragment], directory)
  assert.equal(fixed.status, 0, fixed.stderr)
})

test('changelog:compose refuses fragments whose bullet starts with `- -- `', async (t) => {
  const directory = await tempDir(t)
  const changelog = '# Changelog\n\n## Unreleased\n\n### Highlights\n\n### Changes\n\n### Fixes\n'
  await writeFile(join(directory, 'CHANGELOG.md'), changelog)
  const fragmentDir = join(directory, '.changelog/unreleased')
  await mkdir(fragmentDir, { recursive: true })
  await writeFile(join(fragmentDir, '2026-11-09-x-change.fixed.md'), '- -- Area: change. (#7)\n')

  const result = runScript(
    composeScript,
    ['--version', '2026.11.900', '--skip-release-notes'],
    directory
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /stray '--' argument separator/)
  assert.equal(await readFile(join(directory, 'CHANGELOG.md'), 'utf8'), changelog)
  assert.deepEqual(await readdir(fragmentDir), ['2026-11-09-x-change.fixed.md'])
})
