import { realpath } from 'node:fs/promises'
import { dirname, join, normalize, relative as relativePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDataRoot } from '../pichu-paths.js'

declare const __PICHU_DEV__: boolean

export type PluginAssetRootConfig = {
  dataRoot: string
  resourcesPath?: string
  devResourcesRoot?: string
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = normalize(parent)
  const normalizedChild = normalize(child)
  return (
    normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${sep}`)
  )
}

async function isRealPathInside(parent: string, child: string): Promise<boolean> {
  try {
    const [realParent, realChild] = await Promise.all([realpath(parent), realpath(child)])
    return isPathInside(realParent, realChild)
  } catch {
    return false
  }
}

function devResourcesRoot(): string | undefined {
  if (typeof __PICHU_DEV__ === 'undefined' || !__PICHU_DEV__) return undefined
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  // In dev, this module runs from Electron/Vite's main bundle directory,
  // matching marketplace-loader and skill-loader path resolution.
  return join(moduleDir, '..', '..', 'resources')
}

export function pluginAssetRootsForConfig(config: PluginAssetRootConfig): string[] {
  return [
    join(config.dataRoot, 'plugins'),
    config.resourcesPath ? join(config.resourcesPath, 'plugins') : '',
    config.devResourcesRoot ? join(config.devResourcesRoot, 'plugins') : ''
  ]
    .filter(Boolean)
    .map((path) => normalize(path))
}

export function pluginAssetRoots(): string[] {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return pluginAssetRootsForConfig({
    dataRoot: getDataRoot(),
    resourcesPath,
    devResourcesRoot: devResourcesRoot()
  })
}

export function pluginAssetPathFromUrl(urlString: string): string {
  const url = new URL(urlString)
  const queryPath = url.searchParams.get('path')?.trim()
  if (queryPath) return normalize(queryPath)
  return normalize(decodeURIComponent(url.pathname.slice(1)))
}

export async function isAllowedPluginAssetPath(
  path: string,
  roots = pluginAssetRoots()
): Promise<boolean> {
  for (const root of roots) {
    if (await isRealPathInside(root, path)) return true
  }
  return isAllowedRuntimePluginAssetPath(path)
}

async function isAllowedRuntimePluginAssetPath(path: string): Promise<boolean> {
  const runtimeCacheRoot = normalize(join(getDataRoot(), 'runtimes', 'cache'))
  if (!isPathInside(runtimeCacheRoot, path)) return false

  if (!(await isRealPathInside(runtimeCacheRoot, path))) return false

  const segments = relativePath(runtimeCacheRoot, normalize(path)).split(sep).filter(Boolean)
  return (
    segments.length >= 7 &&
    segments[3] === 'plugins' &&
    segments[4] === 'plugins' &&
    !segments.some((segment) => segment === '..')
  )
}
