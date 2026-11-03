import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, normalize, relative, sep } from 'node:path'
import type {
  PluginAdminCatalogItem,
  PluginAdminLocalUploadResult,
  PluginAdminVersion
} from '../../shared/plugin-admin.js'
import {
  assertPluginAdminUploadFilePath,
  normalizePluginAdminName,
  normalizePluginAdminVersion
} from '../../shared/plugin-admin.js'
import { getDataRoot } from '../pichu-paths.js'
import { loadPluginManifestAsync } from './manifest-loader.js'
import { extractPluginZipArchive } from './marketplace-loader.js'
import {
  installPluginFromDeveloperUpload,
  listInstalledPluginsAsync,
  uninstallPlugin
} from './plugin-registry.js'
import type { InstalledPlugin } from './plugin-types.js'
import { validatePluginPackageAsync } from './plugin-validator.js'

function versionDirName(version: string): string {
  return version.replace(/[^a-zA-Z0-9._-]/g, '_') || 'local'
}

function developerUploadSourceDir(pluginName: string, version: string): string {
  return join(getDataRoot(), 'plugins', 'dev-sources', pluginName, versionDirName(version))
}

function localUploadRecordsPath(): string {
  return join(getDataRoot(), 'plugins', 'admin-local-uploads.json')
}

