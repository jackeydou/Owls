import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { LoaderIcon, PlusIcon, TrashIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CARD_TITLE_LIMIT } from '../../../shared/cards'
import { failureMessage } from '../app/failures'
import { useAppStore } from '../app/store'
import { byRecent, threadTitle, useThreadTitle } from '../router/activity'
import { useRouterStore } from '../router/store'
import { parseTags } from './CardEditor'
import { type Capturing, useCardsStore } from './store'

const NEW_THREAD = 'new'
const TARGET_LIMIT = 8
const PREVIEW_LIMIT = 600

/** Saves a thread message or worker result as a card. */
export function CaptureDialog() {
  const capturing = useCardsStore((s) => s.capturing)
  return capturing ? <CaptureForm capturing={capturing} /> : null
}
function CaptureForm({ capturing }: { capturing: Capturing }) {
  const { t } = useTranslation()
  const { capture, cancelCapture } = useCardsStore()
  const error = useCardsStore((s) => s.error)
  const projects = useAppStore((s) => s.projects)
  const [title, setTitle] = useState(capturing.title)
  const [tags, setTags] = useState('')
  const [projectId, setProjectId] = useState(capturing.projectId)
  const [saving, setSaving] = useState(false)
  const projectField = useId()
  async function submit() {
    if (!title.trim() || saving) return
    setSaving(true)
    await capture({ title, tags: parseTags(tags), projectId })
    setSaving(false)
  }
  const preview =
    capturing.preview.length > PREVIEW_LIMIT
      ? `${capturing.preview.slice(0, PREVIEW_LIMIT)}…`
      : capturing.preview
  return (
    <Dialog className="cards-dialog" aria-label={t('cards.captureTitle')} onClose={cancelCapture}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <h2>{t('cards.captureTitle')}</h2>
        <blockquote>{preview}</blockquote>
        <label>
          <span>{t('cards.titleLabel')}</span>
          <input
            value={title}
            maxLength={CARD_TITLE_LIMIT}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          <span>{t('cards.tagsLabel')}</span>
          <input
            value={tags}
            placeholder={t('cards.tagsPlaceholder')}
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
        <label htmlFor={projectField}>
          <span>{t('cards.project')}</span>
          <Select
            id={projectField}
            value={projectId ?? ''}
            onChange={(event) => setProjectId(event.target.value || null)}
          >
            <option value="">{t('cards.noProject')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </label>
        <p className="cards-dialog-note">{t('cards.captureNote')}</p>
        {error ? <p className="cards-dialog-error">{t('cards.captureFailed')}</p> : null}
        <footer>
          <Button type="button" size="sm" variant="ghost" onClick={cancelCapture}>
            {t('cards.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!title.trim() || saving}>
            {saving ? <LoaderIcon size={14} className="animate-spin" /> : null}
            {t('cards.save')}
          </Button>
        </footer>
      </form>
    </Dialog>
  )
}

/** Picks the thread the selected cards go to; its draft then starts with them. */
export function SendCardsDialog() {
  const choosing = useCardsStore((s) => s.choosingTarget)
  return choosing ? <SendCardsForm /> : null
}
function SendCardsForm() {
  const { t } = useTranslation()
  const count = useCardsStore((s) => s.selected.length)
  const { chooseTarget, takeSelected, setPending } = useCardsStore()
  const routers = useRouterStore((s) => s.routers)
  const projects = useAppStore((s) => s.projects)
  const routerProjectId = useAppStore((s) => s.routerProjectId)
  const { showThread, newThread } = useAppStore()
  const untitled = useThreadTitle()
  const [target, setTarget] = useState(NEW_THREAD)
  const [projectId, setProjectId] = useState<string | null>(routerProjectId)
  const threads = useMemo(
    () =>
      routers
        .filter((r) => r.itemCount && !r.archivedAt)
        .sort(byRecent)
        .slice(0, TARGET_LIMIT),
    [routers]
  )
  function submit() {
    setPending(takeSelected())
    if (target === NEW_THREAD) newThread(projectId ?? undefined)
    else showThread(target)
  }
  return (
    <Dialog
      className="cards-dialog router-forward"
      aria-label={t('cards.sendTitle', { count })}
      onClose={() => chooseTarget(false)}
    >
      <h2>{t('cards.sendTitle', { count })}</h2>
      <p className="cards-dialog-note">{t('cards.sendNote')}</p>
      <fieldset>
        <legend>{t('forward.to')}</legend>
        <label>
          <input
            type="radio"
            name="cards-target"
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
              name="cards-target"
              checked={target === thread.id}
              onChange={() => setTarget(thread.id)}
            />
            <span>{threadTitle(thread, untitled)}</span>
          </label>
        ))}
      </fieldset>
      <footer>
        <Button size="sm" variant="ghost" onClick={() => chooseTarget(false)}>
          {t('cards.cancel')}
        </Button>
        <Button size="sm" onClick={submit}>
          {t('cards.sendConfirm')}
        </Button>
      </footer>
    </Dialog>
  )
}

/** A system error code, such as EACCES, that main passes on when a note file cannot be deleted. */
const SYSTEM_CODE = /^E[A-Z]+$/

/** Asks before notes are deleted: their files go, and so do their places on boards. */
export function DeleteCardsDialog() {
  const deleting = useCardsStore((s) => s.deleting)
  return deleting ? <DeleteCardsForm cardIds={deleting} /> : null
}
function DeleteCardsForm({ cardIds }: { cardIds: string[] }) {
  const { t } = useTranslation()
  const allCards = useCardsStore((s) => s.cards)
  const error = useCardsStore((s) => s.error)
  const { remove, cancelDelete } = useCardsStore()
  const titleId = useId()
  const cards = useMemo(() => {
    const ids = new Set(cardIds)
    return allCards.filter((card) => ids.has(card.id))
  }, [allCards, cardIds])
  const count = cards.length
  const only = count === 1 ? cards[0] : undefined
  return (
    <Dialog className="cards-dialog" aria-labelledby={titleId} onClose={cancelDelete}>
      <h2 id={titleId}>
        {only
          ? t('cards.deleteTitleOne', { title: only.title })
          : t('cards.deleteTitle', { count })}
      </h2>
      <p className="cards-dialog-note">{t('cards.deleteBody', { count })}</p>
      {error ? (
        <p className="cards-dialog-error" role="alert">
          {error.code !== 'native_error'
            ? failureMessage(error)
            : SYSTEM_CODE.test(error.message ?? '')
              ? t('cards.deleteFailedCode', { code: error.message })
              : t('cards.deleteFailed')}
        </p>
      ) : null}
      <footer>
        <Button size="sm" variant="ghost" onClick={cancelDelete}>
          {t('cards.cancel')}
        </Button>
        <ActionButton
          size="sm"
          variant="destructive"
          disabled={!count}
          icon={<TrashIcon size={14} />}
          // Success closes the dialog and the notes leave the list; a failure stays here.
          onAction={async () => {
            if (!(await remove(cards.map((card) => card.id))))
              throw new Error('The notes were not deleted.')
          }}
        >
          {t('cards.deleteConfirm', { count })}
        </ActionButton>
      </footer>
    </Dialog>
  )
}
