import { z } from 'zod'
import { openInAppIdSchema } from './open-in.js'
import { workerActionSchema } from './router.js'

/**
 * Where a relative path in a message is looked up: the worker's folder for its own
 * conversation, the thread's folders for the Router, or the folder of a file already
 * open in the viewer for a link inside it.
 */
export const fileBaseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('thread'), routerId: z.string().uuid() }),
  workerActionSchema.extend({ kind: z.literal('worker') }),
  z.object({ kind: z.literal('file'), path: z.string().min(1).max(4096) }),
  z.object({ kind: z.literal('none') })
])
export type FileBase = z.infer<typeof fileBaseSchema>

/** A file a message points at: the text the agent wrote, and where to look it up. */
export const fileTargetSchema = z.object({
  ref: z.string().trim().min(1).max(4096),
  base: fileBaseSchema
})
export type FileTarget = z.infer<typeof fileTargetSchema>

/** How the viewer shows a file, decided by main from its type and size. */
export type FilePreviewBody =
  /** `truncated` is true when only the start of a long file was read. */
  | { kind: 'text'; text: string; truncated: boolean }
  /** An image as a data URL. */
  | { kind: 'image'; dataUrl: string }
  /** A folder's entries, folders first, each group sorted by name. */
  | { kind: 'folder'; entries: { name: string; folder: boolean }[]; truncated: boolean }
  /** A file the viewer cannot show, such as an archive or a file too large to read. */
  | { kind: 'binary' }

export type FilePreview = {
  /** The absolute path, which the open-in actions take back. */
  path: string
  name: string
  /** The path as the header shows it: under its project or workspace when it is in one. */
  label: string
  size: number
  /** The line the reference pointed at (`file.ts:12`), counted from 1; null for none. */
  line: number | null
  body: FilePreviewBody
}

/**
 * What the viewer gets back: the file, or why there is none to show. A file outside the
 * user's projects, workspace, and worker folders is never read.
 */
export type FilePreviewResult =
  | { status: 'ok'; preview: FilePreview }
  | { status: 'missing'; ref: string }
  | { status: 'outside'; path: string }

/** Opens a previewed file in an installed app; `finder` reveals it in its folder. */
export const openFileInSchema = z.object({
  path: z.string().min(1).max(4096),
  appId: openInAppIdSchema
})
export type OpenFileIn = z.infer<typeof openFileInSchema>

/** A file reference split into its path and the line it points at, if any. */
export function parseFileRef(ref: string): { path: string; line: number | null } {
  let path = ref.trim()
  if (/^file:\/\//i.test(path)) {
    path = path.replace(/^file:\/\/(localhost)?/i, '')
    try {
      path = decodeURIComponent(path)
    } catch {
      // A stray % stays as written.
    }
  }
  let line: number | null = null
  const anchor = /#L(\d+)(?:-L?\d+)?$/.exec(path)
  if (anchor) {
    line = Number(anchor[1])
    path = path.slice(0, anchor.index)
  } else {
    const suffix = /:(\d+)(?::\d+)?(?:-\d+)?$/.exec(path)
    if (suffix) {
      line = Number(suffix[1])
      path = path.slice(0, suffix.index)
    }
  }
  return { path, line: line && line > 0 ? line : null }
}

const WEB_OR_OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/
/** File extensions a bare name like `README.md` or `ipc.ts` is taken as a file for. */
const FILE_EXTENSIONS = new Set(
  (
    'c cc cfg cjs conf cpp cs css csv cts dart diff env gif go gradle h hpp htm html ico ini ' +
    'java jpeg jpg js json json5 jsonc jsx kt kts less lock log lua m md mdx mjs mm mts patch ' +
    'php pl png proto py rb rs sass scss sh sql svg swift toml ts tsx txt vue webp xml yaml yml zig zsh'
  ).split(' ')
)

/**
 * True when a link or inline code reads as a local file path, such as
 * `src/main/app/ipc.ts:134`, `./README.md`, `~/notes/a.md`, or `file:///tmp/x.txt`.
 * Web links, anchors, and words like `window.open` are not.
 */
export function looksLikeFilePath(text: string): boolean {
  const value = text.trim()
  if (!value || value.length > 1024 || /\s/.test(value)) return false
  if (/^file:\/\//i.test(value)) return true
  if (WINDOWS_DRIVE.test(value)) return true
  if (WEB_OR_OTHER_SCHEME.test(value) || value.startsWith('#') || value.startsWith('//'))
    return false
  const { path } = parseFileRef(value)
  if (!path || /[<>"'`|*?{}()[\]]/.test(path)) return false
  if (path.startsWith('/') || path.startsWith('~/') || path.startsWith('./')) return true
  if (path.startsWith('../')) return true
  const name = path.split('/').at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  if (dot > 0 && FILE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())) return true
  // A folder path like `src/main/app`. One slash is too often a branch (`origin/main`) or `and/or`.
  return path.split('/').length > 2 && /[A-Za-z]/.test(path) && !path.endsWith('/')
}

/** True when a Markdown link's target is a local file rather than a web page or an anchor. */
export function isLocalHref(href: string): boolean {
  const value = href.trim()
  if (looksLikeFilePath(value)) return true
  return (
    value !== '' &&
    !/\s/.test(value) &&
    !WEB_OR_OTHER_SCHEME.test(value) &&
    !value.startsWith('#') &&
    !value.startsWith('//')
  )
}
