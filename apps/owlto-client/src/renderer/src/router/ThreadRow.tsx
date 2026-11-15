import { IconButton } from '@renderer/components/ui/icon-button'
import { CollapseAllIcon, ExpandAllIcon } from '@renderer/components/ui/icons'
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { DreamingOwl, OwlAvatar } from '../app/OwlAvatar'
import { UserAvatar } from '../app/UserAvatar'

/** `dreaming` is the memory agent, shown at the end of a thread while it reads it. */
export type ThreadSpeaker = 'router' | 'user' | 'dreaming'

/** A folded reply keeps this many lines; the toggle appears only past it. */
const FOLDED_LINES = 4

type TurnFold = {
  folded: boolean
  /** A row reports whether its reply runs past the folded height. */
  setLong(rowId: string, long: boolean): void
}
const TurnFoldContext = createContext<TurnFold | null>(null)

/**
 * A run of rows by one speaker, under one avatar. When any reply in it is long, a fold toggle
 * sits right under the avatar and folds every long reply in the turn.
 */
export function ThreadTurn({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const turn = useRef<HTMLDivElement>(null)
  const [longRows, setLongRows] = useState<ReadonlySet<string>>(new Set())
  const [folded, setFolded] = useState(false)
  const setLong = useCallback((rowId: string, long: boolean) => {
    setLongRows((rows) => {
      if (rows.has(rowId) === long) return rows
      const next = new Set(rows)
      if (long) next.add(rowId)
      else next.delete(rowId)
      return next
    })
  }, [])
  const hasLong = longRows.size > 0
  const isFolded = hasLong && folded
  const fold = useMemo(() => ({ folded: isFolded, setLong }), [isFolded, setLong])
  function toggle() {
    setFolded(!isFolded)
    if (isFolded) return
    // Folding from deep inside a long turn would leave the view below it; bring its top back.
    requestAnimationFrame(() => {
      const el = turn.current
      const scroller = el?.closest<HTMLElement>('.owlto-conversation-scroll')
      if (el && scroller && el.getBoundingClientRect().top < scroller.getBoundingClientRect().top)
        el.scrollIntoView({ block: 'start' })
    })
  }
  return (
    <TurnFoldContext.Provider value={fold}>
      <div ref={turn} className="router-turn">
        {children}
        {hasLong ? (
          // Pinned under the avatar, along the turn's avatar column, so it stays in view.
          <div className="router-turn-rail">
            <div className="router-row-tools" role="toolbar" aria-label={t('router.messageTools')}>
              <IconButton
                size="sm"
                label={t(isFolded ? 'router.expandMessage' : 'router.collapseMessage')}
                tooltip={t(isFolded ? 'router.expandMessage' : 'router.collapseMessage')}
                tooltipSide="right"
                aria-expanded={!isFolded}
                icon={isFolded ? <ExpandAllIcon size={16} /> : <CollapseAllIcon size={16} />}
                onClick={toggle}
              />
            </div>
          </div>
        ) : null}
      </div>
    </TurnFoldContext.Provider>
  )
}

/** One line of the thread. `follows` hides the avatar under the same speaker's last row. */
export function ThreadRow({
  speaker,
  follows = false,
  entryId,
  foldable = false,
  children
}: {
  speaker: ThreadSpeaker
  follows?: boolean
  /** Lets the timeline find a row, e.g. to bring a just-sent message to the top. */
  entryId?: string
  /** A reply that can fold to its first lines, by its turn's toggle under the avatar. */
  foldable?: boolean
  children: ReactNode
}) {
  const row = useRef<HTMLDivElement>(null)
  const fold = useContext(TurnFoldContext)
  const long = useLongReply(row, foldable && fold !== null)
  const rowId = useId()
  const setLong = fold?.setLong
  useEffect(() => {
    if (!setLong) return
    setLong(rowId, long)
    return () => setLong(rowId, false)
  }, [setLong, rowId, long])
  const isFolded = long && Boolean(fold?.folded)
  return (
    <div
      ref={row}
      className={`router-row ${speaker}${follows ? ' follows' : ''}${isFolded ? ' folded' : ''}`}
      data-entry-id={entryId}
    >
      <div className="router-row-side">
        <div className="router-row-avatar" aria-hidden="true">
          {follows ? null : speaker === 'router' ? (
            <OwlAvatar speaker="router" />
          ) : speaker === 'dreaming' ? (
            <DreamingOwl />
          ) : (
            <UserAvatar />
          )}
        </div>
      </div>
      <div className="router-row-body">{children}</div>
    </div>
  )
}

/**
 * Whether the row's reply runs past the folded height. Watches the reply's size, since
 * streaming, Mermaid diagrams, and the column width all change it after mount.
 */
function useLongReply(row: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [long, setLong] = useState(false)
  useEffect(() => {
    const markdown = enabled
      ? row.current?.querySelector<HTMLElement>('.router-row-body .owlto-markdown')
      : null
    if (!markdown) {
      setLong(false)
      return
    }
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(markdown).lineHeight)
      // Half a line of slack, so a reply that only just reaches the fold gets no toggle.
      setLong(markdown.scrollHeight > lineHeight * (FOLDED_LINES + 0.5))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(markdown)
    // A folded reply's box stops growing; its content still does while it streams.
    const mutations = new MutationObserver(measure)
    mutations.observe(markdown, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [row, enabled])
  return long
}
