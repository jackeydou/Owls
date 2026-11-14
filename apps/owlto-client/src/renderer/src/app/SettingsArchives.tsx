import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import { threadTitle, useThreadTitle } from '../router/activity'
import { useRouterStore } from '../router/store'
import { useAppStore } from './store'

/** Most recently archived first. */
const byArchived = (a: Router, b: Router) =>
  (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '') || a.id.localeCompare(b.id)

function ArchivedThread({ thread }: { thread: Router }) {
  const { t, i18n } = useTranslation()
  const untitled = useThreadTitle()
  const showThread = useAppStore((s) => s.showThread)
  const projectName = useAppStore(
    (s) => s.projects.find((p) => p.id === thread.projectId)?.name ?? null
  )
  const archive = useRouterStore((s) => s.archive)
  const date = new Intl.DateTimeFormat(i18n.language === 'zh-CN' ? 'zh-CN' : 'en', {
    dateStyle: 'medium'
  }).format(new Date(thread.archivedAt ?? thread.updatedAt))
  const meta = [t('archives.archivedOn', { date }), projectName].filter(Boolean).join(' · ')
  return (
    <div className="owlto-setting-row owlto-archived-thread">
      <div className="owlto-setting-text">
        <h3>{threadTitle(thread, untitled)}</h3>
        <small>{meta}</small>
      </div>
      <div className="owlto-settings-actions">
        <Button size="sm" variant="ghost" onClick={() => showThread(thread.id)}>
          {t('archives.open')}
        </Button>
        {/* The row leaves the list on success; a failure shows as a toast. */}
        <ActionButton
          size="sm"
          variant="outline"
          onAction={async () => void (await archive(thread.id, false))}
        >
          {t('archives.unarchive')}
        </ActionButton>
      </div>
    </div>
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
        archived.map((thread) => <ArchivedThread key={thread.id} thread={thread} />)
      ) : (
        <p className="owlto-note owlto-archives-empty">{t('archives.none')}</p>
      )}
    </section>
  )
}
