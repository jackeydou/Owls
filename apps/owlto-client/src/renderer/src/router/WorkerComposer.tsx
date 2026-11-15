import { IconButton } from '@renderer/components/ui/icon-button'
import { ArrowUpIcon, InfoIcon, LoaderIcon, PaperclipIcon } from '@renderer/components/ui/icons'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { RouterWorker } from '../../../shared/router'
import { workerTitle } from './activity'
import { DraftAttachmentChips, useDraftAttachments } from './DraftAttachments'
import { DraftCards, DraftInput, MentionMenu, useRouterDraft } from './RouterDraft'
import { useRouterStore } from './store'

const isEnter = (event: KeyboardEvent) => event.key === 'Enter' && !event.shiftKey
/** Statuses with a turn in progress, which a Cursor worker cannot take a message into. */
const BUSY = ['starting', 'running', 'waiting']

/**
 * Writes to one worker from its panel. The message goes straight to the worker, not
 * through the Router, and may carry pasted images and picked files. It is written
 * as Markdown source, which the worker reads as is.
 */
export function WorkerComposer({ worker }: { worker: RouterWorker }) {
  const { t } = useTranslation()
  const router = useRouterStore((s) => s.routers.find((r) => r.id === worker.routerId))
  const attachments = useDraftAttachments()
  const draft = useRouterDraft({
    projectId: worker.projectId,
    router,
    target: worker,
    isSendKey: isEnter,
    attachments
  })
  const picker = useRef<HTMLInputElement>(null)
  if (worker.status === 'removed')
    return (
      <p className="worker-composer-note worker-composer-removed">{t('workerComposer.removed')}</p>
    )
  const title = workerTitle(worker)
  // ACP has no way into a running turn, so the message waits for the next one.
  const queued = worker.provider === 'cursor' && BUSY.includes(worker.status)
  return (
    <div className="worker-composer">
      {queued ? (
        <p className="worker-composer-note">
          <InfoIcon size={13} />
          <span>{t('workerComposer.queuedNote')}</span>
        </p>
      ) : null}
      <MentionMenu options={draft.options} highlight={draft.highlight} onPick={draft.pick} />
      <fieldset
        className="owlto-composer"
        aria-label={t('workerComposer.label', { title })}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        }}
        onDrop={(event) => {
          // The input takes files dropped on it itself.
          if (event.defaultPrevented || !event.dataTransfer.files.length) return
          event.preventDefault()
          attachments.add([...event.dataTransfer.files])
        }}
      >
        <DraftAttachmentChips attachments={attachments} />
        <DraftCards cards={draft.cards} onRemove={draft.removeCard} />
        <DraftInput
          editor={draft.editor}
          empty={draft.empty}
          label={t('workerComposer.label', { title })}
          placeholder={t('workerComposer.placeholder')}
        />
        {attachments.error ? (
          <p className="worker-composer-error" role="alert">
            {attachments.error}
          </p>
        ) : null}
        <div className="owlto-composer-toolbar">
          <IconButton
            size="sm"
            className="worker-composer-attach"
            label={t('workerComposer.attach')}
            tooltip={t('workerComposer.attach')}
            icon={<PaperclipIcon size={16} />}
            onClick={() => picker.current?.click()}
          />
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            onChange={(event) => {
              attachments.add([...(event.target.files ?? [])])
              // The same file can be picked again after it was removed.
              event.target.value = ''
              draft.editor.commands.focus()
            }}
          />
          <IconButton
            variant="default"
            className="owlto-send"
            label={t('workerComposer.send')}
            tooltip={t('workerComposer.send')}
            icon={
              draft.sending || attachments.staging ? (
                <LoaderIcon size={18} className="animate-spin" />
              ) : (
                <ArrowUpIcon size={19} />
              )
            }
            disabled={!draft.canSend}
            onClick={() => void draft.submit()}
          />
        </div>
      </fieldset>
    </div>
  )
}
