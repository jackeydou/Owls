import type { JSONContent } from '@tiptap/core'
import type {
  InstalledPlugin,
  MessageAttachment,
  PluginMarketplaceEntry
} from '../../../../preload/index.d'
import type { CommentAttachmentMessagePart, MessagePart } from '../../../../shared/message-parts'
import type { ComposerContextTag } from './context-tags'

export type PluginInstallPrompt = {
  key: string
  action: 'install' | 'update'
  entry: PluginMarketplaceEntry
  installed?: InstalledPlugin
  title: string
  fromVersion?: string
  toVersion?: string
}

export type SelectionContext = {
  id: string
  text: string
  sourceMessageId?: string
}

export type ArtifactContext = {
  id: string
  artifactId: string
  kind: string
  title: string
  body: string
  preview: string
}

export type AddChatTextEventDetail =
  | string
  | {
      text?: string
      sourceMessageId?: string
      target?: 'main' | 'side'
    }

export type FocusChatComposerEventDetail = {
  target?: 'main' | 'side'
}

export type AddChatArtifactEventDetail = ArtifactContext | ArtifactContext[]

export type CommentAttachmentContext = CommentAttachmentMessagePart

export type AddChatCommentEventDetail =
  | CommentAttachmentContext
  | (Omit<CommentAttachmentContext, 'commentId' | 'id' | 'type' | 'title' | 'preview'> &
      Partial<Pick<CommentAttachmentContext, 'commentId' | 'id' | 'title' | 'preview'>>)

export type SetChatDraftEventDetail = {
  text: string
  contextTags?: ComposerContextTag[]
  behavior?: 'replace' | 'append'
}

export type ComposerTrigger = {
  query: string
  start: number
  end: number
}

export type ComposerSubmitOptions = {
  agentText?: string
  parts?: MessagePart[]
}

export type OpenSideChatEventDetail = {
  parentSessionId?: string
  forceNew?: boolean
  focusComposer?: boolean
  initialText?: string
  selectionText?: string
  sourceMessageId?: string
}

export type ComposerQueuedPrompt = {
  id: string
  text: string
  parts?: MessagePart[]
  attachments?: MessageAttachment[]
}

export type RestoredQueuedPromptContent = {
  doc: JSONContent
  selectionContexts: SelectionContext[]
  artifactContexts: ArtifactContext[]
  commentAttachments: CommentAttachmentContext[]
}