function compareVersions(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

type LocalUploadRecord = {
  pluginName: string
  displayName: string
  description: string | null
  category: string
  icon: string | null
  version: string
  packageSha256: string
  packageSizeBytes: number
  sourcePath: string
  installedPluginId: string
  uploadedAt: string
}

type LocalUploadRecordsFile = {
  schemaVersion: string
  uploads: LocalUploadRecord[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeLocalUploadRecord(value: unknown): LocalUploadRecord | null {
  if (!isRecord(value)) return null
  if (
    typeof value.pluginName !== 'string' ||
    typeof value.displayName !== 'string' ||
    typeof value.version !== 'string' ||
    typeof value.packageSha256 !== 'string' ||
    typeof value.packageSizeBytes !== 'number' ||
    typeof value.sourcePath !== 'string' ||
    typeof value.installedPluginId !== 'string' ||
    typeof value.uploadedAt !== 'string'
  ) {
    return null
  }

  return {
    pluginName: value.pluginName,
    displayName: value.displayName,
    description: typeof value.description === 'string' ? value.description : null,
    category: typeof value.category === 'string' ? value.category : '',
    icon: typeof value.icon === 'string' ? value.icon : null,
    version: value.version,
    packageSha256: value.packageSha256,
    packageSizeBytes: value.packageSizeBytes,
    sourcePath: value.sourcePath,
    installedPluginId: value.installedPluginId,
    uploadedAt: value.uploadedAt
  }
}

async function readLocalUploadRecordsFile(): Promise<LocalUploadRecordsFile> {
  try {
    const raw = JSON.parse(await readFile(localUploadRecordsPath(), 'utf8')) as unknown
    if (!isRecord(raw) || !Array.isArray(raw.uploads)) {
      return { schemaVersion: '1.0', uploads: [] }
    }

    return {
      schemaVersion: typeof raw.schemaVersion === 'string' ? raw.schemaVersion : '1.0',
      uploads: raw.uploads.flatMap((entry) => {
        const record = normalizeLocalUploadRecord(entry)
        return record ? [record] : []
      })
    }
  } catch {
    return { schemaVersion: '1.0', uploads: [] }
  }
}

async function writeLocalUploadRecordsFile(recordsFile: LocalUploadRecordsFile): Promise<void> {
  await mkdir(join(getDataRoot(), 'plugins'), { recursive: true })
  await writeFile(localUploadRecordsPath(), `${JSON.stringify(recordsFile, null, 2)}\n`, 'utf8')
}

async function upsertLocalUploadRecord(record: LocalUploadRecord): Promise<void> {
  const recordsFile = await readLocalUploadRecordsFile()
  const uploads = [
    ...recordsFile.uploads.filter(
      (entry) => !(entry.pluginName === record.pluginName && entry.version === record.version)
    ),
    record
  ].sort((left, right) => {
    const pluginOrder = left.pluginName.localeCompare(right.pluginName)
    if (pluginOrder !== 0) return pluginOrder
    const versionOrder = compareVersions(right.version, left.version)
    if (versionOrder !== 0) return versionOrder
    return right.uploadedAt.localeCompare(left.uploadedAt)
  })

  await writeLocalUploadRecordsFile({
    schemaVersion: '1.0',
    uploads
  })
}

async function localUploadRecord(pluginName: string, version: string): Promise<LocalUploadRecord> {
  const recordsFile = await readLocalUploadRecordsFile()
  const record = recordsFile.uploads.find(
    (entry) => entry.pluginName === pluginName && entry.version === version
  )
  if (!record) {
    throw new Error(`Local plugin version not found: ${pluginName} ${version}`)
  }
  return record
}

async function removeLocalUploadRecord(record: LocalUploadRecord): Promise<void> {
  const recordsFile = await readLocalUploadRecordsFile()
  await writeLocalUploadRecordsFile({
    schemaVersion: '1.0',
    uploads: recordsFile.uploads.filter(
      (entry) =>
        !(
          entry.pluginName === record.pluginName &&
          entry.version === record.version &&
          entry.packageSha256 === record.packageSha256
        )
    )
  })
}

function localAdminId(seed: string): number {
  const hash = createHash('sha256').update(seed).digest()
  return -1 - (hash.readUInt32BE(0) % 1_000_000_000)
}

function localVersionFromRecord(record: LocalUploadRecord): PluginAdminVersion {
  return {
    id: localAdminId(
      `local-version:${record.pluginName}:${record.version}:${record.packageSha256}`
    ),
    version: record.version,
    packageSha256: record.packageSha256,
    packageSizeBytes: record.packageSizeBytes,
    sourcePath: record.sourcePath,
    uploadedAt: record.uploadedAt
  }
}

function sortAdminVersions(versions: PluginAdminVersion[]): PluginAdminVersion[] {
  return [...versions].sort((left, right) => {
    const versionOrder = compareVersions(right.version, left.version)
    if (versionOrder !== 0) return versionOrder
    return right.uploadedAt.localeCompare(left.uploadedAt)
  })
}

export async function listLocalPluginUploads(): Promise<PluginAdminCatalogItem[]> {
  const records = (await readLocalUploadRecordsFile()).uploads
  if (records.length === 0) return []

  const pluginsByName = new Map<string, PluginAdminCatalogItem>()
  for (const record of records) {
    const existing = pluginsByName.get(record.pluginName)
    const pluginId = existing?.id ?? localAdminId(`local-plugin:${record.pluginName}`)
    const localVersion = localVersionFromRecord(record)

    if (existing) {
      pluginsByName.set(record.pluginName, {
        ...existing,
        icon: existing.icon ?? record.icon,
        localSourcePath: existing.icon ? existing.localSourcePath : record.sourcePath,
        versions: sortAdminVersions([
          ...existing.versions.filter(
            (version) =>
              !(
                version.version === record.version && version.packageSha256 === record.packageSha256
              )
          ),
          localVersion
        ])
      })
      continue
    }

    pluginsByName.set(record.pluginName, {
      id: pluginId,
      pluginName: record.pluginName,
      displayName: record.displayName || record.pluginName,
      description: record.description,
      category: record.category,
      icon: record.icon,
      localSourcePath: record.sourcePath,
      versions: [localVersion]
    })
  }

  return [...pluginsByName.values()].sort((left, right) =>
    left.pluginName.localeCompare(right.pluginName)
  )
}

async function packageInfo(filePath: string): Promise<{
  packageSha256: string
  packageSizeBytes: number
}> {
  const [packageBuffer, packageStat] = await Promise.all([readFile(filePath), stat(filePath)])
  return {
    packageSha256: createHash('sha256').update(packageBuffer).digest('hex'),
    packageSizeBytes: packageStat.size
  }
}

function isNodeModulesRelativePath(path: string): boolean {
  return path.split(sep).includes('node_modules')
}

async function directoryPackageInfo(root: string): Promise<{
  packageSha256: string
  packageSizeBytes: number
}> {
  const hash = createHash('sha256')
  let packageSizeBytes = 0

  async function walk(dir: string): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name)
    )

    for (const entry of entries) {
      const path = join(dir, entry.name)
      const relativePath = relative(root, path)
      if (isNodeModulesRelativePath(relativePath)) continue
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!entry.isFile()) continue

      const content = await readFile(path)
      packageSizeBytes += content.byteLength
      hash.update(relativePath)
      hash.update('\0')
      hash.update(content)
      hash.update('\0')
    }
  }

  await walk(root)
  return {
    packageSha256: hash.digest('hex'),
    packageSizeBytes
  }
}

