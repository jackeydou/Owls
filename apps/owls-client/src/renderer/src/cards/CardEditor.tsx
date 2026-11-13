import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { ExternalLinkIcon, TrashIcon, XIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { code } from '@streamdown/code'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'
import { CARD_BODY_LIMIT, CARD_TITLE_LIMIT, type Card } from '../../../shared/cards'
import { useAppStore } from '../app/store'
import { useRouterStore } from '../router/store'
import { nextSlot } from './board'
import { useSourceLabel } from './CardTile'
import { useCardsStore } from './store'

/** The editor's id for a card that is not saved yet. */
export const NEW_CARD = 'new'
const plugins = { code }

/** Tags typed as one line, split on commas or spaces. */
export const parseTags = (text: string) =>
  text
    .split(/[,，\s]+/)
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter(Boolean)

function SourceLink({ card }: { card: Card }) {
  const { t } = useTranslation()
  const label = useSourceLabel(card)
  const showThread = useAppStore((s) => s.showThread)
  const showPanel = useRouterStore((s) => s.showPanel)
  const source = card.source
  const exists = useRouterStore((s) =>
    Boolean(source && s.routers.some((r) => r.id === source.threadId))
  )
  if (!source) return <p className="card-editor-source">{label}</p>
  return (
    <p className="card-editor-source">
      <span>{label}</span>
      {exists ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            showThread(source.threadId)
            if (source.workerId) showPanel({ kind: 'worker', workerId: source.workerId })
          }}
        >
          <ExternalLinkIcon size={13} />
          {t('cards.openSource')}
        </Button>
      ) : null}
    </p>
  )
}

/** Puts the card on a board that does not hold it yet. */
function AddToBoard({ card }: { card: Card }) {
  const { t } = useTranslation()
  const boards = useCardsStore((s) => s.boards)
  const place = useCardsStore((s) => s.place)
  const free = boards.filter((board) => !board.placements.some((p) => p.cardId === card.id))
  const on = boards.length - free.length
  if (!boards.length) return null
  return (
    <div className="card-editor-boards">
      <span>{on ? t('cards.onBoards', { count: on }) : t('cards.onNoBoard')}</span>
      {free.length ? (
        <Select
          aria-label={t('cards.addToBoard')}
          value=""
          onChange={(event) => {
            const board = free.find((b) => b.id === event.target.value)
            if (!board) return
            void place(board.id, [
              ...board.placements,
              { cardId: card.id, ...nextSlot(board.placements) }
            ])
          }}
        >
          <option value="">{t('cards.addToBoard')}</option>
          {free.map((board) => (
            <option key={board.id} value={board.id}>
              {board.name}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  )
}

/** The open card, in the right-hand panel. A new card is saved on the first save. */
export function CardEditor({ cardId }: { cardId: string }) {
  const { t } = useTranslation()
  const card = useCardsStore((s) => s.cards.find((c) => c.id === cardId))
  const filter = useCardsStore((s) => s.filter)
  const { save, remove, openCard } = useCardsStore()
  const projects = useAppStore((s) => s.projects)
  const creating = cardId === NEW_CARD
  const initialProject =
    card?.projectId ??
    (creating && filter.project && filter.project !== 'none' ? filter.project : null)
  const [title, setTitle] = useState(card?.title ?? '')
  const [body, setBody] = useState(card?.body ?? '')
  const [tags, setTags] = useState(
    card?.tags.join(', ') ?? (creating && filter.tag ? filter.tag : '')
  )
  const [projectId, setProjectId] = useState<string | null>(initialProject)
  const projectField = useId()
  const [editing, setEditing] = useState(creating || !card?.body)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!creating && !card) return null
  const parsed = parseTags(tags)
  const dirty =
    creating ||
    title !== card?.title ||
    body !== card?.body ||
    parsed.join(',') !== card?.tags.join(',') ||
    projectId !== card?.projectId
  async function submit() {
    if (!title.trim() || saving) return
    setSaving(true)
    const fields = { title, body, tags: parsed, projectId }
    const saved = await save(
      creating || !card
        ? { action: 'add', ...fields }
        : { action: 'update', id: card.id, ...fields }
    )
    setSaving(false)
    if (saved && creating) openCard(saved.id)
    if (saved) setEditing(false)
  }
  return (
    <aside className="card-editor" aria-label={t('cards.editor')}>
      <header>
        <input
          className="card-editor-title"
          value={title}
          maxLength={CARD_TITLE_LIMIT}
          aria-label={t('cards.titleLabel')}
          placeholder={t('cards.titlePlaceholder')}
          onChange={(event) => setTitle(event.target.value)}
        />
        {card ? (
          <IconButton
            size="sm"
            label={t(confirmDelete ? 'cards.confirmDelete' : 'cards.delete')}
            tooltip={t(confirmDelete ? 'cards.confirmDelete' : 'cards.delete')}
            className={confirmDelete ? 'text-destructive' : undefined}
            icon={<TrashIcon size={15} />}
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true)
              void remove(card.id)
            }}
            onBlur={() => setConfirmDelete(false)}
          />
        ) : null}
        <IconButton
          size="sm"
          label={t('cards.close')}
          tooltip={t('cards.close')}
          icon={<XIcon size={16} />}
          onClick={() => openCard(null)}
        />
      </header>
      <div className="card-editor-fields">
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
        <label>
          <span>{t('cards.tagsLabel')}</span>
          <input
            value={tags}
            placeholder={t('cards.tagsPlaceholder')}
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
      </div>
      <div className="card-editor-mode" role="tablist" aria-label={t('cards.bodyMode')}>
        <button type="button" role="tab" aria-selected={!editing} onClick={() => setEditing(false)}>
          {t('cards.preview')}
        </button>
        <button type="button" role="tab" aria-selected={editing} onClick={() => setEditing(true)}>
          {t('cards.edit')}
        </button>
      </div>
      <div className="card-editor-body">
        {editing ? (
          <textarea
            value={body}
            maxLength={CARD_BODY_LIMIT}
            aria-label={t('cards.bodyLabel')}
            placeholder={t('cards.bodyPlaceholder')}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void submit()
              }
            }}
          />
        ) : body ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: a double-click shortcut; the Edit tab is the accessible way in.
          <div className="owls-markdown" onDoubleClick={() => setEditing(true)}>
            <Streamdown plugins={plugins} controls={false}>
              {body}
            </Streamdown>
          </div>
        ) : (
          <p className="card-editor-empty">{t('cards.emptyBody')}</p>
        )}
      </div>
      <footer>
        {card ? <SourceLink card={card} /> : null}
        {card ? <AddToBoard card={card} /> : null}
        <div className="card-editor-actions">
          <Button
            size="sm"
            disabled={!dirty || !title.trim() || saving}
            onClick={() => void submit()}
          >
            {t('cards.save')}
          </Button>
        </div>
      </footer>
    </aside>
  )
}
