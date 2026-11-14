import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  BoardIcon,
  CardsIcon,
  CheckIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BoardMenu, BoardTitle } from './BoardCanvas'
import { NEW_CARD } from './CardEditor'
import { useCardsStore } from './store'

/** A menu row with a leading check, so picked and unpicked rows line up. */
function CheckRow({
  checked,
  label,
  count,
  onSelect
}: {
  checked: boolean
  label: string
  count?: number
  onSelect: () => void
}) {
  return (
    <MenuItem onSelect={onSelect}>
      <CheckIcon size={14} className={checked ? undefined : 'invisible'} />
      <span className="flex-1 truncate">{label}</span>
      {count === undefined ? null : <small className="cards-menu-count">{count}</small>}
    </MenuItem>
  )
}

/** Filters the list by one of the user's tags. */
function TagMenu() {
  const { t } = useTranslation()
  const cards = useCardsStore((s) => s.cards)
  const tag = useCardsStore((s) => s.filter.tag)
  const setFilter = useCardsStore((s) => s.setFilter)
  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const card of cards) for (const t of card.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts].sort(([a], [b]) => a.localeCompare(b))
  }, [cards])
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton
          size="sm"
          label={t('cards.tags')}
          tooltip={t('cards.tags')}
          tooltipSide="bottom"
          aria-pressed={tag !== null}
          icon={<TagIcon size={17} />}
        />
      </MenuTrigger>
      <MenuContent align="end" className="cards-menu">
        <CheckRow
          checked={tag === null}
          label={t('cards.allTags')}
          count={cards.length}
          onSelect={() => setFilter({ tag: null })}
        />
        {tags.length ? <MenuSeparator /> : null}
        {tags.map(([name, count]) => (
          <CheckRow
            key={name}
            checked={tag === name}
            label={`#${name}`}
            count={count}
            onSelect={() => setFilter({ tag: name })}
          />
        ))}
        {tags.length ? null : <MenuLabel>{t('cards.noTags')}</MenuLabel>}
      </MenuContent>
    </Menu>
  )
}

/** Switches between the card list and the boards, and makes a new board. */
function BoardsMenu() {
  const { t } = useTranslation()
  const boards = useCardsStore((s) => s.boards)
  const boardId = useCardsStore((s) => s.boardId)
  const total = useCardsStore((s) => s.cards.length)
  const { showBoard, saveBoard } = useCardsStore()
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton
          size="sm"
          label={t('cards.boards')}
          tooltip={t('cards.boards')}
          tooltipSide="bottom"
          aria-pressed={boardId !== null}
          icon={<BoardIcon size={17} />}
        />
      </MenuTrigger>
      <MenuContent align="end" className="cards-menu">
        <MenuItem onSelect={() => showBoard(null)}>
          <CardsIcon size={14} />
          <span className="flex-1 truncate">{t('cards.list')}</span>
          <small className="cards-menu-count">{total}</small>
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>{t('cards.boards')}</MenuLabel>
        {boards.map((board) => (
          <CheckRow
            key={board.id}
            checked={board.id === boardId}
            label={board.name}
            count={board.placements.length}
            onSelect={() => showBoard(board.id)}
          />
        ))}
        <MenuItem
          onSelect={async () => {
            const board = await saveBoard({
              action: 'add',
              name: t('cards.untitledBoard', { count: boards.length + 1 }),
              projectId: null
            })
            if (board) showBoard(board.id)
          }}
        >
          <PlusIcon size={14} />
          {t('cards.newBoard')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

/** An icon until it is used; it stays open while it holds a query. */
function SearchField() {
  const { t } = useTranslation()
  const query = useCardsStore((s) => s.filter.query)
  const setFilter = useCardsStore((s) => s.setFilter)
  const [open, setOpen] = useState(false)
  if (!open && !query)
    return (
      <IconButton
        size="sm"
        label={t('cards.search')}
        tooltip={t('cards.search')}
        tooltipSide="bottom"
        icon={<SearchIcon size={17} />}
        onClick={() => setOpen(true)}
      />
    )
  return (
    <label className="cards-search">
      <SearchIcon size={15} />
      <input
        type="search"
        value={query}
        aria-label={t('cards.search')}
        placeholder={t('cards.search')}
        // biome-ignore lint/a11y/noAutofocus: the field appears because the user asked to search.
        autoFocus
        onChange={(event) => setFilter({ query: event.target.value })}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          setFilter({ query: '' })
          event.currentTarget.blur()
        }}
      />
      {query ? (
        <button
          type="button"
          aria-label={t('cards.clearSearch')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setFilter({ query: '' })}
        >
          <XIcon size={13} />
        </button>
      ) : null}
    </label>
  )
}

/**
 * The Cards page's only chrome: where you are on the left, and icons on the
 * right whose menus hold the tag filter and the boards.
 */
export function CardsBar() {
  const { t } = useTranslation()
  const tag = useCardsStore((s) => s.filter.tag)
  const selected = useCardsStore((s) => s.selected)
  const board = useCardsStore((s) => s.boards.find((b) => b.id === s.boardId))
  const { setFilter, openCard, setSelected, chooseTarget, showBoard } = useCardsStore()
  return (
    <header className="cards-hud">
      <nav className="cards-crumbs" aria-label={t('cards.title')}>
        {board || tag ? (
          <button
            type="button"
            onClick={() => {
              showBoard(null)
              setFilter({ tag: null })
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
        ) : tag ? (
          <>
            <span aria-hidden>/</span>
            <strong>#{tag}</strong>
          </>
        ) : null}
      </nav>
      <span className="cards-hud-space" />
      {!board && selected.length ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            {t('cards.clearSelection')}
          </Button>
          <Button size="sm" onClick={() => chooseTarget(true)}>
            {t('cards.sendSelected', { count: selected.length })}
          </Button>
        </>
      ) : null}
      <div className="cards-hud-icons">
        {board ? null : <SearchField />}
        {board ? null : <TagMenu />}
        <BoardsMenu />
        {board ? null : (
          <IconButton
            size="sm"
            label={t('cards.new')}
            tooltip={t('cards.new')}
            tooltipSide="bottom"
            icon={<PlusIcon size={17} />}
            onClick={() => openCard(NEW_CARD)}
          />
        )}
      </div>
    </header>
  )
}