async function replacePluginSourceDirectory(
  sourcePath: string,
  destination: string
): Promise<void> {
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  try {
    await cp(sourcePath, destination, {
      recursive: true,
      dereference: false,
      filter: (src) => !isNodeModulesRelativePath(relative(sourcePath, src))
    })
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}

function throwIfUploadCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new Error('Plugin upload cancelled.')
  error.name = 'PluginUploadCancelledError'
  throw error
}

export async function installPluginDirectoryToLocalDev(params: {
  sourcePath: string
  category?: string
}): Promise<InstalledPlugin> {
  const loaded = await loadPluginManifestAsync(params.sourcePath)
  const normalizedName = normalizePluginAdminName(loaded.manifest.name)
  const validation = await validatePluginPackageAsync(loaded.pluginRoot)
  const errors = validation.diagnostics.filter((diagnostic) => diagnostic.level === 'error')
  if (errors.length) {
    throw new Error(errors.map((diagnostic) => diagnostic.message).join('\n'))
  }

  const version = loaded.manifest.version || 'local'
  const destination = developerUploadSourceDir(normalizedName, version)
  let installed: InstalledPlugin | null = null

  try {
    await replacePluginSourceDirectory(loaded.pluginRoot, destination)

    const installedManifest = await loadPluginManifestAsync(destination)
    const postInstallValidation = await validatePluginPackageAsync(destination)
    const postErrors = postInstallValidation.diagnostics.filter(
      (diagnostic) => diagnostic.level === 'error'
    )
    if (postErrors.length) {
      throw new Error(postErrors.map((diagnostic) => diagnostic.message).join('\n'))
    }

    const { packageSha256, packageSizeBytes } = await directoryPackageInfo(destination)
    installed = await installPluginFromDeveloperUpload({
      sourcePath: destination,
      packageSha256
    })
    const uploadedAt = new Date().toISOString()
    await upsertLocalUploadRecord({
      pluginName: normalizedName,
      displayName: installedManifest.manifest.interface?.displayName ?? normalizedName,
      description: installedManifest.manifest.description || null,
      category: params.category?.trim() || installedManifest.manifest.interface?.category || '',
      icon:
        installedManifest.manifest.interface?.icon ??
        installedManifest.manifest.interface?.composerIcon ??
        installedManifest.manifest.interface?.logo ??
        null,
      version,
      packageSha256,
      packageSizeBytes,
      sourcePath: normalize(destination),
      installedPluginId: installed.id,
      uploadedAt
    })
  } catch (error) {
    if (!installed) {
      await rm(destination, { recursive: true, force: true })
    }
    throw error
  }
  if (!installed) {
    throw new Error(`Local plugin install did not complete: ${normalizedName} ${version}`)
  }

  return installed
}

