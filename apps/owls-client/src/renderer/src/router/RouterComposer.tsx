import { ActionIconButton } from '@renderer/components/ui/action-button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { ArrowUpIcon, LoaderIcon, StopIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import type { CardRef } from '../../../shared/cards'
import type { RouterWorker } from '../../../shared/router'
import { DraftCards, DraftInput, DraftTarget, MentionMenu, useRouterDraft } from './RouterDraft'
import { useRouterStore } from './store'

const isEnter = (event: KeyboardEvent) => event.key === 'Enter' && !event.shiftKey

/** The map's and the board's one-line input. It follows their selection. */
export function RouterComposer({
  projectId,
  router,
  target,
  onClearTarget,
  linkedCards,
  onSent,
  onThread,
  prompt
}: {
  projectId: string | null
  router: Router | undefined
  target?: RouterWorker | null
  onClearTarget?: () => void
  linkedCards?: CardRef[]
  onSent?: () => void
  onThread?: (threadId: string) => void
  /** Placeholder and label in place of the Router prompt. */
  prompt?: string
}) {
  const { t } = useTranslation()
  const interrupt = useRouterStore((s) => s.interrupt)
  const draft = useRouterDraft({
    projectId,
    router,
    target,
    isSendKey: isEnter,
    disabled: !projectId,
    linkedCards,
    onSent,
    onThread
  })
  const { empty, sending, addressed } = draft
  const running = router?.status === 'running'
  const label = addressed ? t('router.promptWorker') : (prompt ?? t('router.prompt'))
  return (
    <div className="router-composer">
      <MentionMenu options={draft.options} highlight={draft.highlight} onPick={draft.pick} />
      <div className="owls-composer">
        {addressed ? (
          <DraftTarget
            worker={addressed}
            onClear={() => (target ? onClearTarget?.() : draft.clearMention())}
          />
        ) : null}
        <DraftCards cards={draft.cards} onRemove={draft.removeCard} />
        <DraftInput editor={draft.editor} empty={empty} label={label} placeholder={label} />
        <div className="owls-composer-toolbar">
          {running && !addressed && router ? (
            <ActionIconButton
              className="owls-stop"
              label={t('router.stop')}
              tooltip={t('router.stop')}
              icon={<StopIcon size={15} />}
              onAction={() => interrupt(router.id)}
            />
          ) : null}
          <IconButton
            variant="default"
            className="owls-send"
            label={t(addressed ? 'router.sendWorker' : 'router.send')}
            tooltip={t(addressed ? 'router.sendWorker' : 'router.send')}
            icon={
              sending ? (
                <LoaderIcon size={18} className="animate-spin" />
              ) : (
                <ArrowUpIcon size={19} />
              )
            }
            disabled={!projectId || empty || sending}
            onClick={() => void draft.submit()}
          />
        </div>
      </div>
    </div>
  )
}
