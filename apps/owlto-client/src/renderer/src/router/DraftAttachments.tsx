import { IconButton } from '@renderer/components/ui/icon-button'
import { AlertCircleIcon, FileIcon, LoaderIcon, XIcon } from '@renderer/components/ui/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ATTACHMENT_LIMIT,
  ATTACHMENT_MAX_BYTES,
  type Attachment,
  isInlineImage
} from '../../../shared/attachments'
import './draft-attachments.css'
import { useRouterStore } from './store'

/** A file in a draft. Main keeps a copy as soon as it is added, so sending only names it. */
type DraftFile = {
  key: string
  name: string
  mimeType: string
  /** An object URL for an image's thumbnail; revoked when the file leaves the draft. */
  preview: string | null
  state: 'staging' | 'ready' | 'failed'
  attachment: Attachment | null
}

const MEGABYTE = 1024 * 1024

/** A pasted image has a generic name; this gives it the time it was pasted. */
function fileName(file: File): string {
  if (file.name && file.name !== 'image.png') return file.name
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-')
  return `pasted-${stamp}.${ext}`
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
          preview: isInlineImage({ mimeType }) ? URL.createObjectURL(file) : null,
          state: 'staging',
          attachment: null
        }
        setFiles((list) => [...list, entry])
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

/** The draft's files as removable chips: image thumbnails, or a file icon and name. */
export function DraftAttachmentChips({ attachments }: { attachments: DraftAttachments }) {
  const { t } = useTranslation()
  if (!attachments.files.length) return null
  return (
    <ul className="draft-attachments" aria-label={t('workerComposer.attachments')}>
      {attachments.files.map((file) => {
        const status =
          file.state === 'staging'
            ? t('workerComposer.staging', { name: file.name })
            : file.state === 'failed'
              ? t('workerComposer.failed', { name: file.name })
              : file.name
        return (
          <li key={file.key} data-state={file.state} data-kind={file.preview ? 'image' : 'file'}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="draft-attachment-body" role="img" aria-label={status}>
                  {file.preview ? (
                    <img src={file.preview} alt="" />
                  ) : (
                    <>
                      <FileIcon size={16} />
                      <span>{file.name}</span>
                    </>
                  )}
                  {file.state === 'staging' ? (
                    <span className="draft-attachment-overlay">
                      <LoaderIcon size={14} className="animate-spin" />
                    </span>
                  ) : file.state === 'failed' ? (
                    <span className="draft-attachment-overlay">
                      <AlertCircleIcon size={14} />
                    </span>
                  ) : null}
                </span>
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
  )
}

/** A sent image's thumbnail, loaded from main's copy once. */
function useAttachmentPreview(attachment: Attachment): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!isInlineImage(attachment)) return
    let alive = true
    void window.owlto.attachmentPreview(attachment).then((reply) => {
      if (alive && reply.ok) setSrc(reply.value)
    })
    return () => {
      alive = false
    }
  }, [attachment])
  return src
}

function SentAttachment({ attachment }: { attachment: Attachment }) {
  const { t } = useTranslation()
  const src = useAttachmentPreview(attachment)
  const label = t('workerComposer.open', { name: attachment.name })
  return (
    <li data-kind={src ? 'image' : 'file'}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="draft-attachment-body"
            aria-label={label}
            onClick={() =>
              void window.owlto.openAttachment(attachment).then((reply) => {
                if (!reply.ok) useRouterStore.setState({ error: reply.error })
              })
            }
          >
            {src ? (
              <img src={src} alt="" />
            ) : (
              <>
                <FileIcon size={16} />
                <span>{attachment.name}</span>
              </>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{attachment.name}</TooltipContent>
      </Tooltip>
    </li>
  )
}

/** The files a sent message carried; a click opens one in its default app. */
export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  const { t } = useTranslation()
  if (!attachments.length) return null
  return (
    <ul
      className="draft-attachments message-attachments"
      aria-label={t('workerComposer.attachments')}
    >
      {attachments.map((attachment) => (
        <SentAttachment key={attachment.id} attachment={attachment} />
      ))}
    </ul>
  )
}
