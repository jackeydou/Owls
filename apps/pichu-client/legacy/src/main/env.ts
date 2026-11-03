import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getDataRoot } from './pichu-paths.js'

const UNSUPPORTED_NPM_CONFIG_ENV_KEYS = new Set([
  'shamefully-hoist',
  'npm-globalconfig',
  'recursive',
  'verify-deps-before-run',
  '_jsr-registry'
])

export const PICHU_NPM_REGISTRY_URL = 'https://registry.npmjs.org'
export const PICHU_NPM_FALLBACK_REGISTRY_URL = 'https://registry.npmjs.org'
export const PICHU_PIP_INDEX_URL = 'https://pypi.org/simple'
export const PICHU_PIP_EXTRA_INDEX_URL = 'https://pypi.org/simple'
export const PICHU_PYPI_JSON_BASE_URL = 'https://pypi.org/pypi'

const PICHU_NPM_CACHE_MARKER = '.pichu-cache-ready'

function runtimeNpmCachePath(): string {
  const cachePath = join(getDataRoot(), 'runtimes', 'npm-cache')
  const markerPath = join(cachePath, PICHU_NPM_CACHE_MARKER)

  if (existsSync(markerPath)) return cachePath

  try {
    mkdirSync(dirname(cachePath), { recursive: true })
    if (existsSync(cachePath)) {
      renameSync(cachePath, `${cachePath}.legacy-${Date.now()}`)
    }
    mkdirSync(cachePath, { recursive: true })
    writeFileSync(markerPath, 'ok\n', { flag: 'wx' })
  } catch {
    // Best effort. npm will surface any remaining filesystem issue with context.
  }

  return cachePath
}

function normalizedNpmConfigName(key: string): string | null {
  const match = /^npm_config_(.+)$/i.exec(key)
  if (!match) return null

  const suffix = match[1].toLowerCase()
  if (suffix.startsWith('__')) {
    return `_${suffix.slice(2).replaceAll('_', '-')}`
  }
  if (suffix.startsWith('_')) {
    return `_${suffix.slice(1).replaceAll('_', '-')}`
  }
  return suffix.replaceAll('_', '-')
}

export function removeUnsupportedNpmConfigEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let next: NodeJS.ProcessEnv | null = null

  for (const key of Object.keys(env)) {
    const normalized = normalizedNpmConfigName(key)
    if (!normalized || !UNSUPPORTED_NPM_CONFIG_ENV_KEYS.has(normalized)) continue

    next ??= { ...env }
    delete next[key]
  }

  return next ?? env
}

export function withDefaultRuntimePackageRegistryEnv(
  env: NodeJS.ProcessEnv,
  caBundlePath?: string | null
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {
    ...env,
    NPM_CONFIG_REGISTRY:
      env.NPM_CONFIG_REGISTRY ?? env.npm_config_registry ?? PICHU_NPM_REGISTRY_URL,
    npm_config_registry:
      env.npm_config_registry ?? env.NPM_CONFIG_REGISTRY ?? PICHU_NPM_REGISTRY_URL,
    PIP_INDEX_URL: env.PIP_INDEX_URL ?? PICHU_PIP_INDEX_URL,
    PIP_EXTRA_INDEX_URL: env.PIP_EXTRA_INDEX_URL ?? PICHU_PIP_EXTRA_INDEX_URL,
    UV_INDEX_URL: env.UV_INDEX_URL ?? PICHU_PIP_INDEX_URL,
    UV_EXTRA_INDEX_URL: env.UV_EXTRA_INDEX_URL ?? PICHU_PIP_EXTRA_INDEX_URL
  }
  if (!caBundlePath) return next

  return {
    ...next,
    SSL_CERT_FILE: next.SSL_CERT_FILE ?? caBundlePath,
    REQUESTS_CA_BUNDLE: next.REQUESTS_CA_BUNDLE ?? caBundlePath,
    PIP_CERT: next.PIP_CERT ?? caBundlePath,
    NODE_EXTRA_CA_CERTS: next.NODE_EXTRA_CA_CERTS ?? caBundlePath
  }
}

export function withDefaultRuntimePackageManagerEnv(
  env: NodeJS.ProcessEnv,
  caBundlePath?: string | null
): NodeJS.ProcessEnv {
  const next = withDefaultRuntimePackageRegistryEnv(env, caBundlePath)
  const npmPrefix = join(getDataRoot(), 'runtimes', 'npm-global')
  const npmCache = runtimeNpmCachePath()

  return {
    ...next,
    NPM_CONFIG_PREFIX: next.NPM_CONFIG_PREFIX ?? next.npm_config_prefix ?? npmPrefix,
    npm_config_prefix: next.npm_config_prefix ?? next.NPM_CONFIG_PREFIX ?? npmPrefix,
    NPM_CONFIG_CACHE: next.NPM_CONFIG_CACHE ?? next.npm_config_cache ?? npmCache,
    npm_config_cache: next.npm_config_cache ?? next.NPM_CONFIG_CACHE ?? npmCache
  }
}
