import { IconButton } from '@renderer/components/ui/icon-button'
import {
  CardPlusIcon,
  CheckIcon,
  EllipsisIcon,
  PencilIcon,
  PlusIcon,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import type { Board, BoardPlacement, Card } from '../../../shared/cards'
import { useAppStore } from '../app/store'
import { RouterComposer } from '../router/RouterComposer'
import { BOARD_CARD_WIDTH, nextSlot } from './board'
import { CardBody } from './CardBody'
import { NEW_CARD } from './CardEditor'
import { useFilteredCards } from './filter'
import { useCardsStore } from './store'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 1.75
const CARD_DRAG = 'application/x-owlto-card'
/** Pointer travel, in screen pixels, before a press on a card counts as a drag. */
const DRAG_SLOP = 4
const FIT_MARGIN = 64
const CARD_HEIGHT_GUESS = 240
/** Room for the floating tool rail on the left. */
const RAIL_INSET = 56

type View = { k: number; x: number; y: number }

/**
 * Pans and zooms the board by writing `transform` directly, so moving the canvas
 * never re-renders a card. The view is not saved; a board opens fitted.
 */
function useBoardCamera(
  stage: React.RefObject<HTMLDivElement | null>,
  world: React.RefObject<HTMLDivElement | null>,
  zoomLabel: React.RefObject<HTMLSpanElement | null>
) {
  const view = useRef<View>({ k: 1, x: 48, y: 48 })
  const apply = useCallback(() => {
    const { k, x, y } = view.current
    if (world.current) world.current.style.transform = `translate(${x}px, ${y}px) scale(${k})`
    if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(k * 100)}%`
  }, [world, zoomLabel])
  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      const { k: from, x, y } = view.current
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, from * factor))
      view.current = { k, x: cx - ((cx - x) / from) * k, y: cy - ((cy - y) / from) * k }
      apply()
    },
    [apply]
  )
  const fit = useCallback(
    (placements: BoardPlacement[]) => {
      const box = stage.current?.getBoundingClientRect()
      if (!box?.width) return
      if (!placements.length) {
        view.current = { k: 1, x: FIT_MARGIN, y: FIT_MARGIN }
        return apply()
      }
      const x0 = Math.min(...placements.map((p) => p.x))
      const y0 = Math.min(...placements.map((p) => p.y))
      const x1 = Math.max(...placements.map((p) => p.x + BOARD_CARD_WIDTH))
      // Cards are as tall as their text, so measure the ones on screen.
      const height = (id: string) =>
        world.current?.querySelector<HTMLElement>(`[data-card="${id}"]`)?.offsetHeight ??
        CARD_HEIGHT_GUESS
      const y1 = Math.max(...placements.map((p) => p.y + height(p.cardId)))
      const width = box.width - RAIL_INSET
      const k = Math.max(
        MIN_ZOOM,
        Math.min(1, (width - FIT_MARGIN * 2) / (x1 - x0), (box.height - FIT_MARGIN * 2) / (y1 - y0))
      )
      view.current = {
        k,
        x: RAIL_INSET + width / 2 - ((x0 + x1) / 2) * k,
        y: box.height / 2 - ((y0 + y1) / 2) * k
      }
      apply()
    },
    [apply, stage, world]
  )
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const box = el.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey)
        zoomAt(event.clientX - box.left, event.clientY - box.top, Math.exp(-event.deltaY * 0.01))
      else {
        view.current.x -= event.deltaX
        view.current.y -= event.deltaY
        apply()
      }
    }
    let drag: { x: number; y: number } | null = null
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target as Element).closest('[data-card], button, input'))
        return
      drag = { x: event.clientX, y: event.clientY }
      el.setPointerCapture(event.pointerId)
      el.classList.add('dragging')
    }
    const move = (event: PointerEvent) => {
      if (!drag) return
      view.current.x += event.clientX - drag.x
      view.current.y += event.clientY - drag.y
      drag = { x: event.clientX, y: event.clientY }
      apply()
    }
    const up = () => {
      drag = null
      el.classList.remove('dragging')
    }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [apply, stage, zoomAt])
  return useMemo(
    () => ({
      fit,
      zoomBy(factor: number) {
        const box = stage.current?.getBoundingClientRect()
        if (box) zoomAt(box.width / 2, box.height / 2, factor)
      },
      /** A screen point as board coordinates. */
      toBoard(clientX: number, clientY: number) {
        const box = stage.current?.getBoundingClientRect()
        const { k, x, y } = view.current
        return box
          ? { x: (clientX - box.left - x) / k, y: (clientY - box.top - y) / k }
          : { x: 0, y: 0 }
      },
      scale: () => view.current.k
    }),
    [fit, stage, zoomAt]
  )
}

function BoardCard({
  card,
  placement,
  selected,
  onPress,
  onOpen,
  onRemove
}: {
  card: Card
  placement: BoardPlacement
  selected: boolean
  onPress: (event: ReactPointerEvent<HTMLElement>) => void
  onOpen: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <article
      className="board-card"
      data-card={card.id}
      data-selected={selected || undefined}
      style={{
        transform: `translate(${placement.x}px, ${placement.y}px)`,
        width: BOARD_CARD_WIDTH
      }}
      onPointerDown={onPress}
      onDoubleClick={onOpen}
    >
      <h4>{card.title}</h4>
      {card.body ? <CardBody body={card.body} /> : null}
      <div className="board-card-actions">
        <IconButton
          size="sm"
          label={t('cards.openCard', { title: card.title })}
          icon={<PencilIcon size={13} />}
          onClick={onOpen}
        />
        <IconButton
          size="sm"
          label={t('cards.removeFromBoard', { title: card.title })}
          icon={<XIcon size={13} />}
          onClick={onRemove}
        />
      </div>
    </article>
  )
}

/** Cards the board does not hold yet, to drag on or add with a click. */
function BoardTray({
  board,
  onAdd,
  onClose
}: {
  board: Board
  onAdd: (cardId: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const cards = useFilteredCards()
  const free = cards.filter((card) => !board.placements.some((p) => p.cardId === card.id))
  return (
    <aside className="board-tray" aria-label={t('cards.tray')}>
      <header>
        <h3>{t('cards.addCards')}</h3>
        <IconButton
          size="sm"
          label={t('cards.close')}
          icon={<XIcon size={14} />}
          onClick={onClose}
        />
      </header>
      {free.length ? (
        <ul>
          {free.map((card) => (
            <li
              key={card.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(CARD_DRAG, card.id)
                event.dataTransfer.effectAllowed = 'copy'
              }}
            >
              <span>{card.title}</span>
              <IconButton
                size="sm"
                label={t('cards.addCardToBoard', { title: card.title })}
                icon={<PlusIcon size={13} />}
                onClick={() => onAdd(card.id)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p>{t('cards.trayEmpty')}</p>
      )}
    </aside>
  )
}

/** The board's name in the header, renamed in place. */
export function BoardTitle({ board }: { board: Board }) {
  const { t } = useTranslation()
  const saveBoard = useCardsStore((s) => s.saveBoard)
  const [name, setName] = useState(board.name)
  useEffect(() => setName(board.name), [board.name])
  const rename = () => {
    const next = name.trim()
    if (!next) return setName(board.name)
    if (next !== board.name)
      void saveBoard({ action: 'rename', id: board.id, name: next, projectId: board.projectId })
  }
  return (
    <input
      className="board-title"
      value={name}
      aria-label={t('cards.boardName')}
      onChange={(event) => setName(event.target.value)}
      onBlur={rename}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
      }}
    />
  )
}

/** The board's project and delete, kept out of sight until asked for. */
export function BoardMenu({ board }: { board: Board }) {
  const { t } = useTranslation()
  const { saveBoard, removeBoard } = useCardsStore()
  const projects = useAppStore((s) => s.projects)
  const [confirm, setConfirm] = useState(false)
  const setProject = (projectId: string | null) =>
    void saveBoard({ action: 'rename', id: board.id, name: board.name, projectId })
  return (
    <Menu onOpenChange={(open) => open || setConfirm(false)}>
      <MenuTrigger asChild>
        <IconButton
          size="sm"
          label={t('cards.boardMenu')}
          tooltip={t('cards.boardMenu')}
          icon={<EllipsisIcon size={16} />}
        />
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>{t('cards.boardProject')}</MenuLabel>
        {[{ id: null, name: t('cards.noProject') }, ...projects].map((project) => (
          <MenuItem key={project.id ?? 'none'} onSelect={() => setProject(project.id)}>
            <CheckIcon
              size={14}
              className={board.projectId === project.id ? undefined : 'invisible'}
            />
            <span className="truncate">{project.name}</span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem
          className="text-destructive"
          onSelect={(event) => {
            if (confirm) return void removeBoard(board.id)
            event.preventDefault()
            setConfirm(true)
          }}
        >
          <TrashIcon size={14} />
          {t(confirm ? 'cards.confirmDeleteBoard' : 'cards.deleteBoard')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

/**
 * A whiteboard: cards placed freely, dragged to move. A click picks a card and
 * the composer below sends the picked cards to a new thread with a message.
 */
export function BoardCanvas({ boardId }: { boardId: string }) {
  const { t } = useTranslation()
  const board = useCardsStore((s) => s.boards.find((b) => b.id === boardId))
  const cards = useCardsStore((s) => s.cards)
  const selected = useCardsStore((s) => s.selected)
  const { place, toggleSelected, setSelected, openCard } = useCardsStore()
  const routerProjectId = useAppStore((s) => s.routerProjectId)
  const firstProject = useAppStore((s) => s.projects[0]?.id ?? null)
  const showThread = useAppStore((s) => s.showThread)
  const stage = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const zoomLabel = useRef<HTMLSpanElement>(null)
  const camera = useBoardCamera(stage, world, zoomLabel)
  const [moving, setMoving] = useState<BoardPlacement | null>(null)
  const [trayOpen, setTrayOpen] = useState(false)
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const placements = board?.placements ?? []
  // Fits once the board's first placements are known; later moves keep the view.
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || !board) return
    fitted.current = true
    camera.fit(board.placements)
  }, [board, camera])
  if (!board) return null
  const save = (next: BoardPlacement[]) => void place(board.id, next)
  const add = (cardId: string, at?: { x: number; y: number }) => {
    if (placements.some((p) => p.cardId === cardId)) return
    save([...placements, { cardId, ...(at ?? nextSlot(placements, cards)) }])
  }
  const press = (placement: BoardPlacement) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const start = { x: event.clientX, y: event.clientY }
    let dragged = false
    let last = placement
    const move = (e: PointerEvent) => {
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (!dragged && Math.hypot(dx, dy) < DRAG_SLOP) return
      dragged = true
      const k = camera.scale()
      last = {
        ...placement,
        x: Math.round(placement.x + dx / k),
        y: Math.round(placement.y + dy / k)
      }
      setMoving(last)
    }
    const up = () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      setMoving(null)
      if (dragged) save(placements.map((p) => (p.cardId === last.cardId ? last : p)))
      else toggleSelected(placement.cardId)
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
  }
  const picked = selected.flatMap((id) => {
    const card = byId.get(id)
    return card ? [{ id: card.id, title: card.title }] : []
  })
  return (
    <div className="board-view">
      {trayOpen ? (
        <BoardTray board={board} onAdd={(id) => add(id)} onClose={() => setTrayOpen(false)} />
      ) : null}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target for cards dragged from the tray; the tray's add buttons are the keyboard path. */}
      <div
        className="board-stage"
        ref={stage}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(CARD_DRAG)) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(event) => {
          const cardId = event.dataTransfer.getData(CARD_DRAG)
          if (!cardId) return
          event.preventDefault()
          const at = camera.toBoard(event.clientX, event.clientY)
          add(cardId, { x: Math.round(at.x - BOARD_CARD_WIDTH / 2), y: Math.round(at.y - 24) })
        }}
      >
        <div className="board-world" ref={world}>
          {placements.map((placement) => {
            const card = byId.get(placement.cardId)
            if (!card) return null
            const shown = moving?.cardId === card.id ? moving : placement
            return (
              <BoardCard
                key={card.id}
                card={card}
                placement={shown}
                selected={selected.includes(card.id)}
                onPress={press(placement)}
                onOpen={() => openCard(card.id)}
                onRemove={() => save(placements.filter((p) => p.cardId !== card.id))}
              />
            )
          })}
        </div>
        {placements.length ? null : <p className="board-empty">{t('cards.boardEmpty')}</p>}
        <div className="board-rail">
          <IconButton
            label={t('cards.addCards')}
            tooltip={t('cards.addCards')}
            tooltipSide="right"
            aria-pressed={trayOpen}
            icon={<CardPlusIcon size={18} />}
            onClick={() => setTrayOpen(!trayOpen)}
          />
          <IconButton
            label={t('cards.new')}
            tooltip={t('cards.new')}
            tooltipSide="right"
            icon={<PlusIcon size={18} />}
            onClick={() => openCard(NEW_CARD)}
          />
        </div>
        <div className="board-zoom">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="board-zoom-level"
                aria-label={t('map.fit')}
                onClick={() => camera.fit(placements)}
              >
                <span ref={zoomLabel}>100%</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('map.fit')}</TooltipContent>
          </Tooltip>
          <button type="button" aria-label={t('map.zoomIn')} onClick={() => camera.zoomBy(1.25)}>
            <PlusIcon size={16} />
          </button>
          <button type="button" aria-label={t('map.zoomOut')} onClick={() => camera.zoomBy(0.8)}>
            <span className="board-zoom-minus" />
          </button>
        </div>
        {picked.length ? (
          <div className="board-bar">
            <RouterComposer
              projectId={board.projectId ?? routerProjectId ?? firstProject}
              router={undefined}
              linkedCards={picked}
              prompt={t('cards.boardPromptPicked')}
              onSent={() => setSelected([])}
              onThread={showThread}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
