import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { PlusIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../app/store'
import { byRecent, threadTitle, useThreadTitle } from './activity'
import { type Forwarding, useRouterStore } from './store'

const NEW_THREAD = 'new'
/** Threads offered as targets; older ones are a click on the sidebar away. */
const TARGET_LIMIT = 8

/** Picks where content goes and what to do with it, then opens that thread. */
export function ForwardDialog() {
  const forwarding = useRouterStore((s) => s.forwarding)
  return forwarding ? <ForwardForm forwarding={forwarding} /> : null
}
function ForwardForm({ forwarding }: { forwarding: Forwarding }) {
  const { t } = useTranslation()
  const routers = useRouterStore((s) => s.routers)
  const { cancelForward, forward } = useRouterStore()
  const projects = useAppStore((s) => s.projects)
  const showThread = useAppStore((s) => s.showThread)
  const untitled = useThreadTitle()
  const [target, setTarget] = useState(NEW_THREAD)
  const [projectId, setProjectId] = useState(forwarding.projectId)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const threads = useMemo(
    () =>
      routers
        .filter((r) => r.itemCount && r.id !== forwarding.source.routerId)
        .sort(byRecent)
        .slice(0, TARGET_LIMIT),
    [routers, forwarding]
  )
  async function submit() {
    setSending(true)
    const destination = await forward(
      target === NEW_THREAD ? { kind: 'new', projectId } : { kind: 'thread', routerId: target },
      note
    )
    setSending(false)
    if (destination) showThread(destination.id)
  }
  return (
    <Dialog className="router-forward" aria-label={t('forward.title')} onClose={cancelForward}>
      <h2>{t('forward.title')}</h2>
      <blockquote>{forwarding.preview}</blockquote>
      <fieldset>
        <legend>{t('forward.to')}</legend>
        <label>
          <input
            type="radio"
            name="forward-target"
            checked={target === NEW_THREAD}
            onChange={() => setTarget(NEW_THREAD)}
          />
          <PlusIcon size={15} aria-hidden />
          <span>{t('thread.new')}</span>
        </label>
        {target === NEW_THREAD && projects.length ? (
          <Select
            aria-label={t('thread.project')}
            value={projectId ?? ''}
            onChange={(event) => setProjectId(event.target.value || null)}
          >
            <option value="">{t('thread.noProject')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        ) : null}
        {threads.map((thread) => (
          <label key={thread.id}>
            <input
              type="radio"
              name="forward-target"
              checked={target === thread.id}
              onChange={() => setTarget(thread.id)}
            />
            <span>{threadTitle(thread, untitled)}</span>
          </label>
        ))}
      </fieldset>
      <textarea
        aria-label={t('forward.note')}
        placeholder={t('forward.notePlaceholder')}
        rows={3}
        maxLength={8000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <footer>
        <Button size="sm" variant="ghost" onClick={cancelForward}>
          {t('forward.cancel')}
        </Button>
        <Button size="sm" pending={sending} onClick={() => void submit()}>
          {t('forward.send')}
        </Button>
      </footer>
    </Dialog>
  )
}
