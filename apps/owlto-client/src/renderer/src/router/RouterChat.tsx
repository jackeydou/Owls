import { ActionIconButton } from '@renderer/components/ui/action-button'
import { MoonZIcon } from '@renderer/components/ui/icons'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import { useAppStore } from '../app/store'
import { useDreamingStore, useDreamLocked } from '../memory/dreaming'
import { threadTitle, useThreadTitle } from './activity'
import { RequestTray } from './RequestTray'
import { RouterGuide } from './RouterGuide'
import { RouterSetupNotice, useRouterSetup } from './RouterSetup'
import { RouterTimeline } from './RouterTimeline'
import { useRouterStore } from './store'
import { ThreadEditor } from './ThreadEditor'

/** The manual Dreaming experiment: sorts this thread into memory now. */
function DreamButton({ router }: { router: Router }) {
  const { t } = useTranslation()
  const enabled = useAppStore(
    (s) => s.settings.experiments.manualDreaming && s.settings.memory.learn
  )
  const dreamThread = useDreamingStore((s) => s.dreamThread)
  const locked = useDreamLocked(router.id)
  const busy = useDreamingStore((s) => s.lockedThreadId !== null && !locked)
  if (!enabled) return null
  const label = t(router.status === 'running' ? 'thread.dreamBusy' : 'thread.dreamNow')
  return (
    <ActionIconButton
      className="router-dream-button"
      label={label}
      tooltip={label}
      tooltipSide="bottom"
      icon={<MoonZIcon size={18} />}
      pending={locked}
      disabled={router.status === 'running' || busy}
      doneLabel={t('thread.dreamDone')}
      onAction={() => dreamThread(router.id)}
    />
  )
}
/** The home screen: one thread with its Router, or a new thread's first line. */
export function RouterChat() {
  const threadId = useAppStore((s) => s.threadId)
  const loadItems = useRouterStore((s) => s.loadItems)
  const router = useRouterStore((s) => s.routers.find((r) => r.id === threadId))
  const projectName = useAppStore((s) => s.projects.find((p) => p.id === router?.projectId)?.name)
  const untitled = useThreadTitle()
  const setup = useRouterSetup(router)
  const locked = useDreamLocked(router?.id)
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
    <main className="owlto-chat router-chat">
      <header className="owlto-topbar router-topbar">
        {router ? (
          <div className="router-thread-heading">
            <strong>{threadTitle(router, untitled)}</strong>
            {projectName ? <span>{projectName}</span> : null}
          </div>
        ) : null}
        {router ? <DreamButton router={router} /> : null}
      </header>
      <div className="owlto-conversation-column">
        {missing && !guideSkipped && !router?.itemCount ? (
          <RouterGuide need={missing} />
        ) : (
          <RouterTimeline
            router={router}
            editor={
              // A thread the user sent to Dreaming takes no input until the run ends.
              <div className="router-editor-lock" inert={locked}>
                {missing ? <RouterSetupNotice need={missing} /> : null}
                {router ? <RequestTray routerId={router.id} /> : null}
                <ThreadEditor router={router} />
              </div>
            }
          />
        )}
      </div>
    </main>
  )
}
