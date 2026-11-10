import { Button } from '@renderer/components/ui/button'
import { LoaderIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
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
 * is a new line, as in any editor; Command-Enter sends. A new thread picks its
 * default project here, and with no projects at all, sending asks for a folder.
 */
export function ThreadEditor({ router }: { router: CodexRouter | undefined }) {
  const { t } = useTranslation()
  const projects = useCodexStore((s) => s.projects)
  const projectId = useCodexStore((s) => s.routerProjectId)
  const focusProject = useCodexStore((s) => s.focusProject)
  const pickProject = useCodexStore((s) => s.pickProject)
  const showThread = useCodexStore((s) => s.showThread)
  const draft = useRouterDraft({
    projectId,
    router,
    isSendKey: isCommandEnter,
    chooseProject: projects.length ? undefined : pickProject,
    onThread: showThread
  })
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
          {!router && projects.length ? (
            <Select
              className="router-editor-project"
              aria-label={t('thread.project')}
              value={projectId ?? ''}
              onChange={(event) => focusProject(event.target.value || null)}
            >
              <option value="">{t('thread.noProject')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          ) : null}
          {text.trim() ? (
            <Button
              size="sm"
              variant="ghost"
              className="router-editor-send"
              disabled={sending}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => void draft.submit()}
            >
              {sending ? <LoaderIcon size={13} className="animate-spin" /> : null}
              {t(addressed ? 'router.sendWorker' : 'router.send')}
              <kbd>⌘ ↵</kbd>
            </Button>
          ) : null}
        </div>
      </div>
    </ThreadRow>
  )
}
