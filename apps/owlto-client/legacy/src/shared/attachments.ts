export type MessageAttachmentKind = 'image' | 'file'

export const MAX_ATTACHMENT_PREVIEW_BYTES = 100 * 1024 * 1024

export type MessageAttachment = {
  id: string
  name: string
  path: string
  mimeType?: string | null
  size?: number | null
  kind: MessageAttachmentKind
  previewDataUrl?: string | null
}

export type AttachmentInput = {
  path: string
  name?: string
  mimeType?: string | null
}
