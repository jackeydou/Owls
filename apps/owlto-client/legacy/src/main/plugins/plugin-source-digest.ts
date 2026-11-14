import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { relative, sep } from 'node:path'

const IGNORED_SOURCE_SEGMENTS = new Set([
  '.git',
  '.next',
  '.next-dev',
  '.tmp',
  'dist',
  'node_modules',
  'out'
])

function normalizeRelativePath(path: string): string {
  return path.split(sep).join('/')
}

export function isIgnoredPluginSourceRelativePath(path: string): boolean {
  if (!path || path === '.') return false
  const parts = normalizeRelativePath(path).split('/')
  if (parts.some((part) => IGNORED_SOURCE_SEGMENTS.has(part))) return true
  const name = parts.at(-1) ?? ''
  return name === '.DS_Store' || name.endsWith('.log')
}

export function isIgnoredPluginSourcePath(root: string, path: string): boolean {
  return isIgnoredPluginSourceRelativePath(relative(root, path))
}

export async function computePluginSourceSha256(root: string): Promise<string> {
  const hash = createHash('sha256')

  async function walk(dir: string): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name)
    )

    for (const entry of entries) {
      const path = `${dir}/${entry.name}`
      const relativePath = normalizeRelativePath(relative(root, path))
      if (isIgnoredPluginSourceRelativePath(relativePath)) continue

      const stat = await lstat(path)
      if (stat.isDirectory()) {
        hash.update('dir\0')
        hash.update(relativePath)
        hash.update('\0')
        await walk(path)
        continue
      }

      if (stat.isSymbolicLink()) {
        hash.update('symlink\0')
        hash.update(relativePath)
        hash.update('\0')
        hash.update(await readlink(path))
        hash.update('\0')
        continue
      }

      if (!stat.isFile()) continue

      hash.update('file\0')
      hash.update(relativePath)
      hash.update('\0')
      hash.update(await readFile(path))
      hash.update('\0')
    }
  }

  await walk(root)
  return hash.digest('hex')
}
