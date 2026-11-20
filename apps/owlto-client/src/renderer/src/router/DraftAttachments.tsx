import { IconButton } from '@renderer/components/ui/icon-button'
import { AlertCircleIcon, FileIcon, LoaderIcon, XIcon } from '@renderer/components/ui/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ATTACHMENT_LIMIT,
  ATTACHMENT_MAX_BYTES,
  type Attachment,
  attachmentExtension,
  EXCERPT_READ_BYTES,
  isInlineImage,
  isTextAttachment,
  textExcerpt
} from '../../../shared/attachments'
import './draft-attachments.css'
import { ImageViewer, type ViewerImage } from './ImageViewer'
import { useRouterStore } from './store'

/**
 * How big thumbnails are: `compact` chips in the worker panel, `preview` tiles on
 * the Router page, where a file also shows its first lines.
 */
export type AttachmentSize = 'compact' | 'preview'

/** A file in a draft. Main keeps a copy as soon as it is added, so sending only names it. */
type DraftFile = {
  key: string
  name: string
  mimeType: string
  size: number
  /** An object URL for an image's thumbnail; revoked when the file leaves the draft. */
  preview: string | null
  /** A text file's first lines, read once it is added. */
  excerpt: string | null
  state: 'staging' | 'ready' | 'failed'
  attachment: Attachment | null
}

const MEGABYTE = 1024 * 1024
/** Lines of a text file a preview tile has room for. */
const EXCERPT_TILE_LINES = 3

/** A pasted image has a generic name; this gives it the time it was pasted. */
function fileName(file: File): string {
  if (file.name && file.name !== 'image.png') return file.name
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-')
  return `pasted-${stamp}.${ext}`
}

/** The start of a text file as its thumbnail text; a cut multi-byte character is dropped. */
async function readExcerpt(file: File): Promise<string | null> {
  const start = await file.slice(0, EXCERPT_READ_BYTES).text()
  return textExcerpt(start.replace(/�+$/, ''))
}

/**
 * The files a draft carries. Each is staged in main when added and shows as a chip
 * above the input; `error` explains the last file that could not be added.
 */
export function useDraftAttachments() {
  const { t } = useTranslation()
  const [files, setFiles] = useState<DraftFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const live = useRef(files)
  live.current = files
  // Object URLs outlive the component unless revoked.
  useEffect(
    () => () => {
      for (const file of live.current) if (file.preview) URL.revokeObjectURL(file.preview)
    },
    []
  )
  const update = (key: string, change: Partial<DraftFile>) =>
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...change } : f)))
  const add = useCallback(
    (picked: File[]) => {
      setError(null)
      const room = ATTACHMENT_LIMIT - live.current.length
      if (picked.length > room) setError(t('workerComposer.tooMany', { limit: ATTACHMENT_LIMIT }))
      for (const file of picked.slice(0, Math.max(0, room))) {
        const name = fileName(file)
        if (file.size > ATTACHMENT_MAX_BYTES) {
          setError(t('workerComposer.tooLarge', { name, limit: ATTACHMENT_MAX_BYTES / MEGABYTE }))
          continue
        }
        const mimeType = file.type || 'application/octet-stream'
        const entry: DraftFile = {
          key: crypto.randomUUID(),
          name,
          mimeType,
          size: file.size,
          preview: isInlineImage({ mimeType }) ? URL.createObjectURL(file) : null,
          excerpt: null,
          state: 'staging',
          attachment: null
        }
        setFiles((list) => [...list, entry])
        if (!entry.preview && isTextAttachment({ name, mimeType }))
          void readExcerpt(file)
            .then((excerpt) => {
              if (excerpt) update(entry.key, { excerpt })
            })
            .catch(() => {})
        void file
          .arrayBuffer()
          .then((buffer) =>
            window.owlto.stageAttachment({ name, mimeType, data: new Uint8Array(buffer) })
          )
          .then((reply) => {
            if (!reply.ok) throw new Error(reply.error.message)
            update(entry.key, { state: 'ready', attachment: reply.value })
          })
          .catch(() => {
            update(entry.key, { state: 'failed' })
            setError(t('workerComposer.stageFailed', { name }))
          })
      }
    },
    [t]
  )
  const remove = (key: string) => {
    const file = live.current.find((f) => f.key === key)
    if (file?.preview) URL.revokeObjectURL(file.preview)
    setFiles((list) => list.filter((f) => f.key !== key))
    setError(null)
  }
  const clear = () => {
    for (const file of live.current) if (file.preview) URL.revokeObjectURL(file.preview)
    setFiles([])
    setError(null)
  }
  const ready = files.flatMap((f) => (f.state === 'ready' && f.attachment ? [f.attachment] : []))
  return {
    files,
    error,
    /** Files still being copied; the draft waits for them before it can send. */
    staging: files.some((f) => f.state === 'staging'),
    ready,
    add,
    remove,
    /** Drops the last file, as Backspace in an empty input does. */
    removeLast: () => {
      const last = live.current.at(-1)
      if (last) remove(last.key)
    },
    clear
  }
}
export type DraftAttachments = ReturnType<typeof useDraftAttachments>

