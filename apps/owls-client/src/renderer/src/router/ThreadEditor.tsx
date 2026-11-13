import { Button } from '@renderer/components/ui/button'
import { LoaderIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import { useAppStore } from '../app/store'
import { DraftCards, DraftInput, DraftTarget, MentionMenu, useRouterDraft } from './RouterDraft'
import { ThreadRow } from './ThreadRow'

const isCommandEnter = (event: KeyboardEvent) =>
  event.key === 'Enter' && (event.metaKey || event.ctrlKey)

/**
 * Where the user writes next: the thread's last line, not a box under it. Enter
 * is a new line, as in any editor; Command-Enter sends. A new thread has no
 * project until its message names one with `@`; with no projects at all, sending
 * asks for a folder.
 */
export function ThreadEditor({ router }: { router: Router | undefined }) {
  const { t } = useTranslation()
  const hasProjects = useAppStore((s) => s.projects.length > 0)
  const pickProject = useAppStore((s) => s.pickProject)
  const showThread = useAppStore((s) => s.showThread)
  const draft = useRouterDraft({
    projectId: null,
    router,
    isSendKey: isCommandEnter,
    chooseProject: hasProjects ? undefined : pickProject,
    onThread: showThread
  })
  const { empty, sending, addressed } = draft
  return (
    <ThreadRow speaker="user">
      <div className="router-editor">
        {addressed ? <DraftTarget worker={addressed} onClear={draft.clearMention} /> : null}
        <DraftCards cards={draft.cards} onRemove={draft.removeCard} />
        <DraftInput
          editor={draft.editor}
          empty={empty}
          label={t(addressed ? 'router.promptWorker' : 'router.prompt')}
          placeholder={hasProjects ? t(router ? 'thread.hint' : 'thread.hintNew') : undefined}
        />
        <MentionMenu options={draft.options} highlight={draft.highlight} onPick={draft.pick} />
        <div className="router-editor-foot">
          {!empty ? (
            <Button
              size="sm"
              variant="ghost"
              className="router-editor-send"
              disabled={sending}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => void draft.submit()}
            >
              {sending ? <LoaderIcon size={15} className="animate-spin" /> : null}
              {t(addressed ? 'router.sendWorker' : 'router.send')}
              <kbd>⌘ ↵</kbd>
            </Button>
          ) : null}
        </div>
      </div>
    </ThreadRow>
  )
}
