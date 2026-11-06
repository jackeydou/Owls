import { spawn } from 'node:child_process'
import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const templateRoot = join(packageRoot, 'plugin/skills/sites-building/templates/site-app-template')
const forbiddenTemplateEntries = [
  '.pnp',
  '.next',
  '.next-dev',
  '.vercel',
  '.wrangler',
  'coverage',
  'dist',
  'next-env.d.ts',
  'node_modules',
  'out'
]
const forbiddenTemplateDirectoryNames = new Set([
  '.yarn',
  '.next',
  '.next-dev',
  '.vercel',
  '.wrangler',
  'coverage',
  'dist',
  'node_modules',
  'out'
])

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function isForbiddenLocalFile(name) {
  if (name === '.env.example') return false
  return (
    name === '.pnp.cjs' ||
    name === '.pnp.loader.mjs' ||
    name === 'next-env.d.ts' ||
    name === '.env' ||
    name.startsWith('.env.') ||
    name.endsWith('.log') ||
    name.endsWith('.pem') ||
    name.endsWith('.tsbuildinfo') ||
    name.startsWith('npm-debug.log') ||
    name.startsWith('yarn-debug.log') ||
    name.startsWith('yarn-error.log') ||
    name.startsWith('.pnpm-debug.log')
  )
}

async function collectForbiddenLocalArtifacts(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const localArtifacts = []

  for (const entry of entries) {
    const absolute = join(dir, entry.name)
    const relative = absolute.slice(base.length + 1)
    if (entry.isDirectory()) {
      if (forbiddenTemplateDirectoryNames.has(entry.name)) continue
      localArtifacts.push(...(await collectForbiddenLocalArtifacts(absolute, base)))
      continue
    }
    if (entry.isFile() && isForbiddenLocalFile(entry.name)) localArtifacts.push(relative)
  }

  return localArtifacts
}

async function assertCleanTemplateSource() {
  const dirtyEntries = []

  for (const entry of forbiddenTemplateEntries) {
    if (await pathExists(join(templateRoot, entry))) dirtyEntries.push(entry)
  }

  dirtyEntries.push(...(await collectForbiddenLocalArtifacts(templateRoot)))

  if (dirtyEntries.length === 0) return

  throw new Error(
    [
      'Sites template source contains generated or local runtime artifacts.',
      'Clean the template source before validating:',
      ...dirtyEntries.sort().map((entry) => `  - ${entry}`)
    ].join('\n')
  )
}

const tempRoot = await mkdtemp(join(tmpdir(), 'owls-sites-template-'))

try {
  await assertCleanTemplateSource()
  await cp(templateRoot, tempRoot, {
    recursive: true,
    force: true,
    errorOnExist: false
  })
  await run('pnpm', ['install', '--no-frozen-lockfile'], tempRoot)
  await run('pnpm', ['run', 'build'], tempRoot)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
