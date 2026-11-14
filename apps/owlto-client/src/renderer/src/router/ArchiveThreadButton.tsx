import { ActionIconButton } from '@renderer/components/ui/action-button'
import { ArchiveIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import { useAppStore } from '../app/store'
import { threadTitle, useThreadTitle } from './activity'
import { useRouterStore } from './store'

/**
 * Sits over a sidebar thread row and shows on hover. The row leaves the list once the thread
 * is archived; archiving the open thread starts a new one in its place.
 */
export function ArchiveThreadButton({ thread }: { thread: Router }) {
  const { t } = useTranslation()
  const untitled = useThreadTitle()
  const archive = useRouterStore((s) => s.archive)
  const label = t('archives.archiveThread', { title: threadTitle(thread, untitled) })
  return (
    <ActionIconButton
      size="custom"
      className="router-thread-archive"
      label={label}
      tooltip={t('archives.archive')}
      tooltipSide="right"
      icon={<ArchiveIcon size={15} />}
      onAction={async () => {
        const open = useAppStore.getState()
        const current = open.view === 'chat' && open.threadId === thread.id
        if ((await archive(thread.id, true)) && current) open.newThread()
      }}
    />
  )
}
