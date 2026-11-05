import { IconButton } from '@renderer/components/ui/icon-button'
import { Info, Network } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useCodexStore } from '../codex/store'
import { RequestTray } from './RequestTray'
import { RouterComposer } from './RouterComposer'
import { NoProjectCard, RouterSetupCard, useRouterSetup } from './RouterSetup'
import { RouterTimeline } from './RouterTimeline'
import { StatusEntry } from './StatusEntry'
import { useRouterStore } from './store'

/** The home screen: one project's conversation with its Router. */
export function RouterChat() {
  const { t } = useTranslation()
  const projectId = useCodexStore((s) => s.routerProjectId)
  const project = useCodexStore((s) => s.projects.find((p) => p.id === projectId))
  const agent = useCodexStore((s) => s.settings.provider)
  const open = useRouterStore((s) => s.open)
  const showPanel = useRouterStore((s) => s.showPanel)
  const router = useRouterStore((s) => s.routers.find((r) => r.projectId === projectId))
  const setup = useRouterSetup(router)
  useEffect(() => {
    if (projectId) void open(projectId)
  }, [projectId, open])
  const fresh = !router?.items.length
  return (
    <main className="codex-chat router-chat">
      <header className="codex-topbar router-topbar">
        <div className="codex-task-title">{project?.name ?? t('router.title')}</div>
        <div className="codex-topbar-actions">
          <StatusEntry />
          {project ? (
            <IconButton
              label={t('router.details')}
              tooltip={t('router.details')}
              icon={<Info size={16} />}
              onClick={() => showPanel({ kind: 'router' })}
            />
          ) : null}
        </div>
      </header>
      <div className="codex-conversation-column">
        {!project ? (
          <div className="codex-conversation-scroll">
            <div className="codex-conversation">
              <NoProjectCard />
            </div>
          </div>
        ) : router ? (
          <RouterTimeline
            router={router}
            intro={(hasEntries) =>
              setup ? (
                <RouterSetupCard need={setup} />
              ) : hasEntries ? null : (
                <div className="codex-welcome router-card">
                  <Network size={30} />
                  <h1>{t('router.welcome')}</h1>
                  <p>{t('router.welcomeBody', { project: project.name })}</p>
                </div>
              )
            }
          />
        ) : (
          <div className="codex-conversation-scroll" />
        )}
        <div className="codex-composer-area">
          {router ? <RequestTray routerId={router.id} /> : null}
          <RouterComposer
            projectId={project ? projectId : null}
            router={router}
            note={fresh ? t('trustFolder', { agent: t(`agent.${agent}`) }) : undefined}
          />
        </div>
      </div>
    </main>
  )
}
