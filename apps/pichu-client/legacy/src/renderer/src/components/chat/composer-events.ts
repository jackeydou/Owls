import type { AddChatCommentEventDetail, CommentAttachmentContext } from './chat-composer-types'

export type ComposerEventTarget = 'main' | 'side'

export const COMPOSER_ADD_ATTACHMENTS_EVENT = 'pichu:add-attachments'
export const COMPOSER_ADD_TEXT_EVENT = 'pichu:add-chat-text'
export const COMPOSER_ADD_ARTIFACT_EVENT = 'pichu:add-chat-artifact'
export const COMPOSER_ADD_COMMENT_EVENT = 'pichu:add-chat-comment'
export const COMPOSER_COMMENT_ATTACHMENTS_CHANGED_EVENT = 'pichu:comment-attachments-changed'
export const COMPOSER_SELECT_COMMENT_ATTACHMENT_EVENT = 'pichu:select-comment-attachment'
export const COMPOSER_SET_DRAFT_EVENT = 'pichu:set-chat-draft'
export const COMPOSER_FOCUS_EVENT = 'pichu:focus-chat-composer'
export const SIDE_CHAT_OPEN_EVENT = 'pichu:open-side-chat'

export const PENDING_CHAT_ARTIFACTS_STORAGE_KEY = 'pichu:pending-chat-artifacts'
export const PENDING_CHAT_ATTACHMENTS_STORAGE_KEY = 'pichu:pending-chat-attachments'
export const PENDING_CHAT_DRAFT_STORAGE_KEY = 'pichu:pending-chat-draft'

const latestCommentAttachmentsByTarget = new Map<ComposerEventTarget, CommentAttachmentContext[]>()

export type SelectCommentAttachmentEventDetail = {
  comment: CommentAttachmentContext
  label?: number
  target?: ComposerEventTarget
}

export type AddChatCommentEventPayload =
  | AddChatCommentEventDetail
  | {
      comment: AddChatCommentEventDetail
      target?: ComposerEventTarget
    }

export type CommentAttachmentsChangedEventDetail = {
  comments: CommentAttachmentContext[]
  target: ComposerEventTarget
}

export function addCommentAttachmentToChatComposer(
  detail: AddChatCommentEventDetail,
  target: ComposerEventTarget = 'main'
): void {
  window.dispatchEvent(
    new CustomEvent(COMPOSER_ADD_COMMENT_EVENT, { detail: { comment: detail, target } })
  )
}

export function notifyCommentAttachmentsChanged(
  comments: CommentAttachmentContext[],
  target: ComposerEventTarget = 'main'
): void {
  latestCommentAttachmentsByTarget.set(target, comments)
  window.dispatchEvent(
    new CustomEvent(COMPOSER_COMMENT_ATTACHMENTS_CHANGED_EVENT, {
      detail: { comments, target }
    })
  )
}

export function selectCommentAttachment(detail: SelectCommentAttachmentEventDetail): void {
  window.dispatchEvent(
    new CustomEvent(COMPOSER_SELECT_COMMENT_ATTACHMENT_EVENT, {
      detail
    })
  )
}

export function getLatestCommentAttachments(
  target: ComposerEventTarget = 'main'
): CommentAttachmentContext[] {
  return latestCommentAttachmentsByTarget.get(target) ?? []
}
