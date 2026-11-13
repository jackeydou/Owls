import { IconButton } from '@renderer/components/ui/icon-button'
import {
  BoardIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  TrashIcon,
  XIcon
} from '@renderer/components/ui/icons'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger
} from '@renderer/components/ui/menu'
import { Select } from '@renderer/components/ui/select'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CARD_BODY_LIMIT, CARD_TITLE_LIMIT, type Card, type CardSave } from '../../../shared/cards'
import { useAppStore } from '../app/store'
import { useRouterStore } from '../router/store'
import { nextSlot } from './board'
import { CardBody } from './CardBody'
import { useSourceLabel } from './CardTile'
import { useCardsStore } from './store'

/** The editor's id for a card that is not saved yet. */
export const NEW_CARD = 'new'
/** Typing pauses this long before the card saves itself. */
const AUTOSAVE_DELAY = 700

/** Tags typed as one line, split on commas or spaces. */
export const parseTags = (text: string) =>
  text
    .split(/[,，\s]+/)
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter(Boolean)

type Fields = { title: string; body: string; tags: string[]; projectId: string | null }

const sameFields = (a: Fields, b: Fields) =>
  a.title === b.title &&
  a.body === b.body &&
  a.projectId === b.projectId &&
  a.tags.join(',') === b.tags.join(',')

/**
 * Saves the card a moment after each change, and once more on close. Saves run
 * one at a time, so a new card is added once and later edits update it.
 */
function useAutosave(cardId: string, fields: Fields, onCreated: (card: Card) => void) {
  const save = useCardsStore((s) => s.save)
  const id = useRef(cardId === NEW_CARD ? null : cardId)
  const saved = useRef<Fields | null>(null)
  const latest = useRef(fields)
  latest.current = fields
  const running = useRef<Promise<void> | null>(null)
  const flush = useRef(async () => {})
  flush.current = async () => {
    while (running.current) await running.current
    const next = latest.current
    if (!next.title.trim() || (saved.current && sameFields(saved.current, next))) return
    const input: CardSave = id.current
      ? { action: 'update', id: id.current, ...next }
      : { action: 'add', ...next }
    running.current = save(input).then((card) => {
      if (!card) return
      saved.current = next
      if (!id.current) {
        id.current = card.id
        onCreated(card)
      }
    })
    await running.current
    running.current = null
  }
  // The card as it opened counts as saved, so opening one writes nothing.
  const opened = useRef(false)
  if (!opened.current) {
    opened.current = true
    if (cardId !== NEW_CARD) saved.current = fields
  }
  const changed = JSON.stringify(fields)
  useEffect(() => {
    if (!changed) return
    const timer = setTimeout(() => void flush.current(), AUTOSAVE_DELAY)
    return () => clearTimeout(timer)
  }, [changed])
  useEffect(() => () => void flush.current(), [])
}

