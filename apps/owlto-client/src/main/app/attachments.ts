import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  type Attachment,
  type AttachmentPreview,
  EXCERPT_READ_BYTES,
  type InlineImageType,
  isInlineImage,
  isInlineImageType,
  isTextAttachment,
  type StageAttachment,
  textExcerpt
} from '../../shared/attachments.js'
import { OwltoError } from './errors.js'

/** An attachment with the absolute path of main's copy, as a worker runtime receives it. */
export type AttachmentFile = Attachment & { path: string }

/** The largest image whose thumbnail the renderer gets as a data URL. */
const PREVIEW_MAX_BYTES = 8 * 1024 * 1024
const NAME_LIMIT = 120

/**
 * A file name that is safe as one path segment on every platform: no separators,
 * reserved characters, or dot-only names, and short enough to keep its extension.
 */
export function safeAttachmentName(name: string): string {
  const clean = basename(name.replaceAll('\\', '/'))
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this strips.
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .trim()
  if (!clean || /^\.+$/.test(clean)) return 'file'
  if (clean.length <= NAME_LIMIT) return clean
  const ext = extname(clean).slice(0, 16)
  return `${clean.slice(0, NAME_LIMIT - ext.length)}${ext}`
}

/** The first `bytes` of a file, or null when it cannot be read. */
async function readStart(path: string, bytes: number): Promise<Buffer | null> {
  const file = await open(path, 'r').catch(() => null)
  if (!file) return null
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await file.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } catch {
    return null
  } finally {
    await file.close()
  }
}

/**
 * Keeps the files users attach to worker messages, each in its own folder under
 * `root`, so the worker reads a stable copy wherever the original came from.
 */
export class AttachmentStore {
  constructor(private readonly root: string) {}

  async stage(input: StageAttachment): Promise<Attachment> {
    const id = crypto.randomUUID()
    const name = safeAttachmentName(input.name)
    const folder = join(this.root, id)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, name), input.data)
    return {
      id,
      name,
      mimeType: input.mimeType || 'application/octet-stream',
      size: input.data.byteLength
    }
  }

  /** The id is a UUID and the name one safe segment, so the path stays inside `root`. */
  path(attachment: Attachment): string {
    return join(this.root, attachment.id, safeAttachmentName(attachment.name))
  }

  /** The files to send, refusing the message when one of them is gone. */
  async files(list: Attachment[]): Promise<AttachmentFile[]> {
    return Promise.all(
      list.map(async (attachment) => {
        const path = this.path(attachment)
        const found = await stat(path).catch(() => null)
        if (!found?.isFile())
          throw new OwltoError(
            'invalid_request',
            `The attached file ${attachment.name} is no longer available.`
          )
        return { ...attachment, path }
      })
    )
  }

  /** An image as a data URL, or the first lines of a text file, for the thumbnail. */
  async preview(attachment: Attachment): Promise<AttachmentPreview> {
    if (isInlineImage(attachment)) {
      if (attachment.size > PREVIEW_MAX_BYTES) return null
      const data = await readFile(this.path(attachment)).catch(() => null)
      return data
        ? { kind: 'image', src: `data:${attachment.mimeType};base64,${data.toString('base64')}` }
        : null
    }
    if (!isTextAttachment(attachment)) return null
    const start = await readStart(this.path(attachment), EXCERPT_READ_BYTES)
    // A multi-byte character cut at the end must not make the file look binary.
    const excerpt = start ? textExcerpt(start.toString('utf8').replace(/\ufffd+$/, '')) : null
    return excerpt ? { kind: 'text', excerpt } : null
  }
}

/**
 * The model-facing note that lists files a worker reads from disk rather than
 * receiving inline. Every provider's agent can open a local path with its tools.
 */
export function attachmentNote(files: AttachmentFile[]): string {
  if (!files.length) return ''
  return `Attached files (open them from these paths):\n${files.map((f) => `- ${f.path}`).join('\n')}`
}

/** The text of a turn, with the note for the files that did not travel inline. */
export function turnText(text: string, files: AttachmentFile[]): string {
  return [text, attachmentNote(files)].filter(Boolean).join('\n\n')
}

/** Reads an image to send inline, or null when it is larger than the provider takes. */
export async function inlineImage(
  file: AttachmentFile,
  maxBytes: number
): Promise<{ mimeType: InlineImageType; data: string } | null> {
  const { mimeType } = file
  if (!isInlineImageType(mimeType) || file.size > maxBytes) return null
  const data = await readFile(file.path).catch(() => null)
  return data ? { mimeType, data: data.toString('base64') } : null
}

/**
 * Splits a turn's files into the images a provider takes inline, read as base64,
 * and the files it reads from disk, which `turnText` lists.
 */
export async function splitAttachments(
  files: AttachmentFile[] | undefined,
  imageMaxBytes: number | null
): Promise<{ images: { mimeType: InlineImageType; data: string }[]; rest: AttachmentFile[] }> {
  const images: { mimeType: InlineImageType; data: string }[] = []
  const rest: AttachmentFile[] = []
  for (const file of files ?? []) {
    const image = imageMaxBytes === null ? null : await inlineImage(file, imageMaxBytes)
    if (image) images.push(image)
    else rest.push(file)
  }
  return { images, rest }
}

/** The session item's copy of the files: the paths stay in main. */
export const attachmentRefs = (files: AttachmentFile[] | undefined): Attachment[] =>
  (files ?? []).map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size }))

/** What a turn's `user` item adds to its text: the files it carried and who wrote it. */
export function userItemFields(turn: { attachments?: AttachmentFile[]; author?: 'user' }): {
  attachments?: Attachment[]
  author?: 'user'
} {
  return {
    ...(turn.attachments?.length ? { attachments: attachmentRefs(turn.attachments) } : {}),
    ...(turn.author ? { author: turn.author } : {})
  }
}
