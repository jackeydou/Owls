import { createWriteStream } from 'node:fs'
import { access, chmod, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { type Entry, openPromise } from 'yauzl'
import { getDataRoot } from '../pichu-paths.js'
import {
  findPluginManifestPathAsync,
  loadPluginManifestAsync,
  resolvePluginComponentPathAsync
} from './manifest-loader.js'
import { isPluginHiddenFromUsers } from './plugin-exposure.js'
import { computePluginSourceSha256 } from './plugin-source-digest.js'
import type {
  NormalizedPluginManifest,
  PluginDiagnostic,
  PluginMarketplace,
  PluginMarketplaceEntry,
  PluginMarketplaceScope,
  PluginMarketplaceSkillSummary,
  PluginMarketplaceSource
} from './plugin-types.js'

declare const __PICHU_DEV__: boolean

const SKILL_FILE_NAME = 'SKILL.md'
const MAX_PLUGIN_ZIP_BYTES = 256 * 1024 * 1024
const MAX_PLUGIN_ZIP_ENTRIES = 20_000
const MAX_PLUGIN_ZIP_ENTRY_BYTES = 256 * 1024 * 1024
const MAX_PLUGIN_ZIP_TOTAL_BYTES = 1024 * 1024 * 1024
const MAX_PLUGIN_ZIP_COMPRESSION_RATIO = 200
const ZIP_UNIX_FILE_TYPE_MASK = 0o170000
const ZIP_UNIX_REGULAR_FILE = 0o100000
const ZIP_UNIX_DIRECTORY = 0o040000

export type ResolvedMarketplaceSource = {
  path: string
  resolvedSourceSha256?: string
}

type MarketplaceLocation = {
  path: string
  root: string
  defaultScope: PluginMarketplaceScope
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.filter(
    (entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())
  )
  return values.length ? values : undefined
}

function marketplaceRootFor(path: string): string {
  const normalized = normalize(path)
  if (normalized === normalize(join(getDataRoot(), 'plugins', 'marketplace.json'))) {
    return dirname(dirname(normalized))
  }
  if (basename(dirname(normalized)) === 'plugins') {
    return dirname(dirname(normalized))
  }
  return dirname(normalized)
}

function marketplaceScopeFor(
  _path: string,
  rawScope?: unknown,
  defaultScope: PluginMarketplaceScope = 'public'
): PluginMarketplaceScope {
  if (rawScope === 'internal') return 'internal'
  if (rawScope === 'public') return 'public'
  if (defaultScope === 'internal') return 'internal'
  return 'public'
}

function normalizeSource(source: unknown): PluginMarketplaceSource | null {
  if (typeof source === 'string') {
    return { type: 'local', path: source }
  }
  if (!isRecord(source)) return null

  const kind = optionalString(source.type) ?? optionalString(source.source)
  if (kind === 'local') {
    const path = optionalString(source.path)
    return path ? { type: 'local', path } : null
  }
  return null
}

function normalizePolicy(raw: unknown): PluginMarketplaceEntry['policy'] {
  if (!isRecord(raw)) return undefined
  const installation = optionalString(raw.installation)
  const authentication = optionalString(raw.authentication)
  return {
    installation:
      installation === 'INSTALLED_BY_DEFAULT' || installation === 'NOT_AVAILABLE'
        ? installation
        : 'AVAILABLE',
    authentication: authentication === 'ON_FIRST_USE' ? 'ON_FIRST_USE' : 'ON_INSTALL'
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function parseSkillFrontmatter(raw: string): { name?: string; description?: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return {}

  const frontmatter: { name?: string; description?: string } = {}
  for (const line of match[1].split(/\r?\n/)) {
    const parsed = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!parsed) continue

    const key = parsed[1]
    let value = parsed[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (key === 'name' || key === 'description') {
      frontmatter[key] = value
    }
  }

  return frontmatter
}

async function readMarketplaceSkillFromFile(
  filePath: string,
  source: {
    rootPath: string
    pluginRoot: string
    pluginName: string
    pluginVersion?: string
    scripts: NormalizedPluginManifest['scripts']
    commands: NormalizedPluginManifest['commands']
  }
): Promise<PluginMarketplaceSkillSummary | null> {
  const raw = await readFile(filePath, 'utf8')
  const frontmatter = parseSkillFrontmatter(raw)
  const baseDir = dirname(filePath)
  const fallbackName =
    basename(filePath) === SKILL_FILE_NAME ? basename(baseDir) : basename(filePath, '.md')
  const name = frontmatter.name?.trim() || fallbackName
  const description = frontmatter.description?.trim()

  if (!description) {
    return null
  }

  return {
    name,
    qualifiedName: `${source.pluginName}:${name}`,
    description,
    filePath,
    baseDir,
    sourceKind: 'plugin',
    sourceLabel: `${source.pluginName}@${source.pluginVersion ?? 'unknown'}`,
    sourceRoot: source.rootPath,
    pluginName: source.pluginName,
    pluginVersion: source.pluginVersion,
    pluginRoot: source.pluginRoot,
    pluginScripts: source.scripts,
    pluginCommands: source.commands
  }
}

async function walkMarketplaceSkills(
  dir: string,
  source: Parameters<typeof readMarketplaceSkillFromFile>[1],
  includeRootMarkdownFiles: boolean
): Promise<PluginMarketplaceSkillSummary[]> {
  if (!(await isDirectory(dir))) return []

  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name !== SKILL_FILE_NAME) continue

    const fullPath = join(dir, entry.name)
    if (!(await isFile(fullPath))) continue

    const skill = await readMarketplaceSkillFromFile(fullPath, source)
    return skill ? [skill] : []
  }

  const skills: PluginMarketplaceSkillSummary[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue
    }

    const fullPath = join(dir, entry.name)
    if (await isDirectory(fullPath)) {
      skills.push(...(await walkMarketplaceSkills(fullPath, source, false)))
      continue
    }

    if (!includeRootMarkdownFiles || !entry.name.endsWith('.md') || !(await isFile(fullPath))) {
      continue
    }

    const skill = await readMarketplaceSkillFromFile(fullPath, source)
    if (skill) {
      skills.push(skill)
    }
  }

  return skills
}