export async function uploadPluginVersionToLocalDev(
  pluginName: string,
  filePath: string,
  options?: {
    category?: string
    signal?: AbortSignal
    onAuthLoginStart?: (pluginName: string) => void
  }
): Promise<PluginAdminLocalUploadResult> {
  const normalizedName = normalizePluginAdminName(pluginName)
  const normalizedPath = assertPluginAdminUploadFilePath(filePath)
  const extractRoot = join(getDataRoot(), 'plugins', '.extract-tmp', normalizedName)
  const uploadedAt = new Date().toISOString()
  const { packageSha256, packageSizeBytes } = await packageInfo(normalizedPath)

  throwIfUploadCancelled(options?.signal)
  await rm(extractRoot, { recursive: true, force: true })
  await mkdir(extractRoot, { recursive: true })

  try {
    const pluginRoot = await extractPluginZipArchive(normalizedPath, extractRoot)
    throwIfUploadCancelled(options?.signal)
    const loaded = await loadPluginManifestAsync(pluginRoot)
    if (loaded.manifest.name !== normalizedName) {
      throw new Error(
        `Plugin manifest name "${loaded.manifest.name}" does not match "${normalizedName}".`
      )
    }

    const validation = await validatePluginPackageAsync(pluginRoot)
    const errors = validation.diagnostics.filter((diagnostic) => diagnostic.level === 'error')
    if (errors.length) {
      throw new Error(errors.map((diagnostic) => diagnostic.message).join('\n'))
    }

    const version = loaded.manifest.version || 'local'
    const destination = developerUploadSourceDir(normalizedName, version)
    let installed: InstalledPlugin | null = null

    try {
      await replacePluginSourceDirectory(pluginRoot, destination)
      if (options?.signal?.aborted) {
        await rm(destination, { recursive: true, force: true })
      }
      throwIfUploadCancelled(options?.signal)

      const installedManifest = await loadPluginManifestAsync(destination)
      const postInstallValidation = await validatePluginPackageAsync(destination)
      const postErrors = postInstallValidation.diagnostics.filter(
        (diagnostic) => diagnostic.level === 'error'
      )
      if (postErrors.length) {
        throw new Error(postErrors.map((diagnostic) => diagnostic.message).join('\n'))
      }

      installed = await installPluginFromDeveloperUpload({
        sourcePath: destination,
        packageSha256,
        signal: options?.signal,
        onAuthLoginStart: (plugin) => options?.onAuthLoginStart?.(plugin.name)
      })
      await upsertLocalUploadRecord({
        pluginName: normalizedName,
        displayName: installedManifest.manifest.interface?.displayName ?? normalizedName,
        description: installedManifest.manifest.description || null,
        category: options?.category?.trim() || installedManifest.manifest.interface?.category || '',
        icon:
          installedManifest.manifest.interface?.icon ??
          installedManifest.manifest.interface?.composerIcon ??
          installedManifest.manifest.interface?.logo ??
          null,
        version,
        packageSha256,
        packageSizeBytes,
        sourcePath: normalize(destination),
        installedPluginId: installed.id,
        uploadedAt
      })
    } catch (error) {
      if (!installed) {
        await rm(destination, { recursive: true, force: true })
      }
      throw error
    }
    if (!installed) {
      throw new Error(`Local plugin upload did not complete: ${normalizedName} ${version}`)
    }

    return {
      localDev: true,
      pluginName: normalizedName,
      version,
      marketplaceName: '',
      sourcePath: normalize(destination),
      installedPluginId: installed.id,
      packageSha256,
      packageSizeBytes,
      uploadedAt
    }
  } finally {
    await rm(extractRoot, { recursive: true, force: true })
  }
}

export async function installPluginVersionFromLocalDev(params: {
  pluginName: string
  version: string
}): Promise<PluginAdminLocalUploadResult> {
  const pluginName = normalizePluginAdminName(params.pluginName)
  const version = normalizePluginAdminVersion(params.version)
  const record = await localUploadRecord(pluginName, version)
  const installed = await installPluginFromDeveloperUpload({
    sourcePath: record.sourcePath,
    packageSha256: record.packageSha256
  })
  await upsertLocalUploadRecord({
    ...record,
    installedPluginId: installed.id
  })

  return {
    localDev: true,
    pluginName,
    version: record.version,
    marketplaceName: '',
    sourcePath: normalize(record.sourcePath),
    installedPluginId: installed.id,
    packageSha256: record.packageSha256,
    packageSizeBytes: record.packageSizeBytes,
    uploadedAt: record.uploadedAt
  }
}

export async function uninstallPluginVersionFromLocalDev(params: {
  pluginName: string
  version: string
}): Promise<{ removed: boolean; uninstalled: boolean }> {
  const pluginName = normalizePluginAdminName(params.pluginName)
  const version = normalizePluginAdminVersion(params.version)
  const record = await localUploadRecord(pluginName, version)
  const installed = (await listInstalledPluginsAsync()).find((plugin) => {
    if (plugin.name !== pluginName) return false
    if (plugin.sourceMetadata.installedFrom !== 'developer-upload') return false
    return plugin.sourceMetadata.resolvedSourcePath === record.sourcePath
  })

  if (installed) {
    await uninstallPlugin(installed.id)
  }
  await removeLocalUploadRecord(record)
  await rm(record.sourcePath, { recursive: true, force: true })

  return { removed: true, uninstalled: Boolean(installed) }
}
