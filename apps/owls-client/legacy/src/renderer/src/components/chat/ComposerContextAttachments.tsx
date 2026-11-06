import { IconButton } from '@renderer/components/ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import { Archive, MessageSquare, X } from 'lucide-react'
import type { MessageAttachment } from '../../../../preload/index.d'
import { AttachmentCard } from './AttachmentCard'
import type {
  ArtifactContext,
  CommentAttachmentContext,
  SelectionContext
} from './chat-composer-types'
import type { ComposerEventTarget } from './composer-events'
import { selectCommentAttachment } from './composer-events'
import { SelectionContextPill } from './SelectionContextPill'

export function ComposerContextAttachments({
  artifactContexts,
  attachmentError,
  attachments,
  composerTarget = 'main',
  commentAttachments,
  onRemoveArtifact,
  onRemoveAttachment,
  onRemoveComment,
  onRemoveSelection,
  selectionContexts
}: {
  artifactContexts: ArtifactContext[]
  attachmentError: string | null
  attachments: MessageAttachment[]
  composerTarget?: ComposerEventTarget
  commentAttachments: CommentAttachmentContext[]
  onRemoveArtifact: (id: string) => void
  onRemoveAttachment: (id: string) => void
  onRemoveComment: (commentId: string) => void
  onRemoveSelection: (id: string) => void
  selectionContexts: SelectionContext[]
}): React.JSX.Element {
  const { t } = useI18n()
  const browserCommentLabels = new Map<string, number>()
  let browserCommentCount = 0
  for (const comment of commentAttachments) {
    if (comment.origin !== 'browser') continue
    browserCommentCount += 1
    browserCommentLabels.set(comment.commentId, browserCommentCount)
  }

  return (
    <>
      {selectionContexts.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-3.5 pt-2.5">
          <SelectionContextPill
            selections={selectionContexts}
            onRemoveAll={() => {
              for (const selection of selectionContexts) {
                onRemoveSelection(selection.id)
              }
            }}
          />
        </div>
      ) : null}

      {artifactContexts.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-3.5 pt-2.5">
          {artifactContexts.map((artifact) => (
            <div
              key={artifact.id}
              className="group/artifact-chip relative flex max-w-md items-center gap-3 rounded-xl border border-border/70 bg-background px-3 py-2 shadow-sm"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card-muted text-muted-foreground">
                <Archive className="size-4" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-foreground">
                  {artifact.title}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">{artifact.preview}</div>
              </div>
              <IconButton
                label={t('chat.artifact.removeContext')}
                icon={<X className="size-3" strokeWidth={2} aria-hidden />}
                variant="unstyled"
                size="custom"
                className="absolute -right-1.5 -top-1.5 size-5 bg-foreground text-background opacity-0 shadow-sm transition hover:bg-foreground/90 group-hover/artifact-chip:opacity-100 focus-visible:opacity-100"
                onClick={() => onRemoveArtifact(artifact.id)}
              />
            </div>
          ))}
        </div>
      ) : null}

      {commentAttachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-3.5 pt-2.5">
          {commentAttachments.map((comment) => (
            <Tooltip key={comment.commentId}>
              <div className="group/comment-chip relative inline-flex h-9 w-[220px] max-w-full min-w-0 items-center rounded-full border border-border/70 bg-background/80 px-2 pr-2.5 text-left shadow-none transition hover:bg-card-muted/30">
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="flex h-full min-w-0 flex-1 items-center rounded-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${comment.title}: ${comment.preview}`}
                    onClick={() => {
                      if (comment.origin === 'browser') {
                        selectCommentAttachment({
                          comment,
                          label: browserCommentLabels.get(comment.commentId),
                          target: composerTarget
                        })
                      }
                    }}
                  >
                    <div className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card-muted text-muted-foreground">
                      <MessageSquare className="size-4" strokeWidth={1.8} />
                    </div>
                    <div className="ml-2 min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium leading-5 text-foreground">
                        {comment.origin === 'browser'
                          ? t('chat.comment.browser')
                          : t('chat.comment.artifact')}
                        <span className="font-normal text-muted-foreground"> · </span>
                        <span className="font-normal text-muted-foreground">{comment.preview}</span>
                      </div>
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="max-h-48 max-w-[360px] overflow-auto whitespace-pre-wrap wrap-break-word text-left"
                >
                  {comment.preview}
                </TooltipContent>
                <IconButton
                  label={t('chat.comment.removeContext')}
                  icon={<X className="size-3.5" strokeWidth={1.9} aria-hidden />}
                  variant="unstyled"
                  size="custom"
                  className="ml-1 size-5 shrink-0 text-muted-foreground opacity-0 transition hover:bg-card-muted hover:text-foreground group-hover/comment-chip:opacity-100 focus-visible:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemoveComment(comment.commentId)
                  }}
                />
              </div>
            </Tooltip>
          ))}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-3.5 pt-2.5">
          {attachments.map((attachment) => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              onRemove={() => onRemoveAttachment(attachment.id)}
            />
          ))}
        </div>
      ) : null}
      {attachmentError ? (
        <div className="px-4 pt-2 text-[12px] text-destructive">{attachmentError}</div>
      ) : null}
    </>
  )
}
