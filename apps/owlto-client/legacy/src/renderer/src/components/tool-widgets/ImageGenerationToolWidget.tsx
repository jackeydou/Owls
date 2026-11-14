import { AttachmentCard } from '@renderer/components/chat/AttachmentCard'
import { ImageIcon, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { MessageAttachment } from '../../../../preload/index.d'
import type { ToolWidgetComponentProps } from './types'

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function addPath(paths: string[], seen: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return
  const path = value.trim()
  if (!path?.startsWith('/') || seen.has(path)) return
  seen.add(path)
  paths.push(path)
}

function addPathArray(paths: string[], seen: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return
  for (const entry of value) addPath(paths, seen, entry)
}

function collectMediaPathsFromText(paths: string[], seen: Set<string>, text: string): void {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.toLowerCase().startsWith('media:')) continue
    addPath(
      paths,
      seen,
      trimmed
        .slice('media:'.length)
        .trim()
        .replace(/^['"`]+|['"`]+$/g, '')
    )
  }
}

function collectGeneratedImagePaths(result: unknown): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  if (!isRecord(result)) return paths

  addPathArray(paths, seen, result.paths)

  const details = isRecord(result.details) ? result.details : null
  if (details) {
    addPathArray(paths, seen, details.paths)
    if (isRecord(details.media)) addPathArray(paths, seen, details.media.mediaUrls)
  }

  const content = Array.isArray(result.content) ? result.content : []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      collectMediaPathsFromText(paths, seen, block.text)
    }
  }

  return paths
}

export function ImageGenerationToolWidget({
  widget,
  isStreaming
}: ToolWidgetComponentProps): React.JSX.Element {
  const paths = useMemo(() => collectGeneratedImagePaths(widget.result), [widget.result])
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])

  useEffect(() => {
    if (paths.length === 0) {
      setAttachments([])
      return
    }

    let cancelled = false
    void window.api.attachments
      .statPaths(paths.map((path) => ({ path })))
      .then((items) => {
        if (!cancelled) setAttachments(items.filter((item) => item.kind === 'image'))
      })
      .catch((error) => {
        console.error('Failed to load generated image attachments', error)
        if (!cancelled) setAttachments([])
      })

    return () => {
      cancelled = true
    }
  }, [paths])

  if (isStreaming && attachments.length === 0) {
    return (
      <div className="flex items-center gap-2 py-0.5 text-muted-foreground/90">
        <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
        <span className="min-w-0 truncate">Generating image</span>
      </div>
    )
  }

  if (attachments.length === 0) {
    return (
      <div className="flex items-center gap-2 py-0.5 text-muted-foreground/90">
        <ImageIcon className="size-3.5" strokeWidth={1.8} />
        <span className="min-w-0 truncate">Generated image</span>
      </div>
    )
  }

  return (
    <div className="space-y-2 py-1">
      {attachments.map((attachment) => (
        <AttachmentCard
          key={attachment.id}
          attachment={attachment}
          display="image"
          imageSize="large"
        />
      ))}
    </div>
  )
}
