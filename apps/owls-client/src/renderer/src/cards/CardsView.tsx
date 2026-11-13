import { ActionIconButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  BoardIcon,
  CardsIcon,
  LoaderIcon,
  PlusIcon,
  SearchIcon,
  XIcon
} from '@renderer/components/ui/icons'
import { type CSSProperties, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { failureMessage } from '../app/failures'
import { useAppStore } from '../app/store'
import { projectHue } from '../router/activity'
import { ProjectIcon } from '../router/ProjectIcon'
import { BoardCanvas, BoardMenu, BoardTitle } from './BoardCanvas'
import { CardEditor, NEW_CARD } from './CardEditor'
import { CardTile } from './CardTile'
import { useFilteredCards } from './filter'
import { type CardFilter, useCardsStore } from './store'
import './cards.css'

function NavEntry({
  current,
  onClick,
  icon,
  label,
  count,
  style
}: {
  current: boolean
  onClick: () => void
  icon?: React.ReactNode
  label: string
  count?: number
  style?: CSSProperties
}) {
  return (
    <button
      type="button"
      className="cards-nav-entry"
      aria-current={current || undefined}
      onClick={onClick}
      style={style}
    >
      {icon}
      <span>{label}</span>
      {count === undefined ? null : <small>{count}</small>}
    </button>
  )
}

/** Filters for the list, then the boards. */
function CardsNav() {
  const { t } = useTranslation()
  const cards = useCardsStore((s) => s.cards)
  const boards = useCardsStore((s) => s.boards)
  const filter = useCardsStore((s) => s.filter)
  const boardId = useCardsStore((s) => s.boardId)
  const { setFilter, showBoard, saveBoard } = useCardsStore()
  const projects = useAppStore((s) => s.projects)
  const tags = useMemo(
    () => [...new Set(cards.flatMap((card) => card.tags))].sort((a, b) => a.localeCompare(b)),
    [cards]
  )
  const listing = boardId === null
  const showList = (next: Partial<CardFilter>) => {
    showBoard(null)
    setFilter(next)
  }
  return (
    <nav className="cards-nav" aria-label={t('cards.nav')}>
      <section>
        <NavEntry
          current={listing && filter.project === null && filter.tag === null}
          onClick={() => showList({ project: null, tag: null })}
          icon={<CardsIcon size={16} />}
          label={t('cards.all')}
          count={cards.length}
        />
        <NavEntry
          current={listing && filter.project === 'none'}
          onClick={() => showList({ project: 'none', tag: null })}
          label={t('cards.noProject')}
          count={cards.filter((card) => card.projectId === null).length}
        />
        {projects.map((project) => (
          <NavEntry
            key={project.id}
            current={listing && filter.project === project.id}
            onClick={() => showList({ project: project.id, tag: null })}
            icon={<ProjectIcon project={project} />}
            label={project.name}
            count={cards.filter((card) => card.projectId === project.id).length}
            style={{ '--owl-c': projectHue(project.id, project.settings.color) } as CSSProperties}
          />
        ))}
      </section>
      {tags.length ? (
        <section aria-label={t('cards.tags')}>
          <h3>{t('cards.tags')}</h3>
          <div className="cards-nav-tags">
            {tags.map((tag) => (
              <button
                type="button"
                key={tag}
                aria-pressed={listing && filter.tag === tag}
                onClick={() => showList({ tag: filter.tag === tag ? null : tag })}
              >
                #{tag}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section aria-label={t('cards.boards')}>
        <header>
          <h3>{t('cards.boards')}</h3>
          <ActionIconButton
            size="sm"
            label={t('cards.newBoard')}
            tooltip={t('cards.newBoard')}
            icon={<PlusIcon size={14} />}
            onAction={async () => {
              const board = await saveBoard({
                action: 'add',
                name: t('cards.untitledBoard', { count: boards.length + 1 }),
                projectId:
                  typeof filter.project === 'string' && filter.project !== 'none'
                    ? filter.project
                    : null
              })
              if (board) showBoard(board.id)
            }}
          />
        </header>
        {boards.length ? (
          boards.map((board) => (
            <NavEntry
              key={board.id}
              current={boardId === board.id}
              onClick={() => showBoard(board.id)}
              icon={<BoardIcon size={16} />}
              label={board.name}
              count={board.placements.length}
            />
          ))
        ) : (
          <p>{t('cards.noBoards')}</p>
        )}
      </section>
    </nav>
  )
}

function CardList() {
  const { t } = useTranslation()
  const status = useCardsStore((s) => s.status)
  const total = useCardsStore((s) => s.cards.length)
  const cards = useFilteredCards()
  const selected = useCardsStore((s) => s.selected)
  const openCardId = useCardsStore((s) => s.openCardId)
  const { toggleSelected, openCard } = useCardsStore()
  if (status === 'loading' || status === 'idle')
    return (
      <p className="cards-empty">
        <LoaderIcon size={16} className="animate-spin" />
        {t('cards.loading')}
      </p>
    )
  if (!total) return <p className="cards-empty">{t('cards.emptyLibrary')}</p>
  if (!cards.length) return <p className="cards-empty">{t('cards.noMatch')}</p>
  return (
    <div className="cards-scroll">
      <ul className="cards-grid" aria-label={t('cards.list')}>
        {cards.map((card) => (
          <li key={card.id}>
            <CardTile
              card={card}
              selected={selected.includes(card.id)}
              open={openCardId === card.id}
              onToggle={() => toggleSelected(card.id)}
              onOpen={() => openCard(card.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What the list shows, in words: a project, a tag, or nothing past "Cards". */
function useFilterLabel(): string | null {
  const { t } = useTranslation()
  const filter = useCardsStore((s) => s.filter)
  const project = useAppStore((s) => s.projects.find((p) => p.id === filter.project))
  if (filter.tag) return `#${filter.tag}`
  if (filter.project === 'none') return t('cards.noProject')
  return project?.name ?? null
}

/** A breadcrumb, and only the actions the current view can take. */
function CardsHud() {
  const { t } = useTranslation()
  const filter = useCardsStore((s) => s.filter)
  const selected = useCardsStore((s) => s.selected)
  const board = useCardsStore((s) => s.boards.find((b) => b.id === s.boardId))
  const { setFilter, openCard, setSelected, chooseTarget, showBoard } = useCardsStore()
  const filterLabel = useFilterLabel()
  return (
    <header className="cards-hud">
      <nav className="cards-crumbs" aria-label={t('cards.title')}>
        {board || filterLabel ? (
          <button
            type="button"
            onClick={() => {
              showBoard(null)
              setFilter({ project: null, tag: null })
            }}
          >
            {t('cards.title')}
          </button>
        ) : (
          <strong>{t('cards.title')}</strong>
        )}
        {board ? (
          <>
            <span aria-hidden>/</span>
            <BoardTitle key={board.id} board={board} />
            <BoardMenu board={board} />
          </>
        ) : filterLabel ? (
          <>
            <span aria-hidden>/</span>
            <strong>{filterLabel}</strong>
          </>
        ) : null}
      </nav>
      <span className="cards-hud-space" />
      {board ? null : (
        <>
          <label className="cards-search">
            <SearchIcon size={15} />
            <input
              type="search"
              value={filter.query}
              aria-label={t('cards.search')}
              placeholder={t('cards.search')}
              onChange={(event) => setFilter({ query: event.target.value })}
            />
          </label>
          {selected.length ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                {t('cards.clearSelection')}
              </Button>
              <Button size="sm" onClick={() => chooseTarget(true)}>
                {t('cards.sendSelected', { count: selected.length })}
              </Button>
            </>
          ) : null}
          <IconButton
            size="sm"
            label={t('cards.new')}
            tooltip={t('cards.new')}
            tooltipSide="bottom"
            icon={<PlusIcon size={16} />}
            onClick={() => openCard(NEW_CARD)}
          />
        </>
      )}
    </header>
  )
}

function CardsError() {
  const { t } = useTranslation()
  const error = useCardsStore((s) => s.error)
  const clearError = useCardsStore((s) => s.clearError)
  if (!error) return null
  return (
    <div className="cards-error" role="alert">
      <span>{failureMessage(error)}</span>
      <IconButton
        size="sm"
        label={t('dismissError')}
        icon={<XIcon size={14} />}
        onClick={clearError}
      />
    </div>
  )
}

/** The knowledge library: filters and boards, the cards or a board, and the open card. */
export function CardsView() {
  const boardId = useCardsStore((s) => s.boardId)
  const openCardId = useCardsStore((s) => s.openCardId)
  const editorSession = useCardsStore((s) => s.editorSession)
  return (
    <main className="cards-view">
      <CardsNav />
      <section className="cards-main">
        <CardsHud />
        <CardsError />
        {boardId ? <BoardCanvas key={boardId} boardId={boardId} /> : <CardList />}
      </section>
      {openCardId ? <CardEditor key={editorSession} cardId={openCardId} /> : null}
    </main>
  )
}
