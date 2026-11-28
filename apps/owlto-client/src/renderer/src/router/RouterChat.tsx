import { ActionIconButton } from '@renderer/components/ui/action-button'
import { MoonZIcon } from '@renderer/components/ui/icons'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import { useAppStore } from '../app/store'
import { useDreamingStore, useDreamLocked } from '../memory/dreaming'
import { SetupCard, useSetupCardVisible } from '../onboarding/SetupCard'
import { useViewingRemote } from '../remote/viewing'
import { threadTitle, useThreadTitle } from './activity'
import { useDraftAttachments } from './DraftAttachments'
import { FileDropOverlay, useFileDrop } from './FileDrop'
import { RequestTray } from './RequestTray'
import { RouterSetupNotice, RouterStarting, useRouterSetup, useStartingAgent } from './RouterSetup'
import { RouterTimeline } from './RouterTimeline'
import { useRouterStore } from './store'
import { ThreadEditor } from './ThreadEditor'
import { ThreadTitleEditor } from './ThreadTitleEditor'

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
  const { t } = useTranslation()
  const untitled = useThreadTitle()
  const setup = useRouterSetup(router)
  const locked = useDreamLocked(router?.id)
  // Agents connect as the app starts, so a working setup must not flash a setup notice.
  const starting = useStartingAgent(setup)
  const setupCard = useSetupCardVisible()
  const [renaming, setRenaming] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes the field when the thread changes.
  useEffect(() => setRenaming(false), [threadId])
  useEffect(() => {
    if (threadId) void loadItems(threadId)
  }, [threadId, loadItems])
  const attachments = useDraftAttachments()
  const { clear } = attachments
  // A draft's files belong to the thread they were dropped on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: clears when the thread changes.
  useEffect(() => clear(), [threadId])
  // Files stay on this Mac, and a thread in Dreaming takes no input.
  const remote = useViewingRemote()
  const drop = useFileDrop(remote || locked ? null : attachments.add)
  return (
    <main className="owlto-chat router-chat" {...drop.handlers}>
      {drop.over ? <FileDropOverlay /> : null}
      <header className="owlto-topbar router-topbar">
        {router ? (
          <div className="router-thread-heading">
            {renaming ? (
              <ThreadTitleEditor thread={router} onClose={() => setRenaming(false)} />
            ) : (
              // Double-clicking the name renames the thread in place.
              <strong onDoubleClick={() => setRenaming(true)}>
                {threadTitle(router, untitled)}
              </strong>
            )}
            {projectName ? <span>{projectName}</span> : null}
            {router.archivedAt ? <span>{t('archives.archived')}</span> : null}
          </div>
        ) : null}
        {router ? <DreamButton router={router} /> : null}
      </header>
      <div className="owlto-conversation-column">
        <RouterTimeline
          router={router}
          editor={
            // A thread the user sent to Dreaming takes no input until the run ends.
            <div className="router-editor-lock" inert={locked}>
              {setupCard ? (
                <SetupCard />
              ) : starting ? (
                <RouterStarting agent={starting} />
              ) : setup ? (
                <RouterSetupNotice need={setup} />
              ) : null}
              {router ? <RequestTray routerId={router.id} /> : null}
              <ThreadEditor router={router} attachments={attachments} />
            </div>
          }
        />
      </div>
    </main>
  )
}
