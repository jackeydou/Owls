import { ActionButton, ActionIconButton } from '@renderer/components/ui/action-button'
import { PaperclipIcon, XIcon } from '@renderer/components/ui/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useTranslation } from 'react-i18next'
import { type RouterWorker, STEER_MODES } from '../../../shared/router'
import { useRouterStore } from './store'

/** Statuses with a turn in progress; a message written then waits in the queue. */
const BUSY = ['starting', 'running', 'waiting']
export const isBusy = (worker: RouterWorker): boolean => BUSY.includes(worker.status)

/**
 * What the user wrote while the worker was busy. Each message waits until the turn
 * ends, unless the user steers it in now. Claude Code and Codex take it into the
 * running turn; Cursor cannot, so its turn is interrupted and the message starts
 * the next one.
 */
export function WorkerPendingQueue({ worker }: { worker: RouterWorker }) {
  const { t } = useTranslation()
  const { steerPending, dropPending } = useRouterStore()
  const pending = worker.pending ?? []
  if (!pending.length) return null
  const busy = isBusy(worker)
  const mode = busy ? STEER_MODES[worker.provider] : 'send'
  const action = { routerId: worker.routerId, workerId: worker.id }
  return (
    <section className="worker-queue" aria-label={t('workerQueue.label')}>
      <h3>
        {t(busy ? 'workerQueue.heading' : 'workerQueue.headingIdle', { count: pending.length })}
      </h3>
      <ul>
        {pending.map((message) => (
          <li key={message.id}>
            <p>
              {message.attachments?.length ? (
                <span className="worker-queue-files">
                  <PaperclipIcon size={12} aria-hidden />
                  {message.attachments.length}
                </span>
              ) : null}
              {message.text || t('workerQueue.filesOnly')}
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="worker-queue-steer">
                  <ActionButton
                    size="sm"
                    variant="outline"
                    onAction={() => steerPending({ ...action, messageId: message.id })}
                  >
                    {t(`workerQueue.steer.${mode}`)}
                  </ActionButton>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64">
                {t(`workerQueue.steerHint.${mode}`)}
              </TooltipContent>
            </Tooltip>
            <ActionIconButton
              size="sm"
              label={t('workerQueue.remove')}
              tooltip={t('workerQueue.remove')}
              icon={<XIcon size={14} />}
              onAction={() => dropPending({ ...action, messageId: message.id })}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
