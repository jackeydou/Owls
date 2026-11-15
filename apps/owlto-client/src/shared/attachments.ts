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
