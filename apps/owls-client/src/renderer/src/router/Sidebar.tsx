import { ResizeHandle } from '@renderer/components/ui/resize-handle'
import { Network, Settings2, SquarePen } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CodexRouter } from '../../../shared/codex'
import { agentConnection, useCodexStore } from '../codex/store'
import { byRecent, isWaitingOnUser, isWorking, threadTitle, useThreadTitle } from './activity'
import { usePaneWidth } from './pane-width'
import { useRouterStore } from './store'

function ThreadEntry({ thread }: { thread: CodexRouter }) {
  const { t } = useTranslation()
  const current = useCodexStore((s) => s.view === 'chat' && s.threadId === thread.id)
  const showThread = useCodexStore((s) => s.showThread)
  const untitled = useThreadTitle()
  const state = useRouterStore((s) => {
    const workers = s.workers.filter((w) => w.routerId === thread.id && w.status !== 'removed')
    if (workers.some(isWaitingOnUser)) return 'wait'
    return thread.status === 'running' || workers.some(isWorking) ? 'run' : null
  })
  const title = threadTitle(thread, untitled)
  return (
    <button
      type="button"
      className="router-thread"
      aria-label={state ? t(`thread.state.${state}`, { title }) : title}
      aria-current={current || undefined}
      onClick={() => showThread(thread.id)}
    >
      <span>{title}</span>
      {state ? <i className={state} aria-hidden /> : null}
    </button>
  )
}
export function Sidebar() {
  const { t } = useTranslation()
  const { width, handle } = usePaneWidth('sidebar', 'right')
  const onMap = useCodexStore((s) => s.view === 'map')
  const drafting = useCodexStore((s) => s.view === 'chat' && s.threadId === null)
  const { showMap, showSettings, newThread } = useCodexStore()
  const routers = useRouterStore((s) => s.routers)
  // A thread exists once it has its first message; this hides one whose send failed.
  const threads = useMemo(() => routers.filter((r) => r.itemCount).sort(byRecent), [routers])
  const provider = useCodexStore((s) => s.settings.provider)
  const connection = useCodexStore((s) => agentConnection(s, provider))
  return (
    <nav className="router-sidebar" style={{ width }} aria-label={t('router.sidebar')}>
      <div className="router-sidebar-head" />
      <button
        type="button"
        className="router-sidebar-item router-sidebar-action"
        aria-current={drafting || undefined}
        onClick={() => newThread()}
      >
        <SquarePen size={15} />
        <span>{t('thread.new')}</span>
        <kbd>⌘ N</kbd>
      </button>
      <button
        type="button"
        className="router-sidebar-item router-sidebar-action"
        aria-current={onMap || undefined}
        onClick={showMap}
      >
        <Network size={15} />
        <span>{t('map.title')}</span>
        <kbd>⌘ J</kbd>
      </button>
      <section className="router-sidebar-threads" aria-label={t('thread.title')}>
        <header>
          <h2>{t('thread.title')}</h2>
        </header>
        {threads.length ? (
          <div className="router-sidebar-list">
            {threads.map((thread) => (
              <ThreadEntry key={thread.id} thread={thread} />
            ))}
          </div>
        ) : (
          <p>{t('thread.none')}</p>
        )}
      </section>
      <button
        type="button"
        className={`router-sidebar-item router-sidebar-action router-sidebar-settings ${connection.status}`}
        onClick={() => showSettings()}
      >
        <Settings2 size={15} />
        <span>{t('settings')}</span>
      </button>
      <ResizeHandle {...handle} />
    </nav>
  )
}
