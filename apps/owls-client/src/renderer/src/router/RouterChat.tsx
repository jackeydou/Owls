import { IconButton } from '@renderer/components/ui/icon-button'
import { Info } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCodexStore } from '../codex/store'
import { RequestTray } from './RequestTray'
import { RouterGuide } from './RouterGuide'
import { RouterSetupNotice, useRouterSetup } from './RouterSetup'
import { RouterTimeline } from './RouterTimeline'
import { StatusEntry } from './StatusEntry'
import { useRouterStore } from './store'
import { ThreadEditor } from './ThreadEditor'

/** The home screen: one project's conversation with its Router. */
export function RouterChat() {
  const { t } = useTranslation()
  const projectId = useCodexStore((s) => s.routerProjectId)
  const project = useCodexStore((s) => s.projects.find((p) => p.id === projectId))
  const open = useRouterStore((s) => s.open)
  const showPanel = useRouterStore((s) => s.showPanel)
  const router = useRouterStore((s) => s.routers.find((r) => r.projectId === projectId))
  const setup = useRouterSetup(router)
  const guideSkipped = useRouterStore((s) => s.guideSkipped)
  const connecting = useCodexStore(
    (s) => s.connection.status === 'connecting' || s.claude.status === 'connecting'
  )
  // Agents connect as the app starts, so a working setup must not flash the guide. Later
  // connections are the guide's own and leave it open.
  const [settled, setSettled] = useState(!connecting)
  useEffect(() => {
    if (!connecting) setSettled(true)
  }, [connecting])
  const missing = settled ? setup : null
  useEffect(() => {
    if (projectId) void open(projectId)
  }, [projectId, open])
  return (
    <main className="codex-chat router-chat">
      <header className="codex-topbar router-topbar">
        <div className="codex-topbar-actions">
          <StatusEntry />
          {project ? (
            <IconButton
              className="codex-bar-button"
              label={t('router.details')}
              tooltip={t('router.details')}
              icon={<Info size={16} />}
              onClick={() => showPanel({ kind: 'router' })}
            />
          ) : null}
        </div>
      </header>
      <div className="codex-conversation-column">
        {missing && !guideSkipped && !router?.items.length ? (
          <RouterGuide need={missing} />
        ) : (
          <RouterTimeline
            router={router}
            editor={
              <>
                {missing ? <RouterSetupNotice need={missing} /> : null}
                {router ? <RequestTray routerId={router.id} /> : null}
                <ThreadEditor projectId={project?.id ?? null} router={router} />
              </>
            }
          />
        )}
      </div>
    </main>
  )
}
