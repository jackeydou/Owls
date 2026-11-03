import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, shell } from 'electron'
import {
  type AttachmentInput,
  MAX_ATTACHMENT_PREVIEW_BYTES,
  type MessageAttachment
} from '../shared/attachments.js'
import { getDataRoot } from './pichu-paths.js'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.text': 'text/plain',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml'
}

function inferMimeType(path: string, hint?: string | null): string | null {
  const trimmedHint = hint?.trim()
  if (trimmedHint) return trimmedHint
  return MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? null
}

function attachmentKind(path: string, mimeType: string | null): MessageAttachment['kind'] {
  if (mimeType?.startsWith('image/')) return 'image'
  const ext = extname(path).toLowerCase()
  return [
    '.apng',
    '.avif',
    '.bmp',
    '.gif',
    '.heic',
    '.heif',
    '.jpeg',
    '.jpg',
    '.png',
    '.svg',
    '.webp'
  ].includes(ext)
    ? 'image'
    : 'file'
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  const entry = Object.entries(MIME_BY_EXTENSION).find(([, value]) => value === normalized)
  return entry?.[0] ?? '.png'
}

function isClipboardImageInput(value: unknown): value is {
  name?: string
  mimeType: string
  data: ArrayBuffer
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as { name?: unknown; mimeType?: unknown; data?: unknown }
  return (
    (input.name === undefined || typeof input.name === 'string') &&
    typeof input.mimeType === 'string' &&
    input.mimeType.startsWith('image/') &&
    input.data instanceof ArrayBuffer
  )
}

function saveImageAttachment(input: {
  name?: string
  mimeType: string
  data: ArrayBuffer
  directory: 'clipboard' | 'comment-screenshots'
  fallbackPrefix: string
}): MessageAttachment | null {
  if (!isClipboardImageInput(input)) return null
  const extension = extensionForMimeType(input.mimeType)
  const fallbackName = `${input.fallbackPrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}${extension}`
  const rawName = basename(input.name?.trim() || fallbackName)
  const name = extname(rawName) ? rawName : `${rawName}${extension}`
  const root = join(getDataRoot(), 'attachments', input.directory)
  mkdirSync(root, { recursive: true })
  const filePath = join(root, `${Date.now()}-${crypto.randomUUID()}-${name}`)
  writeFileSync(filePath, Buffer.from(new Uint8Array(input.data)))
  return toMessageAttachment({ path: filePath, name, mimeType: input.mimeType })
}

export function toMessageAttachment(input: AttachmentInput): MessageAttachment | null {
  const path = input.path.trim()
  if (!path || !isAbsolute(path)) return null

  let stats: ReturnType<typeof statSync>
  try {
    stats = statSync(path)
  } catch {
    return null
  }
  if (!stats.isFile()) return null

  const mimeType = inferMimeType(path, input.mimeType)
  const kind = attachmentKind(path, mimeType)
  const previewDataUrl =
    kind === 'image' && mimeType?.startsWith('image/') && stats.size <= MAX_ATTACHMENT_PREVIEW_BYTES
      ? `data:${mimeType};base64,${readFileSync(path).toString('base64')}`
      : null

  return {
    id: crypto.randomUUID(),
    name: input.name?.trim() || basename(path),
    path,
    mimeType,
    size: stats.size,
    kind,
    previewDataUrl
  }
}

function uniqueAttachments(inputs: AttachmentInput[]): MessageAttachment[] {
  const seen = new Set<string>()
  const attachments: MessageAttachment[] = []

  for (const input of inputs) {
    const attachment = toMessageAttachment(input)
    if (!attachment || seen.has(attachment.path)) continue
    seen.add(attachment.path)
    attachments.push(attachment)
  }

  return attachments
}

function isManagedAttachmentPath(path: string): boolean {
  if (!isAbsolute(path)) return false

  try {
    const root = realpathSync(resolve(getDataRoot(), 'attachments'))
    const target = realpathSync(path)
    return target === root || target.startsWith(`${root}${sep}`)
  } catch {
    return false
  }
}

