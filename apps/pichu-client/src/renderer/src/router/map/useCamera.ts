import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react'

export type Bounds = { x0: number; y0: number; x1: number; y1: number }
const MIN_ZOOM = 0.3
const MAX_ZOOM = 1.6
/** Below this, node text is too small to read, so the map shows only names and state. */
const FAR_ZOOM = 0.6
const FIT_MARGIN = 40
/** Room for the map's header and composer. */
const INSET = { top: 64, bottom: 92 }

/**
 * Pans and zooms by writing `transform` directly, so moving the canvas never
 * re-renders a node. Nothing here is persisted.
 */
export function useCamera(
  stage: RefObject<HTMLDivElement | null>,
  world: RefObject<HTMLDivElement | null>,
  zoomLabel: RefObject<HTMLElement | null>
) {
  const view = useRef({ k: 1, x: 0, y: 0 })
  const touched = useRef(false)
  const bounds = useRef<Bounds | null>(null)
  const apply = useCallback(
    (glide: boolean) => {
      const { k, x, y } = view.current
      if (world.current) {
        world.current.classList.toggle('glide', glide)
        world.current.style.transform = `translate(${x}px, ${y}px) scale(${k})`
      }
      stage.current?.classList.toggle('far', k < FAR_ZOOM)
      if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(k * 100)}%`
    },
    [stage, world, zoomLabel]
  )
  const fit = useCallback(
    (glide: boolean) => {
      const box = stage.current?.getBoundingClientRect()
      const b = bounds.current
      if (!box?.width || !b) return
      const height = box.height - INSET.top - INSET.bottom
      const k = Math.min((box.width - FIT_MARGIN * 2) / (b.x1 - b.x0), height / (b.y1 - b.y0), 1)
      const zoom = Math.max(MIN_ZOOM, k)
      view.current = {
        k: zoom,
        x: box.width / 2 - ((b.x0 + b.x1) / 2) * zoom,
        y: INSET.top + height / 2 - ((b.y0 + b.y1) / 2) * zoom
      }
      apply(glide)
    },
    [apply, stage]
  )
  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      const { k: from, x, y } = view.current
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, from * factor))
      view.current = { k, x: cx - ((cx - x) / from) * k, y: cy - ((cy - y) / from) * k }
      touched.current = true
      apply(false)
    },
    [apply]
  )
  const panBy = useCallback(
    (dx: number, dy: number) => {
      view.current.x += dx
      view.current.y += dy
      touched.current = true
      apply(false)
    },
    [apply]
  )
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const box = el.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey)
        zoomAt(event.clientX - box.left, event.clientY - box.top, Math.exp(-event.deltaY * 0.01))
      else panBy(-event.deltaX, -event.deltaY)
    }
    let drag: { x: number; y: number } | null = null
    const down = (event: PointerEvent) => {
      if ((event.target as Element).closest('[data-node]')) return
      drag = { x: event.clientX, y: event.clientY }
      el.setPointerCapture(event.pointerId)
      el.classList.add('dragging')
    }
    const move = (event: PointerEvent) => {
      if (!drag) return
      panBy(event.clientX - drag.x, event.clientY - drag.y)
      drag = { x: event.clientX, y: event.clientY }
    }
    const up = () => {
      drag = null
      el.classList.remove('dragging')
    }
    const resize = new ResizeObserver(() => {
      if (!touched.current) fit(false)
    })
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    resize.observe(el)
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      resize.disconnect()
    }
  }, [fit, panBy, stage, zoomAt])
  return useMemo(
    () => ({
      /** New content: fits again unless the user has moved the canvas themselves. */
      update(next: Bounds) {
        bounds.current = next
        if (!touched.current) fit(false)
      },
      /** Fits and hands the camera back to the map. */
      reset() {
        touched.current = false
        fit(true)
      },
      zoomBy(factor: number) {
        const box = stage.current?.getBoundingClientRect()
        if (box) zoomAt(box.width / 2, box.height / 2, factor)
      },
      /** Centers a box in the space left of `inset`. */
      focus(box: Bounds, inset: number) {
        const rect = stage.current?.getBoundingClientRect()
        if (!rect) return
        const k = Math.max(view.current.k, 0.86)
        view.current = {
          k,
          x: (rect.width - inset) / 2 - ((box.x0 + box.x1) / 2) * k,
          y: rect.height / 2 - ((box.y0 + box.y1) / 2) * k
        }
        touched.current = true
        apply(true)
      },
      /** Pans just enough to show a box beside `inset`, so its surroundings stay in view. */
      reveal(box: Bounds, inset: number) {
        const rect = stage.current?.getBoundingClientRect()
        if (!rect) return
        const { k, x, y } = view.current
        const overflow = (start: number, end: number, min: number, max: number) =>
          start < min ? min - start : end > max ? max - end : 0
        const dx = overflow(
          x + box.x0 * k,
          x + box.x1 * k,
          FIT_MARGIN,
          rect.width - inset - FIT_MARGIN
        )
        const dy = overflow(y + box.y0 * k, y + box.y1 * k, INSET.top, rect.height - INSET.bottom)
        if (!dx && !dy) return
        view.current = { k, x: x + dx, y: y + dy }
        touched.current = true
        apply(true)
      }
    }),
    [apply, fit, stage, zoomAt]
  )
}
