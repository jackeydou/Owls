import { IconButton } from '@renderer/components/ui/icon-button'
import { ArrowUpIcon, LoaderIcon, StopIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import type { RouterWorker } from '../../../shared/router'
import { DraftInput, DraftTarget, MentionMenu, useRouterDraft } from './RouterDraft'
import { useRouterStore } from './store'

const isEnter = (event: KeyboardEvent) => event.key === 'Enter' && !event.shiftKey

/** The map's one-line input. It follows the map's selection. */
export function RouterComposer({
  projectId,
  router,
  target,
  onClearTarget
}: {
  projectId: string | null
  router: Router | undefined
  target?: RouterWorker | null
  onClearTarget?: () => void
}) {
  const { t } = useTranslation()
  const interrupt = useRouterStore((s) => s.interrupt)
  const draft = useRouterDraft({
    projectId,
    router,
    target,
    isSendKey: isEnter,
    disabled: !projectId
  })
  const { empty, sending, addressed } = draft
  const running = router?.status === 'running'
  const label = t(addressed ? 'router.promptWorker' : 'router.prompt')
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
        <DraftInput editor={draft.editor} empty={empty} label={label} placeholder={label} />
        <div className="owls-composer-toolbar">
          {running && !addressed && router ? (
            <IconButton
              className="owls-stop"
              label={t('router.stop')}
              tooltip={t('router.stop')}
              icon={<StopIcon size={15} />}
              onClick={() => void interrupt(router.id)}
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
