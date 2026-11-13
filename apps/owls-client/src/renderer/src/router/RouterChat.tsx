import { useEffect, useState } from 'react'
import { useAppStore } from '../app/store'
import { threadTitle, useThreadTitle } from './activity'
import { RequestTray } from './RequestTray'
import { RouterGuide } from './RouterGuide'
import { RouterSetupNotice, useRouterSetup } from './RouterSetup'
import { RouterTimeline } from './RouterTimeline'
import { useRouterStore } from './store'
import { ThreadEditor } from './ThreadEditor'

/** The home screen: one thread with its Router, or a new thread's first line. */
export function RouterChat() {
  const threadId = useAppStore((s) => s.threadId)
  const loadItems = useRouterStore((s) => s.loadItems)
  const router = useRouterStore((s) => s.routers.find((r) => r.id === threadId))
  const projectName = useAppStore((s) => s.projects.find((p) => p.id === router?.projectId)?.name)
  const untitled = useThreadTitle()
  const setup = useRouterSetup(router)
  const guideSkipped = useRouterStore((s) => s.guideSkipped)
  const connecting = useAppStore(
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
    if (threadId) void loadItems(threadId)
  }, [threadId, loadItems])
  return (
    <main className="owls-chat router-chat">
      <header className="owls-topbar router-topbar">
        {router ? (
          <div className="router-thread-heading">
            <strong>{threadTitle(router, untitled)}</strong>
            {projectName ? <span>{projectName}</span> : null}
          </div>
        ) : null}
      </header>
      <div className="owls-conversation-column">
        {missing && !guideSkipped && !router?.itemCount ? (
          <RouterGuide need={missing} />
        ) : (
          <RouterTimeline
            router={router}
            editor={
              <>
                {missing ? <RouterSetupNotice need={missing} /> : null}
                {router ? <RequestTray routerId={router.id} /> : null}
                <ThreadEditor router={router} />
              </>
            }
          />
        )}
      </div>
    </main>
  )
}
