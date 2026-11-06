import { Button } from '@renderer/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { CodexRouter } from '../../../shared/codex'
import { useCodexStore } from '../codex/store'
import { DraftTarget, MentionMenu, useRouterDraft } from './RouterComposer'
import { ThreadRow } from './ThreadRow'

const isCommandEnter = (event: KeyboardEvent) =>
  event.key === 'Enter' && (event.metaKey || event.ctrlKey)

/**
 * Where the user writes next: the thread's last line, not a box under it. Enter
 * is a new line, as in any editor; Command-Enter sends. With no project open,
 * sending asks for the folder first.
 */
export function ThreadEditor({
  projectId,
  router,
  note
}: {
  projectId: string | null
  router: CodexRouter | undefined
  note?: string
}) {
  const { t } = useTranslation()
  const chooseProject = useCodexStore((s) => s.pickProject)
  const draft = useRouterDraft({ projectId, router, isSendKey: isCommandEnter, chooseProject })
  const { text, sending, addressed, textareaProps } = draft
  return (
    <ThreadRow speaker="user">
      <div className="router-editor">
        {addressed ? <DraftTarget worker={addressed} onClear={draft.clearMention} /> : null}
        <textarea
          {...textareaProps}
          aria-label={t(addressed ? 'router.promptWorker' : 'router.prompt')}
          rows={1}
          // Read-only, not disabled: a disabled field drops focus and the caret with it.
          readOnly={sending}
        />
        <MentionMenu options={draft.options} highlight={draft.highlight} onPick={draft.pick} />
        <div className="router-editor-foot">
          {text.trim() ? (
            <Button
              size="sm"
              variant="ghost"
              className="router-editor-send"
              disabled={sending}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => void draft.submit()}
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : null}
              {t(addressed ? 'router.sendWorker' : 'router.send')}
              <kbd>⌘ ↵</kbd>
            </Button>
          ) : null}
          {note ? <span>{note}</span> : null}
        </div>
      </div>
    </ThreadRow>
  )
}
