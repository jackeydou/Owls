import { useTranslation } from 'react-i18next'
import type { SessionItem } from '../../../shared/app'
import { UserAvatar } from '../app/UserAvatar'
import { MessageAttachments } from './DraftAttachments'

/** A message the user wrote to the worker from its panel, with the files it carried. */
export function WorkerUserMessage({ item }: { item: SessionItem }) {
  const { t } = useTranslation()
  return (
    <div className="worker-router-message worker-user-message">
      <div>
        <span>{t('workerComposer.you')}</span>
        {item.attachments?.length ? <MessageAttachments attachments={item.attachments} /> : null}
        {item.text ? <p>{item.text}</p> : null}
      </div>
      <UserAvatar className="worker-user-avatar" />
    </div>
  )
}
