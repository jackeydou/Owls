import { autoUpdate, flip, hide, offset, shift, useFloating } from '@floating-ui/react-dom'
import { IconButton } from '@renderer/components/ui/icon-button'
import { ArrowUpIcon } from '@renderer/components/ui/icons'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { DRAFT_QUOTE_LIMIT, QUOTE_NOTE_LIMIT, useQuoteStore, useThreadQuotes } from './quotes'
import type { Selected } from './SelectionActions'

/**
 * The selection bar after Quote: the passage on top (two lines at most) and a field for a
 * note on it. Enter adds the quote above the thread's editor; Escape or a click elsewhere
 * drops it.
 */
export function QuotePanel({
  selected,
  routerId,
  onClose
}: {
  selected: Selected
  routerId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const add = useQuoteStore((s) => s.add)
  const full = useThreadQuotes(routerId).length >= DRAFT_QUOTE_LIMIT
  const [note, setNote] = useState('')
  const panel = useRef<HTMLDivElement | null>(null)
  const field = useRef<HTMLTextAreaElement | null>(null)
  const { refs, floatingStyles, isPositioned, middlewareData } = useFloating({
    placement: 'top',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 }), hide()]
  })
  useLayoutEffect(() => {
    refs.setReference(selected.anchor)
  }, [selected.anchor, refs])
  // A hidden element takes no focus, so the field is focused once the panel has its place.
  useEffect(() => {
    if (isPositioned) field.current?.focus()
  }, [isPositioned])
  // The field grows with the note up to its max height, then scrolls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measures again as the note changes.
  useLayoutEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [note])
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])
  function confirm() {
    // Closing moves the passage into a tag above the editor, which is the visible result.
    if (add(routerId, selected.text, note)) onClose()
  }
  const setFloating = (node: HTMLDivElement | null) => {
    panel.current = node
    refs.setFloating(node)
  }
  const hidden = !isPositioned || middlewareData.hide?.referenceHidden
  return createPortal(
    <div
      ref={setFloating}
      role="dialog"
      aria-label={t('quote.panel')}
      className="owlto-quote-panel"
      style={{ ...floatingStyles, visibility: hidden ? 'hidden' : 'visible' }}
    >
      <blockquote className="owlto-quote-panel-text">{selected.text}</blockquote>
      {full ? (
        <p className="owlto-quote-panel-full" role="alert">
          {t('quote.full', { count: DRAFT_QUOTE_LIMIT })}
        </p>
      ) : (
        <div className="owlto-quote-panel-field">
          <textarea
            ref={field}
            rows={1}
            value={note}
            maxLength={QUOTE_NOTE_LIMIT}
            aria-label={t('quote.note')}
            placeholder={t('quote.placeholder')}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              confirm()
            }}
          />
          <IconButton
            size="sm"
            variant="default"
            className="owlto-quote-panel-add"
            label={t('quote.add')}
            tooltip={t('quote.add')}
            icon={<ArrowUpIcon size={14} />}
            onClick={confirm}
          />
        </div>
      )}
    </div>,
    document.body
  )
}
