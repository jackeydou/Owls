import { ActionIconButton } from '@renderer/components/ui/action-button'
import { TrashXIcon, UnarchiveIcon } from '@renderer/components/ui/icons'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import { threadTitle, useThreadTitle } from '../router/activity'
import { useRouterStore } from '../router/store'
import { useAppStore } from './store'

/** Most recently archived first. */
const byArchived = (a: Router, b: Router) =>
  (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '') || a.id.localeCompare(b.id)

/** One compact row: the title opens the thread; icon buttons unarchive or delete it. */
function ArchivedThread({ thread }: { thread: Router }) {
  const { t, i18n } = useTranslation()
  const untitled = useThreadTitle()
  const showThread = useAppStore((s) => s.showThread)
  const projectName = useAppStore(
    (s) => s.projects.find((p) => p.id === thread.projectId)?.name ?? null
  )
  const archive = useRouterStore((s) => s.archive)
  const deleteThread = useRouterStore((s) => s.deleteThread)
  const title = threadTitle(thread, untitled)
  const date = new Intl.DateTimeFormat(i18n.language === 'zh-CN' ? 'zh-CN' : 'en', {
    dateStyle: 'medium'
  }).format(new Date(thread.archivedAt ?? thread.updatedAt))
  const meta = [t('archives.archivedOn', { date }), projectName].filter(Boolean).join(' · ')
  return (
    <li className="owlto-archived-thread">
      <button
        type="button"
        className="owlto-archived-open"
        aria-label={t('archives.open', { title })}
        onClick={() => showThread(thread.id)}
      >
        <span>{title}</span>
        <small>{meta}</small>
      </button>
      {/* The row leaves the list on success; a failure shows as a toast. */}
      <ActionIconButton
        size="custom"
        className="owlto-archived-action"
        label={t('archives.unarchive')}
        tooltip={t('archives.unarchive')}
        icon={<UnarchiveIcon size={16} />}
        onAction={async () => void (await archive(thread.id, false))}
      />
      <ActionIconButton
        size="custom"
        className="owlto-archived-action"
        label={t('archives.delete')}
        tooltip={t('archives.delete')}
        icon={<TrashXIcon size={16} />}
        onAction={async () => void (await deleteThread(thread.id))}
      />
    </li>
  )
}

export function ArchivesSettingsPane() {
  const { t } = useTranslation()
  const routers = useRouterStore((s) => s.routers)
  const archived = useMemo(
    () => routers.filter((r) => r.archivedAt && r.itemCount).sort(byArchived),
    [routers]
  )
  return (
    <section className="owlto-settings-section">
      <h2>{t('archives.title')}</h2>
      <p>{t('archives.body')}</p>
      {archived.length ? (
        <ul className="owlto-archived-list">
          {archived.map((thread) => (
            <ArchivedThread key={thread.id} thread={thread} />
          ))}
        </ul>
      ) : (
        <p className="owlto-note owlto-archives-empty">{t('archives.none')}</p>
      )}
    </section>
  )
}