async function hydrateMarketplaceSkills(
  pluginRoot: string,
  manifest: NormalizedPluginManifest
): Promise<PluginMarketplaceSkillSummary[]> {
  if (!manifest.skills) return []

  try {
    const rootPath = await resolvePluginComponentPathAsync(pluginRoot, manifest.skills)
    return await walkMarketplaceSkills(
      rootPath,
      {
        rootPath,
        pluginRoot,
        pluginName: manifest.name,
        pluginVersion: manifest.version,
        scripts: manifest.scripts,
        commands: manifest.commands
      },
      true
    )
  } catch {
    return []
  }
}

function normalizeMarketplace(raw: unknown, location: MarketplaceLocation): PluginMarketplace {
  const diagnostics: PluginDiagnostic[] = []
  if (!isRecord(raw)) {
    throw new Error(`Marketplace must be a JSON object: ${location.path}`)
  }

  const name = optionalString(raw.name) ?? 'local'
  const scope = marketplaceScopeFor(location.path, raw.scope, location.defaultScope)
  const displayName =
    isRecord(raw.interface) && optionalString(raw.interface.displayName)
      ? optionalString(raw.interface.displayName)
      : name
  const plugins: PluginMarketplaceEntry[] = []
  const rawPlugins = Array.isArray(raw.plugins) ? raw.plugins : []

  for (const entry of rawPlugins) {
    if (!isRecord(entry)) {
      diagnostics.push({ level: 'warning', message: 'Skipped non-object plugin entry' })
      continue
    }
    const pluginName = optionalString(entry.name)
    const source = normalizeSource(entry.source)
    if (!pluginName || !source) {
      diagnostics.push({
        level: 'warning',
        message: 'Skipped marketplace entry without name or source'
      })
      continue
    }
    if (isPluginHiddenFromUsers({ name: pluginName })) {
      continue
    }
    plugins.push({
      name: pluginName,
      source,
      description: optionalString(entry.description),
      keywords: optionalStringArray(entry.keywords),
      version: optionalString(entry.version),
      auth: isRecord(entry.auth) ? (entry.auth as PluginMarketplaceEntry['auth']) : undefined,
      interface: isRecord(entry.interface)
        ? (entry.interface as PluginMarketplaceEntry['interface'])
        : undefined,
      iconUrl: optionalString(entry.icon_url) ?? optionalString(entry.iconUrl),
      scope,
      policy: normalizePolicy(entry.policy),
      category: optionalString(entry.category),
      marketplaceName: name,
      marketplacePath: location.path,
      marketplaceRoot: location.root
    })
  }

  return {
    name,
    displayName: displayName ?? name,
    scope,
    path: location.path,
    root: location.root,
    plugins,
    diagnostics
  }
}

