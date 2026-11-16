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
    <ul className="worker-queue" aria-label={t('workerQueue.label', { count: pending.length })}>
      {pending.map((message) => {
        const text = message.text || t('workerQueue.filesOnly')
        return (
          <li key={message.id}>
            {message.attachments?.length ? (
              <span className="worker-queue-files">
                <PaperclipIcon size={12} aria-hidden />
                {message.attachments.length}
              </span>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focus reveals the full text in the tooltip. */}
                <p tabIndex={0}>{text}</p>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-80 whitespace-pre-wrap">
                {text}
              </TooltipContent>
            </Tooltip>
            <ActionButton
              size="custom"
              variant="ghost"
              className="worker-queue-steer"
              onAction={() => steerPending({ ...action, messageId: message.id })}
            >
              {t(`workerQueue.steer.${mode}`)}
            </ActionButton>
            <ActionIconButton
              size="sm"
              className="worker-queue-remove"
              label={t('workerQueue.remove')}
              tooltip={t('workerQueue.remove')}
              icon={<XIcon size={13} />}
              onAction={() => dropPending({ ...action, messageId: message.id })}
            />
          </li>
        )
      })}
    </ul>
  )
}
