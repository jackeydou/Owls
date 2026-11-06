const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const { tmpdir } = require('node:os')
const path = require('node:path')

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

// Search only the artifact. Node's normal upward search can hide missing packages
// by finding the developer's workspace node_modules outside the app.
function findPackage(root, parent, name) {
  let directory = parent
  while (isInside(root, directory)) {
    const manifest = path.join(directory, 'node_modules', name, 'package.json')
    if (fs.existsSync(manifest)) {
      if (!isInside(root, fs.realpathSync(manifest))) {
        throw new Error(`Packaged dependency escapes the app: ${name}`)
      }
      return manifest
    }
    if (directory === root) break
    directory = path.dirname(directory)
  }
  return null
}

function verifyDependencyClosure(appRoot) {
  const root = fs.realpathSync(appRoot)
  const visited = new Set()
  const failures = []
  function visit(manifestPath) {
    if (visited.has(manifestPath)) return
    visited.add(manifestPath)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const optional = manifest.optionalDependencies || {}
    const dependencies = { ...manifest.dependencies, ...optional }
    for (const name of Object.keys(dependencies).sort()) {
      const dependency = findPackage(root, path.dirname(manifestPath), name)
      if (dependency) visit(dependency)
      else if (!Object.hasOwn(optional, name)) {
        failures.push(`${manifest.name || 'app'} -> ${name}`)
      }
    }
  }
  visit(path.join(root, 'package.json'))
  if (failures.length) {
    throw new Error(`Missing packaged dependencies:\n${failures.sort().join('\n')}`)
  }
  return visited.size - 1
}

function probeRuntime(archive) {
  archive = fs.realpathSync(archive)
  const count = verifyDependencyClosure(archive)
  const appRequire = createRequire(path.join(archive, 'package.json'))
  const before = new Set(Object.keys(require.cache))
  for (const entry of [
    '@modelcontextprotocol/sdk/client/index.js',
    '@modelcontextprotocol/sdk/client/stdio.js',
    '@modelcontextprotocol/sdk/client/streamableHttp.js',
    '@modelcontextprotocol/sdk/server/mcp.js',
    'node-pty'
  ]) {
    appRequire(entry)
  }
  const Database = appRequire('better-sqlite3')
  const database = new Database(':memory:')
  try {
    assert.equal(database.prepare('SELECT 1 AS value').get().value, 1)
  } finally {
    database.close()
  }
  for (const filename of Object.keys(require.cache)) {
    if (before.has(filename)) continue
    if (!isInside(archive, filename) && !isInside(`${archive}.unpacked`, filename)) {
      throw new Error(`Runtime dependency loaded from outside the app: ${filename}`)
    }
  }
  console.log(`Packaged runtime verified: ${count} packages, MCP transports, SQLite, and PTY.`)
}

function verifyPackagedApp(appPath) {
  const app = path.resolve(appPath)
  const archive = path.join(app, 'Contents', 'Resources', 'app.asar')
  const executableName = execFileSync(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')],
    { encoding: 'utf8' }
  ).trim()
  const executable = path.join(app, 'Contents', 'MacOS', executableName)
  // This is a build-time Electron probe, not application runtime configuration.
  // It never boots Owls or opens the user's profile/database.
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  delete env.NODE_OPTIONS
  delete env.NODE_PATH
  const result = spawnSync(executable, [__filename, '--probe', archive], {
    cwd: tmpdir(),
    env,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `Packaged runtime verification failed: ${result.error?.message || result.signal || result.status}\n${result.stderr || ''}${result.stdout || ''}`
    )
  }
  if (!result.stdout.includes('Packaged runtime verified:')) {
    throw new Error('Packaged runtime probe did not report success')
  }
  console.log(result.stdout.trim())
}

module.exports = { verifyDependencyClosure, verifyPackagedApp }

if (require.main === module) {
  try {
    if (process.argv[2] === '--probe' && process.argv[3]) {
      probeRuntime(path.resolve(process.argv[3]))
    } else if (process.argv.length === 3) {
      verifyPackagedApp(process.argv[2])
    } else {
      throw new Error('Usage: node scripts/verify-packaged-runtime.cjs <path/to/Owls.app>')
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