async function readMarketplace(path: string): Promise<PluginMarketplace> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
  const marketplace = normalizeMarketplace(raw, {
    path,
    root: marketplaceRootFor(path),
    defaultScope: marketplaceScopeFor(path)
  })
  return rewriteDevMarketplaceSources(marketplace)
}

async function rewriteDevMarketplaceSources(
  marketplace: PluginMarketplace
): Promise<PluginMarketplace> {
  if (typeof __PICHU_DEV__ === 'undefined' || !__PICHU_DEV__) return marketplace
  if (marketplace.name !== 'local-pichu-plugins') return marketplace

  const sitesSource = resolve(marketplace.root, '../../../packages/pichu-sites-plugin/plugin')
  if (!(await pathExists(sitesSource))) return marketplace

  const sitesRelativeSource = `./${relative(marketplace.root, sitesSource).replaceAll('\\', '/')}`

  return {
    ...marketplace,
    plugins: marketplace.plugins.map((plugin) =>
      plugin.name === 'sites' && plugin.source.type === 'local'
        ? {
            ...plugin,
            source: {
              type: 'local',
              path: sitesRelativeSource
            }
          }
        : plugin
    )
  }
}

function packagedPublicMarketplacePathCandidates(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const devOnlySourceMarketplacePath =
    typeof __PICHU_DEV__ !== 'undefined' && __PICHU_DEV__
      ? join(moduleDir, '..', '..', 'resources', 'plugins', 'marketplace.json')
      : ''

  if (devOnlySourceMarketplacePath) {
    console.info('[plugins] dev marketplace path candidate:', devOnlySourceMarketplacePath)
  }

  return [
    resourcesPath ? join(resourcesPath, 'plugins', 'marketplace.json') : '',
    devOnlySourceMarketplacePath
  ].filter(Boolean)
}

export async function extractZipArchive(zipFilePath: string, extractRoot: string): Promise<void> {
  const archiveStat = await stat(zipFilePath)
  if (!archiveStat.isFile()) {
    throw new Error('Plugin ZIP must be a regular file')
  }
  if (archiveStat.size > MAX_PLUGIN_ZIP_BYTES) {
    throw new Error(`Plugin ZIP exceeds the ${MAX_PLUGIN_ZIP_BYTES} byte archive limit`)
  }
  await extractZipSafely(zipFilePath, extractRoot)
}

export async function extractPluginZipArchive(
  zipFilePath: string,
  extractRoot: string
): Promise<string> {
  await extractZipArchive(zipFilePath, extractRoot)
  return findExtractedPluginRoot(extractRoot)
}

export async function listPluginMarketplaces(): Promise<PluginMarketplace[]> {
  const seen = new Set<string>()
  const marketplaces: PluginMarketplace[] = []

  const loadLocalMarketplaces = async (paths: string[]): Promise<void> => {
    for (const path of paths) {
      const normalized = normalize(path)
      if (seen.has(normalized) || !(await pathExists(normalized))) continue
      seen.add(normalized)
      try {
        if (!(await stat(normalized)).isFile()) continue
        marketplaces.push(await readMarketplace(normalized))
      } catch (error) {
        marketplaces.push({
          name: normalized,
          displayName: normalized,
          scope: marketplaceScopeFor(normalized),
          path: normalized,
          root: marketplaceRootFor(normalized),
          plugins: [],
          diagnostics: [
            {
              level: 'error',
              message: error instanceof Error ? error.message : String(error),
              path: normalized
            }
          ]
        })
      }
    }
  }

  await loadLocalMarketplaces(packagedPublicMarketplacePathCandidates())

  return marketplaces
}

export async function listAvailablePluginEntries(): Promise<PluginMarketplaceEntry[]> {
  const marketplaces = await listPluginMarketplaces()
  const entriesByName = new Map<string, PluginMarketplaceEntry>()

  for (const marketplace of marketplaces) {
    for (const plugin of marketplace.plugins) {
      entriesByName.set(plugin.name, await hydrateMarketplaceEntry(plugin))
    }
  }

  return [...entriesByName.values()].sort((left, right) => left.name.localeCompare(right.name))
}