/** Source, boards, and delete: everything the editor needs now and then. */
function CardMenu({ card }: { card: Card }) {
  const { t } = useTranslation()
  const source = card.source
  const sourceLabel = useSourceLabel(card)
  const showThread = useAppStore((s) => s.showThread)
  const showPanel = useRouterStore((s) => s.showPanel)
  const sourceLive = useRouterStore((s) =>
    Boolean(source && s.routers.some((r) => r.id === source.threadId))
  )
  const boards = useCardsStore((s) => s.boards)
  const { place, remove } = useCardsStore()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const free = boards.filter((board) => !board.placements.some((p) => p.cardId === card.id))
  return (
    <Menu onOpenChange={(open) => open || setConfirmDelete(false)}>
      <MenuTrigger asChild>
        <IconButton
          size="sm"
          label={t('cards.more')}
          tooltip={t('cards.more')}
          icon={<EllipsisIcon size={16} />}
        />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel className="card-menu-source">{sourceLabel}</MenuLabel>
        {source && sourceLive ? (
          <MenuItem
            onSelect={() => {
              showThread(source.threadId)
              if (source.workerId) showPanel({ kind: 'worker', workerId: source.workerId })
            }}
          >
            <ExternalLinkIcon size={14} />
            {t('cards.openSource')}
          </MenuItem>
        ) : null}
        {free.length ? (
          <>
            <MenuSeparator />
            <MenuLabel>{t('cards.addToBoard')}</MenuLabel>
            {free.map((board) => (
              <MenuItem
                key={board.id}
                onSelect={() =>
                  void place(board.id, [
                    ...board.placements,
                    {
                      cardId: card.id,
                      ...nextSlot(board.placements, useCardsStore.getState().cards)
                    }
                  ])
                }
              >
                <BoardIcon size={14} />
                <span className="truncate">{board.name}</span>
              </MenuItem>
            ))}
          </>
        ) : null}
        <MenuSeparator />
        <MenuItem
          className="text-destructive"
          onSelect={(event) => {
            if (confirmDelete) return void remove(card.id)
            event.preventDefault()
            setConfirmDelete(true)
          }}
        >
          <TrashIcon size={14} />
          {t(confirmDelete ? 'cards.confirmDelete' : 'cards.delete')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

/**
 * The open card, in the right-hand panel: a title and a body, edited in place
 * and saved as you type. Project and tags sit on one quiet line under the title.
 */
export function CardEditor({ cardId }: { cardId: string }) {
  const { t } = useTranslation()
  const card = useCardsStore((s) => s.cards.find((c) => c.id === cardId))
  const filter = useCardsStore((s) => s.filter)
  const boardId = useCardsStore((s) => s.boardId)
  const { openCard, adoptCard, place } = useCardsStore()
  const projects = useAppStore((s) => s.projects)
  const creating = cardId === NEW_CARD
  const [title, setTitle] = useState(card?.title ?? '')
  const [body, setBody] = useState(card?.body ?? '')
  const [tags, setTags] = useState(
    card?.tags.join(' ') ?? (creating && filter.tag ? filter.tag : '')
  )
  const [projectId, setProjectId] = useState<string | null>(
    card?.projectId ??
      (creating && filter.project && filter.project !== 'none' ? filter.project : null)
  )
  const [editing, setEditing] = useState(creating || !card?.body)
  const bodyField = useRef<HTMLTextAreaElement>(null)
  useAutosave(cardId, { title, body, tags: parseTags(tags), projectId }, (created) => {
    adoptCard(created.id)
    // A card written on a board lands on that board.
    const board = useCardsStore.getState().boards.find((b) => b.id === boardId)
    if (board)
      void place(board.id, [
        ...board.placements,
        { cardId: created.id, ...nextSlot(board.placements, useCardsStore.getState().cards) }
      ])
  })
  if (!creating && !card) return null
  return (
    <aside className="card-editor" aria-label={t('cards.editor')}>
      <header>
        <span className="card-editor-space" />
        {card ? <CardMenu card={card} /> : null}
        <IconButton
          size="sm"
          label={t('cards.close')}
          tooltip={t('cards.close')}
          icon={<XIcon size={16} />}
          onClick={() => openCard(null)}
        />
      </header>
      <div className="card-editor-scroll">
        <textarea
          className="card-editor-title"
          rows={1}
          value={title}
          maxLength={CARD_TITLE_LIMIT}
          aria-label={t('cards.titleLabel')}
          placeholder={t('cards.titlePlaceholder')}
          // biome-ignore lint/a11y/noAutofocus: a new card starts with its title.
          autoFocus={creating}
          onChange={(event) => setTitle(event.target.value.replace(/\n/g, ' '))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            setEditing(true)
            requestAnimationFrame(() => bodyField.current?.focus())
          }}
        />
        <div className="card-editor-props">
          <Select
            aria-label={t('cards.project')}
            className="card-editor-project"
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
          <input
            className="card-editor-tags"
            value={tags}
            aria-label={t('cards.tagsLabel')}
            placeholder={t('cards.addTags')}
            onChange={(event) => setTags(event.target.value)}
          />
        </div>
        {editing ? (
          <textarea
            ref={bodyField}
            className="card-editor-body"
            value={body}
            maxLength={CARD_BODY_LIMIT}
            aria-label={t('cards.bodyLabel')}
            placeholder={t('cards.bodyPlaceholder')}
            onChange={(event) => setBody(event.target.value)}
            onBlur={() => body.trim() && setEditing(false)}
          />
        ) : (
          <div className="card-editor-read">
            <CardBody body={body} />
            <button
              type="button"
              aria-label={t('cards.editBody')}
              onClick={() => {
                setEditing(true)
                requestAnimationFrame(() => bodyField.current?.focus())
              }}
            />
          </div>
        )}
      </div>
    </aside>
  )
}
