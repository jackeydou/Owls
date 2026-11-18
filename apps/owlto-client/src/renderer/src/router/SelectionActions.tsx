import {
  autoUpdate,
  flip,
  hide,
  offset,
  shift,
  useFloating,
  type VirtualElement
} from '@floating-ui/react-dom'
import { IconButton } from '@renderer/components/ui/icon-button'
import { CardPlusIcon, CheckIcon, CopyIcon, ForwardIcon } from '@renderer/components/ui/icons'
import { type RefObject, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { Router, SessionItem } from '../../../shared/app'
import { CARD_BODY_LIMIT } from '../../../shared/cards'
import { titleFrom } from '../cards/CardActions'
import { useCardsStore } from '../cards/store'
import { useViewingRemote } from '../remote/viewing'
import { useRouterStore } from './store'

/** Message text a selection can quote: a reply's Markdown or a user's own message. */
const QUOTABLE = '.owlto-markdown, .owlto-user-message'
/** How long Copy shows its check mark. */
const COPIED_MS = 1600

type Selected = { item: SessionItem; text: string; anchor: VirtualElement }

/**
 * The message actions (Copy, Forward, Save as note) for a selection inside one message,
 * floating above it. Forward and Save take only the selected text.
 */
export function SelectionActions({
  scroller,
  router,
  itemOf
}: {
  scroller: RefObject<HTMLElement | null>
  router: Router | undefined
  /** The message a row shows, when it can be quoted. */
  itemOf: (entryId: string) => SessionItem | null
}) {
  const selected = useSelection(scroller, itemOf)
  // Forwarding and notes stay on this Mac; another device's threads are read here only.
  const remote = useViewingRemote()
  if (!router || !selected || remote) return null
  return <SelectionToolbar key={selected.item.id} selected={selected} router={router} />
}

function SelectionToolbar({ selected, router }: { selected: Selected; router: Router }) {
  const { t } = useTranslation()
  const startForward = useRouterStore((s) => s.startForward)
  const startCapture = useCardsStore((s) => s.startCapture)
  const [copied, setCopied] = useState(false)
  const { refs, floatingStyles, isPositioned, middlewareData } = useFloating({
    placement: 'top',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 }), hide()]
  })
  useLayoutEffect(() => {
    refs.setReference(selected.anchor)
  }, [selected.anchor, refs])
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])
  const { item, text } = selected
  const source = { kind: 'item' as const, routerId: router.id, itemId: item.id, quote: text }
  // The dialog that opens is the feedback; the selection it came from is done with.
  const done = () => window.getSelection()?.removeAllRanges()
  const hidden = !isPositioned || middlewareData.hide?.referenceHidden
  return createPortal(
    <div
      ref={refs.setFloating}
      role="toolbar"
      aria-label={t('router.selectionTools')}
      className="owlto-selection-actions"
      style={{ ...floatingStyles, visibility: hidden ? 'hidden' : 'visible' }}
      // Pressing a button must not clear the selection it acts on.
      onMouseDown={(event) => event.preventDefault()}
    >
      <IconButton
        size="sm"
        label={t(copied ? 'copied' : 'router.copySelection')}
        tooltip={t(copied ? 'copied' : 'router.copySelection')}
        icon={copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => setCopied(true))
        }}
      />
      <IconButton
        size="sm"
        label={t('router.forwardSelection')}
        tooltip={t('router.forwardSelection')}
        icon={<ForwardIcon size={15} />}
        onClick={() => {
          startForward({ source, preview: text, projectId: router.projectId })
          done()
        }}
      />
      <IconButton
        size="sm"
        label={t('router.saveSelection')}
        tooltip={t('router.saveSelection')}
        icon={<CardPlusIcon size={15} />}
        onClick={() => {
          startCapture({
            source,
            title: titleFrom(text),
            preview: text,
            projectId: router.projectId
          })
          done()
        }}
      />
    </div>,
    document.body
  )
}

/**
 * The selection when it lies inside one quotable message in the thread. While the pointer is
 * down the selection is still being drawn, so it is read once the pointer comes up.
 */
function useSelection(
  scroller: RefObject<HTMLElement | null>,
  itemOf: (entryId: string) => SessionItem | null
): Selected | null {
  const [selected, setSelected] = useState<Selected | null>(null)
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    let pointerDown = false
    let frame = 0
    const read = () => {
      frame = 0
      if (pointerDown) return
      setSelected(selectionIn(root, itemOf))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !root.contains(event.target as Node)) return
      pointerDown = true
      setSelected(null)
    }
    const onPointerUp = () => {
      if (!pointerDown) return
      pointerDown = false
      schedule()
    }
    document.addEventListener('selectionchange', schedule)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', schedule)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
    }
  }, [scroller, itemOf])
  return selected
}

function selectionIn(
  root: HTMLElement,
  itemOf: (entryId: string) => SessionItem | null
): Selected | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  const common = range.commonAncestorContainer
  const element = common instanceof Element ? common : common.parentElement
  const message = element?.closest<HTMLElement>(QUOTABLE)
  const row = message?.closest<HTMLElement>('.router-row[data-entry-id]')
  if (!message || !row?.dataset.entryId || !root.contains(row)) return null
  const item = itemOf(row.dataset.entryId)
  const text = selection.toString().trim().slice(0, CARD_BODY_LIMIT)
  if (!item || !text) return null
  return {
    item,
    text,
    anchor: {
      getBoundingClientRect: () => range.getBoundingClientRect(),
      getClientRects: () => range.getClientRects(),
      contextElement: message
    }
  }
}