async function hydrateMarketplaceEntry(
  entry: PluginMarketplaceEntry
): Promise<PluginMarketplaceEntry> {
  if (entry.source.type !== 'local') return entry

  try {
    const resolvedSourcePath = resolveLocalMarketplaceSource(entry)
    const loaded = await loadPluginManifestAsync(resolvedSourcePath)
    return {
      ...entry,
      description: loaded.manifest.description,
      keywords: loaded.manifest.keywords,
      version: loaded.manifest.version,
      auth: loaded.manifest.auth,
      skills: await hydrateMarketplaceSkills(resolvedSourcePath, loaded.manifest),
      interface: loaded.manifest.interface,
      resolvedSourcePath
    }
  } catch {
    return entry
  }
}

export function resolveLocalMarketplaceSource(entry: PluginMarketplaceEntry): string {
  if (entry.source.type !== 'local') {
    throw new Error('Only local plugin sources are supported in the MVP')
  }
  if (!entry.source.path.startsWith('./')) {
    throw new Error(`Local plugin source must start with "./": ${entry.source.path}`)
  }
  return resolve(entry.marketplaceRoot, entry.source.path)
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = normalize(parent)
  const normalizedChild = normalize(child)
  return (
    normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${sep}`)
  )
}

function zipEntryUnixMode(entry: Entry): number {
  return (entry.externalFileAttributes >>> 16) & 0xffff
}

function zipEntryPermissionMode(entry: Entry): number | null {
  const mode = zipEntryUnixMode(entry) & 0o777
  return mode === 0 ? null : mode
}

function isZipDirectory(entry: Entry): boolean {
  return entry.fileName.endsWith('/') || (entry.externalFileAttributes & 0x10) !== 0
}

function assertSupportedZipEntryType(entry: Entry, isDirectory: boolean): void {
  const fileType = zipEntryUnixMode(entry) & ZIP_UNIX_FILE_TYPE_MASK
  if (fileType === 0) return
  const expectedType = isDirectory ? ZIP_UNIX_DIRECTORY : ZIP_UNIX_REGULAR_FILE
  if (fileType !== expectedType) {
    throw new Error(`Plugin ZIP contains an unsupported special file: ${entry.fileName}`)
  }
}

function assertZipEntrySize(entry: Entry, declaredTotalBytes: number): number {
  if (entry.uncompressedSize > MAX_PLUGIN_ZIP_ENTRY_BYTES) {
    throw new Error(`Plugin ZIP entry exceeds the per-file size limit: ${entry.fileName}`)
  }
  const nextTotalBytes = declaredTotalBytes + entry.uncompressedSize
  if (nextTotalBytes > MAX_PLUGIN_ZIP_TOTAL_BYTES) {
    throw new Error('Plugin ZIP exceeds the total uncompressed size limit')
  }
  if (
    entry.uncompressedSize > 0 &&
    (entry.compressedSize === 0 ||
      entry.uncompressedSize / entry.compressedSize > MAX_PLUGIN_ZIP_COMPRESSION_RATIO)
  ) {
    throw new Error(`Plugin ZIP entry exceeds the compression ratio limit: ${entry.fileName}`)
  }
  return nextTotalBytes
}

async function extractZipEntry(
  zipFile: Awaited<ReturnType<typeof openPromise>>,
  entry: Entry,
  destinationPath: string,
  actualTotalBytes: { value: number }
): Promise<void> {
  const readStream = await zipFile.openReadStreamPromise(entry)
  let entryBytes = 0
  const limitStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      entryBytes += chunk.length
      actualTotalBytes.value += chunk.length
      if (entryBytes > MAX_PLUGIN_ZIP_ENTRY_BYTES) {
        callback(new Error(`Plugin ZIP entry exceeds the per-file size limit: ${entry.fileName}`))
        return
      }
      if (
        entryBytes > 0 &&
        (entry.compressedSize === 0 ||
          entryBytes / entry.compressedSize > MAX_PLUGIN_ZIP_COMPRESSION_RATIO)
      ) {
        callback(
          new Error(`Plugin ZIP entry exceeds the compression ratio limit: ${entry.fileName}`)
        )
        return
      }
      if (actualTotalBytes.value > MAX_PLUGIN_ZIP_TOTAL_BYTES) {
        callback(new Error('Plugin ZIP exceeds the total uncompressed size limit'))
        return
      }
      callback(null, chunk)
    }
  })

  try {
    await pipeline(
      readStream,
      limitStream,
      createWriteStream(destinationPath, {
        flags: 'wx',
        mode: zipEntryPermissionMode(entry) ?? 0o644
      })
    )
  } catch (error) {
    await rm(destinationPath, { force: true })
    throw error
  }
}

async function extractZipSafely(zipFilePath: string, destination: string): Promise<void> {
  const normalizedDestination = normalize(destination)
  await mkdir(normalizedDestination, { recursive: true })
  if ((await readdir(normalizedDestination)).length > 0) {
    throw new Error('Plugin ZIP extraction directory must be empty')
  }
  const zipFile = await openPromise(zipFilePath, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true
  })
  let entryCount = 0
  let declaredTotalBytes = 0
  const actualTotalBytes = { value: 0 }

  try {
    if (zipFile.entryCount > MAX_PLUGIN_ZIP_ENTRIES) {
      throw new Error(`Plugin ZIP exceeds the ${MAX_PLUGIN_ZIP_ENTRIES} entry limit`)
    }
    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1
      if (entryCount > MAX_PLUGIN_ZIP_ENTRIES) {
        throw new Error(`Plugin ZIP exceeds the ${MAX_PLUGIN_ZIP_ENTRIES} entry limit`)
      }

      const entryName = entry.fileName
      if (
        !entryName ||
        entryName.startsWith('/') ||
        /^[a-zA-Z]:/.test(entryName) ||
        isAbsolute(entryName) ||
        entryName.includes('\\') ||
        entryName.includes('\0')
      ) {
        throw new Error(`Unsafe ZIP entry path: ${entry.fileName}`)
      }

      const resolved = resolve(normalizedDestination, entryName)
      if (!isPathInside(normalizedDestination, resolved)) {
        throw new Error(`ZIP entry escapes extraction root: ${entry.fileName}`)
      }

      const isDirectory = isZipDirectory(entry)
      assertSupportedZipEntryType(entry, isDirectory)
      if (isDirectory) {
        await mkdir(resolved, { recursive: true })
        continue
      }

      declaredTotalBytes = assertZipEntrySize(entry, declaredTotalBytes)
      await mkdir(dirname(resolved), { recursive: true })
      await extractZipEntry(zipFile, entry, resolved, actualTotalBytes)
      const mode = zipEntryPermissionMode(entry)
      if (mode !== null) {
        await chmod(resolved, mode)
      }
    }
  } finally {
    if (zipFile.isOpen) zipFile.close()
  }
}

function safeZipSubdir(extractRoot: string, subdir: string): string {
  if (!subdir || isAbsolute(subdir) || subdir.includes('..')) {
    throw new Error(`Zip subdir must be a relative path inside the archive: ${subdir}`)
  }
  const resolved = resolve(extractRoot, subdir)
  if (!isPathInside(extractRoot, resolved)) {
    throw new Error(`Zip subdir escapes extraction root: ${subdir}`)
  }
  return resolved
}

async function findExtractedPluginRoot(extractRoot: string, subdir?: string): Promise<string> {
  if (subdir) {
    return safeZipSubdir(extractRoot, subdir)
  }

  if (await findPluginManifestPathAsync(extractRoot)) {
    return extractRoot
  }

  const topLevelDirs = new Set<string>()
  for (const entry of await readdir(extractRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) topLevelDirs.add(entry.name)
  }

  const candidates: string[] = []
  for (const topLevelDir of topLevelDirs) {
    const candidate = safeZipSubdir(extractRoot, topLevelDir)
    if (await findPluginManifestPathAsync(candidate)) {
      candidates.push(candidate)
    }
  }

  if (candidates.length === 1) {
    return candidates[0]
  }

  if (candidates.length > 1) {
    throw new Error('Plugin zip contains multiple plugin manifests; set source.path in marketplace')
  }

  throw new Error('Plugin zip does not contain a root plugin.json manifest')
}

export async function resolveMarketplaceSource(
  entry: PluginMarketplaceEntry
): Promise<ResolvedMarketplaceSource> {
  const path = resolveLocalMarketplaceSource(entry)
  return {
    path,
    resolvedSourceSha256: await computePluginSourceSha256(path)
  }
}
