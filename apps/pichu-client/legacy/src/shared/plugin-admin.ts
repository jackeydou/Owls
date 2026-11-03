export type PluginAdminVersion = {
  id: number
  version: string
  packageSha256: string
  packageSizeBytes: number
  sourcePath: string
  uploadedAt: string
}

export type PluginAdminCatalogItem = {
  id: number
  pluginName: string
  displayName: string
  description: string | null
  category: string
  icon: string | null
  localSourcePath: string
  versions: PluginAdminVersion[]
}

export const PLUGIN_ADMIN_LOCAL_DEV_MARKETPLACE_NAME = 'pichu-internal-dev-plugins'

export type PluginAdminUploadVersionInput = {
  pluginName: string
  filePath: string
  category?: string
}

export type PluginAdminCancelUploadInput = {
  pluginName: string
}

export type PluginAdminCancelUploadResult = {
  cancelled: boolean
}

export type PluginAdminLocalUploadResult = {
  localDev: true
  pluginName: string
  version: string
  marketplaceName: string
  sourcePath: string
  installedPluginId: string
  packageSha256: string
  packageSizeBytes: number
  uploadedAt: string
}

export type PluginAdminUploadResult = PluginAdminLocalUploadResult

export type PluginAdminLocalVersionInput = {
  pluginName: string
  version: string
}

export type PluginAdminLocalVersionRemoveResult = {
  removed: boolean
  uninstalled: boolean
}

const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,126}[a-z0-9]$/
const PLUGIN_VERSION_MAX_LENGTH = 64

const PLUGIN_NAME_ERROR =
  'Plugin name must be kebab-case and contain only lowercase letters, numbers, and hyphens.'

export function normalizePluginAdminName(pluginName: string): string {
  const normalized = pluginName.trim()
  if (!PLUGIN_NAME_PATTERN.test(normalized)) {
    throw new Error(PLUGIN_NAME_ERROR)
  }
  return normalized
}

export function normalizePluginAdminVersion(version: string): string {
  const normalized = version.trim()
  if (!normalized) {
    throw new Error('Plugin version is required.')
  }
  if (normalized.length > PLUGIN_VERSION_MAX_LENGTH) {
    throw new Error('Plugin version must be 64 characters or fewer.')
  }
  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new Error('Plugin version must not contain path separators.')
  }
  if (/\s/.test(normalized)) {
    throw new Error('Plugin version must not contain whitespace.')
  }
  return normalized
}

export function assertPluginAdminUploadFilePath(filePath: string): string {
  const normalized = filePath.trim()
  if (!normalized) {
    throw new Error('Plugin zip file path is required.')
  }
  if (!normalized.toLowerCase().endsWith('.zip')) {
    throw new Error('Plugin package must be a .zip file.')
  }
  return normalized
}