/** Which image of a list the viewer shows; null while it is closed. */
function useViewer(images: ViewerImage[], onOpen?: (key: string) => void) {
  const [open, setOpen] = useState<string | null>(null)
  const index = open ? images.findIndex((image) => image.key === open) : -1
  const viewer =
    index >= 0 ? (
      <ImageViewer
        images={images}
        index={index}
        onIndex={(next) => setOpen(images[next]?.key ?? null)}
        onClose={() => setOpen(null)}
        onOpen={onOpen ? () => onOpen(images[index].key) : undefined}
      />
    ) : null
  return { show: setOpen, viewer }
}

/**
 * The draft's files as removable thumbnails. An image opens in the viewer; a file
 * shows its type and, for text, its first lines.
 */
export function DraftAttachmentChips({
  attachments,
  size = 'compact'
}: {
  attachments: DraftAttachments
  size?: AttachmentSize
}) {
  const { t } = useTranslation()
  const images = attachments.files.flatMap((file) =>
    file.preview ? [{ key: file.key, name: file.name, src: file.preview }] : []
  )
  const { show, viewer } = useViewer(images)
  if (!attachments.files.length) return null
  return (
    <>
      <ul
        className="draft-attachments"
        data-size={size}
        aria-label={t('workerComposer.attachments')}
      >
        {attachments.files.map((file) => {
          const status =
            file.state === 'staging'
              ? t('workerComposer.staging', { name: file.name })
              : file.state === 'failed'
                ? t('workerComposer.failed', { name: file.name })
                : file.name
          const overlay =
            file.state === 'staging' ? (
              <span className="draft-attachment-overlay">
                <LoaderIcon size={14} className="animate-spin" />
              </span>
            ) : file.state === 'failed' ? (
              <span className="draft-attachment-overlay">
                <AlertCircleIcon size={14} />
              </span>
            ) : null
          return (
            <li key={file.key} data-state={file.state} data-kind={file.preview ? 'image' : 'file'}>
              <Tooltip>
                <TooltipTrigger asChild>
                  {file.preview ? (
                    <button
                      type="button"
                      className="draft-attachment-body"
                      aria-label={t('attachments.view', { name: file.name })}
                      // Keeps the caret in the editor.
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => show(file.key)}
                    >
                      <img src={file.preview} alt="" />
                      {overlay}
                    </button>
                  ) : (
                    <span className="draft-attachment-body" role="img" aria-label={status}>
                      <FileThumb
                        name={file.name}
                        size={file.size}
                        excerpt={file.excerpt}
                        layout={size}
                      />
                      {overlay}
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent side="top">{status}</TooltipContent>
              </Tooltip>
              <IconButton
                size="sm"
                variant="outline"
                className="draft-attachment-remove"
                label={t('workerComposer.remove', { name: file.name })}
                icon={<XIcon size={10} />}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => attachments.remove(file.key)}
              />
            </li>
          )
        })}
      </ul>
      {viewer}
    </>
  )
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MEGABYTE) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / MEGABYTE).toFixed(1)} MB`
}

/**
 * A file's thumbnail. Compact: its icon, then its name over its type and size.
 * Preview: its type badge and name, over its first lines or its size.
 */
function FileThumb({
  name,
  size,
  excerpt,
  layout
}: {
  name: string
  size: number
  excerpt: string | null
  layout: AttachmentSize
}) {
  const ext = attachmentExtension(name)
  const meta = ext ? `${ext} · ${fileSize(size)}` : fileSize(size)
  if (layout === 'compact')
    return (
      <>
        <span className="draft-attachment-icon">
          <FileIcon size={16} />
        </span>
        <span className="draft-attachment-text">
          <span>{name}</span>
          <small>{meta}</small>
        </span>
      </>
    )
  return (
    <span className="draft-attachment-file">
      <span className="draft-attachment-head">
        <span className="draft-attachment-type">
          {ext ? ext.slice(0, 5) : <FileIcon size={12} />}
        </span>
        <span className="draft-attachment-name">{name}</span>
      </span>
      {excerpt ? (
        <span className="draft-attachment-excerpt">
          {excerpt
            .split('\n')
            .slice(0, EXCERPT_TILE_LINES)
            .map((line, index) => (
              // Lines repeat, and the excerpt never changes, so the index is a stable key.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above.
              <span key={index}>{line}</span>
            ))}
        </span>
      ) : (
        <span className="draft-attachment-meta">{fileSize(size)}</span>
      )}
    </span>
  )
}

/** A sent file's thumbnail content, loaded from main's copy once. */
function useAttachmentPreview(attachment: Attachment) {
  const [preview, setPreview] = useState<{ src: string | null; excerpt: string | null }>({
    src: null,
    excerpt: null
  })
  useEffect(() => {
    if (!isInlineImage(attachment) && !isTextAttachment(attachment)) return
    let alive = true
    void window.owlto.attachmentPreview(attachment).then((reply) => {
      if (!alive || !reply.ok || !reply.value) return
      const value = reply.value
      setPreview(
        value.kind === 'image'
          ? { src: value.src, excerpt: null }
          : { src: null, excerpt: value.excerpt }
      )
    })
    return () => {
      alive = false
    }
  }, [attachment])
  return preview
}

const openAttachment = (attachment: Attachment) =>
  void window.owlto.openAttachment(attachment).then((reply) => {
    if (!reply.ok) useRouterStore.setState({ error: reply.error })
  })

function SentAttachment({
  attachment,
  size,
  onPreview,
  onView
}: {
  attachment: Attachment
  size: AttachmentSize
  onPreview: (id: string, src: string) => void
  onView: (id: string) => void
}) {
  const { t } = useTranslation()
  const { src, excerpt } = useAttachmentPreview(attachment)
  useEffect(() => {
    if (src) onPreview(attachment.id, src)
  }, [src, attachment.id, onPreview])
  const label = t(src ? 'attachments.view' : 'workerComposer.open', { name: attachment.name })
  return (
    <li data-kind={src ? 'image' : 'file'}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="draft-attachment-body"
            aria-label={label}
            onClick={() => (src ? onView(attachment.id) : openAttachment(attachment))}
          >
            {src ? (
              <img src={src} alt="" />
            ) : (
              <FileThumb
                name={attachment.name}
                size={attachment.size}
                excerpt={excerpt}
                layout={size}
              />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{attachment.name}</TooltipContent>
      </Tooltip>
    </li>
  )
}

/** The files a sent message carried. An image opens in the viewer, a file in its default app. */
export function MessageAttachments({
  attachments,
  size = 'compact'
}: {
  attachments: Attachment[]
  size?: AttachmentSize
}) {
  const { t } = useTranslation()
  const [sources, setSources] = useState<Record<string, string>>({})
  const onPreview = useCallback(
    (id: string, src: string) =>
      setSources((list) => (list[id] === src ? list : { ...list, [id]: src })),
    []
  )
  const images = attachments.flatMap((a) =>
    sources[a.id] ? [{ key: a.id, name: a.name, src: sources[a.id] }] : []
  )
  const { show, viewer } = useViewer(images, (id) => {
    const attachment = attachments.find((a) => a.id === id)
    if (attachment) openAttachment(attachment)
  })
  if (!attachments.length) return null
  return (
    <>
      <ul
        className="draft-attachments message-attachments"
        data-size={size}
        aria-label={t('workerComposer.attachments')}
      >
        {attachments.map((attachment) => (
          <SentAttachment
            key={attachment.id}
            attachment={attachment}
            size={size}
            onPreview={onPreview}
            onView={show}
          />
        ))}
      </ul>
      {viewer}
    </>
  )
}
