import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { ChevronDownIcon, CollapseAllIcon, ExpandAllIcon } from '@renderer/components/ui/icons'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DreamingOwl, OwlAvatar } from '../app/OwlAvatar'
import { UserAvatar } from '../app/UserAvatar'

/** `dreaming` is the memory agent, shown at the end of a thread while it reads it. */
export type ThreadSpeaker = 'router' | 'user' | 'dreaming'

/** A folded turn keeps this many lines; the toggle appears only past it. */
const FOLDED_LINES = 4

/**
 * A run of rows by one speaker, under one avatar: for the Router, everything it did between
 * two user messages. A foldable turn that runs past four lines folds as one block, from a
 * toggle right under the avatar or a button at the turn's foot.
 */
export function ThreadTurn({
  foldable = false,
  children
}: {
  foldable?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  const turn = useRef<HTMLDivElement>(null)
  const rows = useRef<HTMLDivElement>(null)
  const long = useLongTurn(rows, foldable)
  const [folded, setFolded] = useState(false)
  const isFolded = long && folded
  const label = t(isFolded ? 'router.expandMessage' : 'router.collapseMessage')
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
    <div ref={turn} className={`router-turn${isFolded ? ' folded' : ''}`}>
      <div ref={rows} className="router-turn-rows">
        {children}
      </div>
      {long ? (
        <>
          {/* Pinned under the avatar, along the turn's avatar column, so it stays in view. */}
          <div className="router-turn-rail">
            <div className="router-row-tools" role="toolbar" aria-label={t('router.messageTools')}>
              <IconButton
                size="sm"
                label={label}
                tooltip={label}
                tooltipSide="right"
                aria-expanded={!isFolded}
                icon={isFolded ? <ExpandAllIcon size={16} /> : <CollapseAllIcon size={16} />}
                onClick={toggle}
              />
            </div>
          </div>
          {/* At the turn's foot: over the fade while folded, after the last row once open. */}
          <Button
            variant="ghost"
            size="custom"
            className="router-fold-bar"
            aria-expanded={!isFolded}
            onClick={toggle}
          >
            <ChevronDownIcon size={14} />
            {label}
          </Button>
        </>
      ) : null}
    </div>
  )
}

/** One line of the thread. `follows` hides the avatar under the same speaker's last row. */
export function ThreadRow({
  speaker,
  follows = false,
  entryId,
  working = false,
  children
}: {
  speaker: ThreadSpeaker
  follows?: boolean
  /** The Router's turn is still running: its owl types away, shown even after its own rows. */
  working?: boolean
  /** Lets the timeline find a row, e.g. to bring a just-sent message to the top. */
  entryId?: string
  children: ReactNode
}) {
  return (
    <div className={`router-row ${speaker}${follows ? ' follows' : ''}`} data-entry-id={entryId}>
      <div className="router-row-side">
        <div className="router-row-avatar" aria-hidden="true">
          {follows ? null : speaker === 'router' ? (
            <OwlAvatar speaker="router" working={working} />
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
 * Whether the turn runs past the folded height. Watches its size, since streaming, Mermaid
 * diagrams, new rows, and the column width all change it after mount.
 */
function useLongTurn(rows: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [long, setLong] = useState(false)
  useEffect(() => {
    const el = enabled ? rows.current : null
    if (!el) {
      setLong(false)
      return
    }
    const measure = () => {
      // The thread's text line, as router.css folds by it (`--owl-turn-line`).
      const style = getComputedStyle(el)
      const lineHeight =
        Number.parseFloat(style.getPropertyValue('--owl-text-base')) *
        Number.parseFloat(style.getPropertyValue('--owl-leading-relaxed'))
      // Half a line of slack, so a turn that only just reaches the fold gets no toggle.
      setLong(el.scrollHeight > lineHeight * (FOLDED_LINES + 0.5))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // A folded turn's box stops growing; its content still does while it streams.
    const mutations = new MutationObserver(measure)
    mutations.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [rows, enabled])
  return long
}
