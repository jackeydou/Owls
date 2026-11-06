export const ARTIFACT_KINDS = ['streaming-ui', 'text', 'file', 'image'] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export type StreamingUiArtifactPayload = {
  toolName: 'streamingUITool'
  title: string
  html: string
}

export type TextArtifactPayload = {
  text: string
  sourceLabel?: string | null
}

export type FileArtifactPayload = {
  name: string
  path: string
  mimeType?: string | null
  size?: number | null
}

export type ImageArtifactPayload =
  | {
      source: 'file'
      name: string
      path: string
      mimeType?: string | null
      size?: number | null
      previewDataUrl?: string | null
    }
  | {
      source: 'url'
      title: string
      url: string
      alt?: string | null
    }

export type ArtifactPayload =
  | StreamingUiArtifactPayload
  | TextArtifactPayload
  | FileArtifactPayload
  | ImageArtifactPayload

export type ArtifactRecord = {
  id: string
  kind: ArtifactKind
  title: string
  payloadJson: string
  sourceSessionId: string | null
  sourceMessageId: string | null
  sourceToolCallId: string | null
  sourceSessionTitle?: string | null
  createdAt: string
  updatedAt: string
}

export type SaveArtifactRequest = {
  kind: ArtifactKind
  title: string
  payload: ArtifactPayload
  sourceSessionId?: string | null
  sourceMessageId?: string | null
  sourceToolCallId?: string | null
}
