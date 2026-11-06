import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { chmod, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const nodeVersion = '24.15.0'
const supportedNodeRuntimes = {
  'darwin-arm64': {
    platform: 'darwin',
    arch: 'arm64',
    archivePlatform: 'darwin',
    archiveArch: 'arm64',
    executable: 'bin/node',
    sha256: 'af5cfaeafe603aaf7599f287fd9d100bb41f16794f49788fa59dd3f25546930f'
  }
}

const appRoot = resolve(import.meta.dirname, '..')
const resourceRoot = join(appRoot, 'resources', 'node')
const runtimeName = `${process.platform}-${process.arch}`
const nodeRuntime = supportedNodeRuntimes[runtimeName]

if (!nodeRuntime) {
  throw new Error(
    `Unsupported bundled Node.js runtime ${runtimeName}. Add it to supportedNodeRuntimes in apps/owls-client/scripts/prepare-node-runtime.mjs.`
  )
}

const archiveRuntimeName = `${nodeRuntime.archivePlatform}-${nodeRuntime.archiveArch}`
const runtimeRoot = join(resourceRoot, runtimeName)
const nodeBinaryPath = join(runtimeRoot, nodeRuntime.executable)
const metadataPath = join(runtimeRoot, 'metadata.json')
const archiveName = `node-v${nodeVersion}-${archiveRuntimeName}.tar.xz`
const archiveUrl = `https://nodejs.org/download/release/v${nodeVersion}/${archiveName}`

function validateExistingRuntime() {
  if (!existsSync(nodeBinaryPath) || !existsSync(metadataPath)) return false
  if (existsSync(join(runtimeRoot, 'bin', 'npm')) || existsSync(join(runtimeRoot, 'lib')))
    return false

  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  if (
    metadata.version !== nodeVersion ||
    metadata.platform !== nodeRuntime.platform ||
    metadata.arch !== nodeRuntime.arch ||
    metadata.runtimeName !== runtimeName ||
    metadata.executable !== nodeRuntime.executable ||
    metadata.sha256 !== nodeRuntime.sha256
  ) {
    return false
  }

  const result = spawnSync(nodeBinaryPath, ['--version'], {
    encoding: 'utf8'
  })

  return result.status === 0 && result.stdout.trim() === `v${nodeVersion}`
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    ...options
  })

  if (result.status === 0) return result

  const stderr = result.stderr?.trim()
  const detail = stderr ? `\n${stderr}` : ''
  throw new Error(`${command} ${args.join(' ')} failed.${detail}`)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

if (validateExistingRuntime()) {
  console.log(`Node.js v${nodeVersion} runtime already prepared at ${runtimeRoot}`)
  process.exit(0)
}

const tempRoot = await mkdtemp(join(tmpdir(), 'owls-node-runtime-'))
const archivePath = join(tempRoot, archiveName)
const extractRoot = join(tempRoot, 'extract')
const packageRoot = join(extractRoot, `node-v${nodeVersion}-${archiveRuntimeName}`)

try {
  console.log(`Downloading Node.js v${nodeVersion} runtime from ${archiveUrl}`)
  run('curl', ['-fL', archiveUrl, '-o', archivePath], { stdio: 'inherit' })

  const actualSha = sha256(archivePath)
  if (actualSha !== nodeRuntime.sha256) {
    throw new Error(
      `Node.js runtime checksum mismatch: expected ${nodeRuntime.sha256}, got ${actualSha}`
    )
  }

  mkdirSync(extractRoot, { recursive: true })
  run('tar', ['-xJf', archivePath, '-C', extractRoot])

  const extractedNodePath = join(packageRoot, nodeRuntime.executable)
  if (!existsSync(extractedNodePath)) {
    throw new Error(`Node.js runtime archive did not contain ${extractedNodePath}`)
  }

  rmSync(runtimeRoot, { recursive: true, force: true })
  mkdirSync(dirname(nodeBinaryPath), { recursive: true })
  copyFileSync(extractedNodePath, nodeBinaryPath)
  copyFileSync(join(packageRoot, 'LICENSE'), join(runtimeRoot, 'LICENSE'))
  copyFileSync(join(packageRoot, 'README.md'), join(runtimeRoot, 'README.md'))
  await chmod(nodeBinaryPath, 0o755)

  writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        ...nodeRuntime,
        version: nodeVersion,
        runtimeName,
        archiveRuntimeName,
        source: archiveUrl,
        executable: nodeRuntime.executable
      },
      null,
      2
    )}\n`
  )

  if (!validateExistingRuntime()) {
    throw new Error(`Prepared Node.js runtime failed validation at ${runtimeRoot}`)
  }

  console.log(`Prepared Node.js v${nodeVersion} runtime at ${runtimeRoot}`)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
