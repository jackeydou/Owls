import { create } from 'zustand'
import type {
  ArtifactRecord,
  FileArtifactPayload,
  ImageArtifactPayload,
  SaveArtifactRequest,
  StreamingUiArtifactPayload
} from '../../../shared/artifacts'
import type { MessageAttachment } from '../../../shared/attachments'
import type { ToolWidgetState } from '../components/tool-widgets/types'

type ArtifactsState = {
  artifacts: ArtifactRecord[]
  loaded: boolean
  busy: boolean
  lastError: string | null
  load: () => Promise<void>
  saveArtifact: (request: SaveArtifactRequest) => Promise<ArtifactRecord>
  saveStreamingUiWidget: (params: {
    sessionId: string
    messageId: string
    widget: ToolWidgetState
  }) => Promise<ArtifactRecord>
  saveTextSelection: (params: {
    sessionId: string
    messageId: string
    text: string
    title?: string
    sourceLabel?: string | null
  }) => Promise<ArtifactRecord>
  saveAttachment: (params: {
    sessionId: string
    messageId: string
    attachment: MessageAttachment
  }) => Promise<ArtifactRecord>
  saveImageUrl: (params: {
    sessionId: string
    messageId: string
    url: string
    title?: string
    alt?: string | null
  }) => Promise<ArtifactRecord>
  deleteArtifact: (id: string) => Promise<void>
}

function isStreamingUiWidget(widget: ToolWidgetState): boolean {
  return widget.toolName === 'streamingUITool' && typeof widget.args.html === 'string'
}

function stableHash(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

function isLocalImageUrl(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//')
}

export const useArtifactsStore = create<ArtifactsState>((set, get) => ({
  artifacts: [],
  loaded: false,
  busy: false,
  lastError: null,

  load: async () => {
    try {
      const artifacts = await window.api.artifacts.list()
      set({ artifacts, loaded: true, lastError: null })
    } catch (e) {
      console.error('Failed to load artifacts', e)
      set({ loaded: true, lastError: e instanceof Error ? e.message : String(e) })
    }
  },

  saveArtifact: async (request) => {
    set({ busy: true, lastError: null })
    try {
      const saved = await window.api.artifacts.save(request)
      const nextArtifacts = [
        saved,
        ...get().artifacts.filter((artifact) => artifact.id !== saved.id)
      ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      set({ artifacts: nextArtifacts, busy: false, loaded: true })
      return saved
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      set({ busy: false, lastError: message })
      throw e
    }
  },

  saveStreamingUiWidget: async ({ sessionId, messageId, widget }) => {
    if (!isStreamingUiWidget(widget)) {
      throw new Error('Only completed streaming UI widgets can be saved to artifacts.')
    }

    const payload: StreamingUiArtifactPayload = {
      toolName: 'streamingUITool',
      title: widget.title,
      html: String(widget.args.html)
    }
    return get().saveArtifact({
      kind: 'streaming-ui',
      title: widget.title,
      payload,
      sourceSessionId: sessionId,
      sourceMessageId: messageId,
      sourceToolCallId: widget.toolCallId
    })
  },

  saveTextSelection: async ({ sessionId, messageId, text, title, sourceLabel }) => {
    const trimmed = text.trim()
    if (!trimmed) {
      throw new Error('Cannot save an empty text artifact.')
    }

    return get().saveArtifact({
      kind: 'text',
      title: title ?? trimmed.split(/\s+/).slice(0, 8).join(' '),
      payload: {
        text: trimmed,
        sourceLabel: sourceLabel ?? null
      },
      sourceSessionId: sessionId,
      sourceMessageId: messageId,
      sourceToolCallId: `selection:${messageId}:${stableHash(trimmed)}`
    })
  },

  saveAttachment: async ({ sessionId, messageId, attachment }) => {
    const basePayload = {
      name: attachment.name,
      path: attachment.path,
      mimeType: attachment.mimeType ?? null,
      size: attachment.size ?? null
    }

    if (attachment.kind === 'image') {
      const payload: ImageArtifactPayload = {
        source: 'file',
        ...basePayload,
        previewDataUrl: attachment.previewDataUrl ?? null
      }
      return get().saveArtifact({
        kind: 'image',
        title: attachment.name,
        payload,
        sourceSessionId: sessionId,
        sourceMessageId: messageId,
        sourceToolCallId: `attachment:${attachment.id}`
      })
    }

    const payload: FileArtifactPayload = basePayload
    return get().saveArtifact({
      kind: 'file',
      title: attachment.name,
      payload,
      sourceSessionId: sessionId,
      sourceMessageId: messageId,
      sourceToolCallId: `attachment:${attachment.id}`
    })
  },

  saveImageUrl: async ({ sessionId, messageId, url, title, alt }) => {
    if (isLocalImageUrl(url)) {
      const [attachment] = await window.api.attachments.statPaths([{ path: url }])
      const payload: ImageArtifactPayload = {
        source: 'file',
        name: attachment?.name ?? title ?? url.split('/').pop() ?? url,
        path: url,
        mimeType: attachment?.mimeType ?? null,
        size: attachment?.size ?? null,
        previewDataUrl: attachment?.previewDataUrl ?? null
      }
      return get().saveArtifact({
        kind: 'image',
        title: title ?? payload.name,
        payload,
        sourceSessionId: sessionId,
        sourceMessageId: messageId,
        sourceToolCallId: `image-file:${messageId}:${stableHash(url)}`
      })
    }

    const payload: ImageArtifactPayload = {
      source: 'url',
      title: title ?? alt ?? url,
      url,
      alt: alt ?? null
    }
    return get().saveArtifact({
      kind: 'image',
      title: payload.title,
      payload,
      sourceSessionId: sessionId,
      sourceMessageId: messageId,
      sourceToolCallId: `image-url:${messageId}:${stableHash(url)}`
    })
  },

  deleteArtifact: async (id) => {
    set({ busy: true, lastError: null })
    try {
      await window.api.artifacts.delete(id)
      set((s) => ({
        artifacts: s.artifacts.filter((artifact) => artifact.id !== id),
        busy: false
      }))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      set({ busy: false, lastError: message })
      throw e
    }
  }
}))
