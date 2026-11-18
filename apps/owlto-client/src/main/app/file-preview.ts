import { open, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import type { FilePreview, FilePreviewBody, FilePreviewResult } from '../../shared/file-preview.js'
import { parseFileRef } from '../../shared/file-preview.js'
import { isWithin, normalizePath } from '../../shared/workspace.js'

/** Text past this is cut, so a huge log cannot stall the viewer. */
export const TEXT_PREVIEW_BYTES = 1024 * 1024
/** Images past this are not inlined as data URLs. */
export const IMAGE_PREVIEW_BYTES = 16 * 1024 * 1024
/** A folder lists at most this many entries. */
export const FOLDER_PREVIEW_ENTRIES = 500

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
}

/** A folder files may be previewed from, with the name its files are labeled under. */
export type PreviewRoot = { path: string; name: string }

const expandHome = (path: string) =>
  path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  )

/**
 * The absolute path a reference names. An absolute or `~` path stands as written; a relative
 * one is tried under each base folder in order, and the first that exists wins.
 */
export async function resolveFileRef(
  ref: string,
  bases: readonly string[]
): Promise<{ path: string; line: number | null } | null> {
  const parsed = parseFileRef(ref)
  const path = expandHome(parsed.path)
  if (isAbsolute(path)) return { path: normalizePath(path), line: parsed.line }
  for (const base of bases) {
    const candidate = normalizePath(join(base, path))
    if (await exists(candidate)) return { path: candidate, line: parsed.line }
  }
  return null
}

/**
 * The root a path is under once symlinks are followed, or null. Files outside the user's
 * projects, workspace, and worker folders are not read, whatever a message links to.
 */
export async function containingRoot(
  path: string,
  roots: readonly PreviewRoot[]
): Promise<{ real: string; root: PreviewRoot } | null> {
  const real = await realpath(path).catch(() => null)
  if (!real) return null
  let best: { real: string; root: PreviewRoot; at: string } | null = null
  for (const root of roots) {
    const at = await realpath(root.path).catch(() => null)
    if (!at || !isWithin(real, at)) continue
    // The deepest root names the file best, e.g. a worktree over the workspace that holds it.
    if (!best || at.length > best.at.length) best = { real, root, at }
  }
  return best ? { real: best.real, root: best.root } : null
}

/** True when a buffer looks like text: no NUL byte in its first 8 KB. */
function isText(buffer: Buffer): boolean {
  return !buffer.subarray(0, 8192).includes(0)
}

async function readStart(path: string, bytes: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function folderBody(path: string): Promise<FilePreviewBody> {
  const dirents = await readdir(path, { withFileTypes: true })
  const entries = dirents
    .map((entry) => ({ name: entry.name, folder: entry.isDirectory() }))
    .sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name))
  return {
    kind: 'folder',
    entries: entries.slice(0, FOLDER_PREVIEW_ENTRIES),
    truncated: entries.length > FOLDER_PREVIEW_ENTRIES
  }
}

async function fileBody(path: string, size: number): Promise<FilePreviewBody> {
  const type = IMAGE_TYPES[extname(path).toLowerCase()]
  if (type) {
    if (size > IMAGE_PREVIEW_BYTES) return { kind: 'binary' }
    const data = await readStart(path, size)
    return { kind: 'image', dataUrl: `data:${type};base64,${data.toString('base64')}` }
  }
  const data = await readStart(path, Math.min(size, TEXT_PREVIEW_BYTES))
  if (!isText(data)) return { kind: 'binary' }
  let text = data.toString('utf8')
  // A cut can split a multi-byte character; drop the broken tail.
  if (size > TEXT_PREVIEW_BYTES) text = text.replace(/�+$/, '')
  return { kind: 'text', text, truncated: size > TEXT_PREVIEW_BYTES }
}

/**
 * Reads the file or folder a reference names for the viewer, once it is found under one
 * of the bases (for a relative path) and checked to be under one of the roots.
 */
export async function previewFileRef(
  ref: string,
  bases: readonly string[],
  roots: readonly PreviewRoot[]
): Promise<FilePreviewResult> {
  const resolved = await resolveFileRef(ref, bases)
  if (!resolved || !(await exists(resolved.path))) return { status: 'missing', ref }
  const found = await containingRoot(resolved.path, roots)
  if (!found) return { status: 'outside', path: resolved.path }
  return { status: 'ok', preview: await readPreview(resolved.path, resolved.line, found) }
}

async function readPreview(
  path: string,
  line: number | null,
  found: { real: string; root: PreviewRoot }
): Promise<FilePreview> {
  const info = await stat(found.real)
  const inside = normalizePath(relative(found.root.path, path))
  const label = inside && !inside.startsWith('..') ? `${found.root.name}/${inside}` : path
  return {
    path: normalizePath(path),
    name: basename(path) || path,
    label,
    size: info.isDirectory() ? 0 : info.size,
    line: info.isDirectory() ? null : line,
    body: info.isDirectory() ? await folderBody(found.real) : await fileBody(found.real, info.size)
  }
}
