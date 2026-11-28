import {
  CheckIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  TrashIcon
} from '@renderer/components/ui/icons'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger
} from '@renderer/components/ui/menu'
import { type MouseEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Card } from '../../../shared/cards'
import { CardBody } from './CardBody'
import { useCardsStore } from './store'

type Point = { x: number; y: number }

/** Where a card came from, in a few words. */
export function useSourceLabel(card: Card): string {
  const { t } = useTranslation()
  if (!card.source) return t('cards.sourceManual')
  const title = card.source.threadTitle ?? t('thread.untitled')
  return t(card.source.kind === 'worker' ? 'cards.sourceWorker' : 'cards.sourceMessage', { title })
}

/**
 * A tile's right-click menu: open, pick, show in Finder, and delete. It opens where
 * the pointer is, or under the tile when the menu key or Shift-F10 opened it.
 */
function CardTileMenu({
  card,
  selected,
  point,
  tile,
  onToggle,
  onOpen,
  onClose
}: {
  card: Card
  selected: boolean
  point: Point | null
  /** The tile's open button, which gets focus back after a keyboard close. */
  tile: { current: HTMLElement | null }
  onToggle: () => void
  onOpen: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const askDelete = useCardsStore((s) => s.askDelete)
  const reveal = useCardsStore((s) => s.reveal)
  const pointer = useRef(false)
  return (
    <Menu open={point !== null} onOpenChange={(open) => (open ? null : onClose())} modal={false}>
      <MenuTrigger asChild>
        <span
          aria-hidden
          className="card-menu-anchor"
          style={point ? { left: point.x, top: point.y } : undefined}
        />
      </MenuTrigger>
      <MenuContent
        align="start"
        side="bottom"
        sideOffset={2}
        className="min-w-[168px]"
        aria-label={t('cards.tileMenu', { title: card.title })}
        onPointerDown={() => {
          pointer.current = true
        }}
        onKeyDown={() => {
          pointer.current = false
        }}
        onCloseAutoFocus={(event) => {
          // The anchor can't hold focus: a keyboard close hands it back to the tile, a pointer
          // choice leaves it alone, and the delete dialog takes it for itself.
          event.preventDefault()
          if (!pointer.current) tile.current?.focus({ preventScroll: true })
          pointer.current = false
        }}
      >
        <MenuItem onSelect={onOpen}>
          <ExternalLinkIcon size={14} />
          {t('cards.openNote')}
        </MenuItem>
        <MenuItem onSelect={onToggle}>
          <CheckIcon size={14} />
          {t(selected ? 'cards.unpickNote' : 'cards.pickNote')}
        </MenuItem>
        <MenuItem onSelect={() => void reveal(card.id)}>
          <FolderOpenIcon size={14} />
          {t('cards.reveal')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          className="text-destructive"
          onSelect={() => {
            pointer.current = true
            askDelete([card.id])
          }}
        >
          <TrashIcon size={14} />
          {t('cards.delete')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

/**
 * One card in the list: its title and body, nothing else. The whole tile opens
 * the card; the check, shown on hover or once picked, picks it for sending.
 * Right-click opens its menu, which also holds delete.
 */
export function CardTile({
  card,
  selected,
  open,
  onToggle,
  onOpen
}: {
  card: Card
  selected: boolean
  open: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const [point, setPoint] = useState<Point | null>(null)
  const openButton = useRef<HTMLButtonElement>(null)
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    const fromKeyboard = event.button !== 2 && event.clientX === 0 && event.clientY === 0
    if (!fromKeyboard) return setPoint({ x: event.clientX, y: event.clientY })
    const box = event.currentTarget.getBoundingClientRect()
    setPoint({ x: box.left + 8, y: box.bottom })
  }
  return (
    <article
      className="card-tile"
      aria-current={open || undefined}
      data-selected={selected || undefined}
      data-menu-open={point ? true : undefined}
    >
      <h4>{card.title}</h4>
      {card.body ? <CardBody body={card.body} /> : null}
      <button
        ref={openButton}
        type="button"
        className="card-tile-open"
        aria-label={t('cards.openCard', { title: card.title })}
        aria-haspopup="menu"
        aria-expanded={point !== null}
        onClick={onOpen}
        onContextMenu={onContextMenu}
      />
      <button
        type="button"
        aria-pressed={selected}
        className="card-tile-check"
        aria-label={t('cards.pick', { title: card.title })}
        onClick={onToggle}
      >
        {selected ? <CheckIcon size={12} /> : null}
      </button>
      <CardTileMenu
        card={card}
        selected={selected}
        point={point}
        tile={openButton}
        onToggle={onToggle}
        onOpen={onOpen}
        onClose={() => setPoint(null)}
      />
    </article>
  )
}
