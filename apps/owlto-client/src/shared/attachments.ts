import { z } from 'zod'

/** How many files one message can carry. */
export const ATTACHMENT_LIMIT = 8
/** The largest file, in bytes, a message can carry. */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024
/** Image types every worker provider can take inline; other images travel as files. */
export const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

/**
 * A file the user attached to a message. Main keeps a copy under the data root's
 * attachments folder, at `<id>/<name>`, so a message never depends on where the
 * file came from.
 */
export const attachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  mimeType: z.string().max(255),
  size: z.number().int().nonnegative()
})
export type Attachment = z.infer<typeof attachmentSchema>

/** A pasted or picked file the renderer hands to main to keep. */
export const stageAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().max(255),
  data: z
    .instanceof(Uint8Array)
    .refine((data) => data.byteLength <= ATTACHMENT_MAX_BYTES, 'The file is too large.')
})
export type StageAttachment = z.infer<typeof stageAttachmentSchema>

export type InlineImageType = (typeof INLINE_IMAGE_TYPES)[number]

export const isInlineImageType = (mimeType: string): mimeType is InlineImageType =>
  (INLINE_IMAGE_TYPES as readonly string[]).includes(mimeType)

export const isInlineImage = (attachment: Pick<Attachment, 'mimeType'>): boolean =>
  isInlineImageType(attachment.mimeType)

/** What a thumbnail shows: an image, the start of a text file, or nothing beyond its type. */
export type AttachmentPreview =
  | { kind: 'image'; src: string }
  | { kind: 'text'; excerpt: string }
  | null

/** How much of a text file is read for its thumbnail. */
export const EXCERPT_READ_BYTES = 4096
const EXCERPT_LINES = 4
const EXCERPT_CHARS = 240

const TEXT_TYPES = /^(?:text\/|application\/(?:json|xml|x-yaml|yaml|toml|javascript|x-sh|sql))/
const TEXT_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'cs',
  'css',
  'csv',
  'go',
  'h',
  'html',
  'java',
  'js',
  'json',
  'jsx',
  'kt',
  'log',
  'md',
  'mjs',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'svg',
  'swift',
  'toml',
  'ts',
  'tsv',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml'
])

/** The file's extension in upper case, such as `PDF`, or null when it has none. */
export function attachmentExtension(name: string): string | null {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : null
}

/** A file whose first lines make a useful thumbnail. */
export function isTextAttachment(attachment: Pick<Attachment, 'name' | 'mimeType'>): boolean {
  if (TEXT_TYPES.test(attachment.mimeType)) return true
  const ext = attachmentExtension(attachment.name)?.toLowerCase()
  return ext ? TEXT_EXTENSIONS.has(ext) : false
}

/**
 * The first few non-empty lines of a text file's start, or null when the bytes do
 * not read as text. `text` is the decoded start of the file.
 */
export function textExcerpt(text: string): string | null {
  if (text.includes('\u0000') || text.includes('�')) return null
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.replaceAll('\t', '  ').trimEnd())
    .filter((line) => line.trim())
    .slice(0, EXCERPT_LINES)
  const excerpt = lines.join('\n').slice(0, EXCERPT_CHARS)
  return excerpt || null
}
