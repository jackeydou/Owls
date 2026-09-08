import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'

export const BUNDLED_NODE_VERSION = '24.15.0'

let cachedNodePath: string | null | undefined
let cachedAppBundledNodePath: string | null | undefined
let cachedBundledNodeVersion: string | undefined

export function bundledNodeRuntimeName(): string {
  return `${process.platform}-${process.arch}`
}

function bundledNodeExecutableName(): string {
  return process.platform === 'win32' ? 'node.exe' : 'node'
}

function bundledNodeRelativePath(): string {
  return join('node', bundledNodeRuntimeName(), 'bin', bundledNodeExecutableName())
}

function candidateAppBundledNodePaths(): string[] {
  const resourcesPath =
    typeof process.resourcesPath === 'string' ? process.resourcesPath : undefined

  return [
    ...(resourcesPath ? [join(resourcesPath, bundledNodeRelativePath())] : []),
    join(process.cwd(), 'resources', bundledNodeRelativePath()),
    resolve(import.meta.dirname, '..', '..', 'resources', bundledNodeRelativePath())
  ]
}

export function findBundledNodePath(): string | null {
  if (cachedNodePath !== undefined && cachedNodePath && existsSync(cachedNodePath)) {
    return cachedNodePath
  }

  cachedBundledNodeVersion = undefined
  cachedNodePath = findAppBundledNodePath()
  return cachedNodePath
}

function findAppBundledNodePath(): string | null {
  if (cachedAppBundledNodePath !== undefined) {
    return cachedAppBundledNodePath
  }

  cachedAppBundledNodePath = candidateAppBundledNodePaths().find(isUsableNodePath) ?? null
  return cachedAppBundledNodePath
}

function isUsableNodePath(path: string): boolean {
  if (!existsSync(path)) return false

  const result = spawnSync(path, ['--version'], {
    encoding: 'utf8',
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 1500,
    windowsHide: true
  })
  if (result.error || result.signal || result.status !== 0) return false
  return /^v\d+\.\d+\.\d+\b/.test(result.stdout.trim())
}

function isAppBundledNodePath(path: string): boolean {
  return candidateAppBundledNodePaths().some((candidate) => candidate === path)
}

export function findBundledNodeBinPath(): string | null {
  const nodePath = findBundledNodePath()
  return nodePath ? dirname(nodePath) : null
}

export function requireBundledNodePath(): string {
  const nodePath = findBundledNodePath()
  if (!nodePath) {
    throw new Error(`Owls app-bundled Node.js runtime is missing for ${bundledNodeRuntimeName()}.`)
  }
  return nodePath
}

export function getBundledNodeVersion(): string {
  if (cachedBundledNodeVersion !== undefined) {
    return cachedBundledNodeVersion
  }

  const nodePath = requireBundledNodePath()
  const result = spawnSync(nodePath, ['--version'], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`Bundled Node.js runtime failed version check at ${nodePath}`)
  }

  const version = result.stdout.trim().replace(/^v/, '')
  if (isAppBundledNodePath(nodePath) && version !== BUNDLED_NODE_VERSION) {
    throw new Error(
      `Bundled Node.js runtime version mismatch: expected ${BUNDLED_NODE_VERSION}, got ${version}`
    )
  }

  cachedBundledNodeVersion = version
  return cachedBundledNodeVersion
}

export function prependBundledNodeToPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nodeBinPath = findBundledNodeBinPath()
  if (!nodeBinPath) return env

  return {
    ...env,
    PATH: [nodeBinPath, env.PATH].filter(Boolean).join(delimiter)
  }
}

export function prependBundledRuntimeBinsToPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const binPaths = [findBundledNodeBinPath()].filter((path): path is string => Boolean(path))
  if (binPaths.length === 0) return env

  return {
    ...env,
    PATH: [...binPaths, env.PATH].filter(Boolean).join(delimiter)
  }
}