export function registerAttachmentIpc(): void {
  ipcMain.handle('attachments:pick', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openFile', 'multiSelections']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    return uniqueAttachments(result.filePaths.map((path) => ({ path })))
  })

  ipcMain.handle('attachments:stat-paths', (_, inputs: AttachmentInput[]) => {
    if (!Array.isArray(inputs)) return []
    return uniqueAttachments(inputs)
  })

  ipcMain.handle('attachments:save-clipboard-image', (_, input: unknown) => {
    if (!isClipboardImageInput(input)) return null
    return saveImageAttachment({
      ...input,
      directory: 'clipboard',
      fallbackPrefix: 'pasted-image'
    })
  })

  ipcMain.handle('attachments:save-comment-screenshot', (_, input: unknown) => {
    if (!isClipboardImageInput(input)) return null
    return saveImageAttachment({
      ...input,
      directory: 'comment-screenshots',
      fallbackPrefix: 'comment-screenshot'
    })
  })

  ipcMain.handle('attachments:read-image-data-url', (_, path: string) => {
    const attachment = toMessageAttachment({ path })
    if (!attachment || attachment.kind !== 'image' || !attachment.mimeType?.startsWith('image/')) {
      return null
    }
    if ((attachment.size ?? 0) > MAX_ATTACHMENT_PREVIEW_BYTES) {
      return null
    }

    return attachment.previewDataUrl
  })

  ipcMain.handle('attachments:read-text-file', (_, path: string) => {
    const trimmed = path.trim()
    if (!trimmed || !isManagedAttachmentPath(trimmed)) {
      throw new Error('Attachment path must point to a managed attachment file')
    }

    const attachment = toMessageAttachment({ path: trimmed })
    if (!attachment) {
      throw new Error('Attachment path must point to a readable local file')
    }
    if ((attachment.size ?? 0) > MAX_ATTACHMENT_PREVIEW_BYTES) {
      return `File preview is not available because this file is larger than ${MAX_ATTACHMENT_PREVIEW_BYTES} bytes.`
    }

    const content = readFileSync(attachment.path)
    if (content.includes(0)) {
      return 'Binary file preview is not available.'
    }

    return content.toString('utf8')
  })

  ipcMain.handle('attachments:reveal', (_, path: string) => {
    const trimmed = path.trim()
    if (!trimmed || !isAbsolute(trimmed)) {
      throw new Error('Attachment path must be absolute')
    }
    shell.showItemInFolder(trimmed)
  })

  ipcMain.handle('attachments:open', async (_, path: string) => {
    const trimmed = path.trim()
    if (!trimmed || !isAbsolute(trimmed)) {
      throw new Error('Attachment path must be absolute')
    }
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(trimmed)
    } catch {
      throw new Error('Attachment path must point to a readable local file')
    }
    if (!stats.isFile()) {
      throw new Error('Attachment path must point to a readable local file')
    }
    const error = await shell.openPath(trimmed)
    if (error) {
      throw new Error(error)
    }
  })

  ipcMain.handle('attachments:open-folder', async (_, path: string) => {
    const trimmed = path.trim()
    if (!trimmed || !isAbsolute(trimmed)) {
      throw new Error('Folder path must be absolute')
    }
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(trimmed)
    } catch {
      throw new Error('Folder path must point to a readable local folder')
    }
    if (!stats.isDirectory()) {
      throw new Error('Folder path must point to a readable local folder')
    }
    const error = await shell.openPath(trimmed)
    if (error) {
      throw new Error(error)
    }
  })

  ipcMain.handle('attachments:save-copy', async (event, path: string) => {
    const attachment = toMessageAttachment({ path })
    if (!attachment) {
      throw new Error('Attachment path must point to a readable local file')
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      defaultPath: attachment.name
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) {
      return null
    }

    copyFileSync(attachment.path, result.filePath)
    return result.filePath
  })
}
