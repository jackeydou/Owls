import { type RefObject, useEffect } from 'react'

export function useComposerCursorOrigin(editorShellRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const cursorApi = window.api?.cursorOverlay
    if (!cursorApi) {
      console.warn(
        '[ChatComposer] window.api.cursorOverlay is unavailable; preload likely stale. Reload the window to pick up the new bridge.'
      )
      return
    }
    const setOrigin = (point: { x: number; y: number } | null): void => {
      void cursorApi.setOrigin(point).catch(() => undefined)
    }

    let cancelled = false
    let lastX = Number.NaN
    let lastY = Number.NaN
    function report(): void {
      if (cancelled) return
      const el = editorShellRef.current
      if (!el) {
        setOrigin(null)
        return
      }
      const rect = el.getBoundingClientRect()
      const x = window.screenX + rect.left + rect.width / 2
      const y = window.screenY + rect.top + rect.height + 8
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      if (Math.abs(x - lastX) < 1 && Math.abs(y - lastY) < 1) return
      lastX = x
      lastY = y
      setOrigin({ x, y })
    }

    report()
    window.addEventListener('resize', report)
    const interval = setInterval(report, 1000)
    return () => {
      cancelled = true
      window.removeEventListener('resize', report)
      clearInterval(interval)
      setOrigin(null)
    }
  }, [editorShellRef])
}
