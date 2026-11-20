import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** From faint to dense; each step is drawn a little stronger. */
const RAMP = ' .·:-=+*#%@'
const CELL_W = 10
const CELL_H = 16
const FRAME_MS = 66
const POINTER_RADIUS = 140

/**
 * A slow field of ASCII characters behind the whole Devices page: drifting waves, brighter
 * where the pointer is. It sits under the page's scroll area, takes no clicks, holds still for
 * reduced motion, and stops while the window is hidden.
 */
export function AsciiBackdrop() {
  const anchor = useRef<HTMLSpanElement>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    setHost(anchor.current?.closest<HTMLElement>('.owlto-settings-page') ?? null)
  }, [])
  return (
    <>
      <span ref={anchor} hidden />
      {host ? createPortal(<AsciiCanvas host={host} />, host) : null}
    </>
  )
}

function AsciiCanvas({ host }: { host: HTMLElement }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let width = 0
    let height = 0
    let color = ''
    let colorReadAt = 0
    let frame = 0
    let last = 0
    const pointer = { x: -1e4, y: -1e4, strength: 0 }
    const started = performance.now()

    const resize = () => {
      const rect = host.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      width = rect.width
      height = rect.height
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.font = `12px ui-monospace, 'SF Mono', Menlo, monospace`
      context.textBaseline = 'top'
      draw(performance.now())
    }

    const draw = (now: number) => {
      if (now - colorReadAt > 1000) {
        color = getComputedStyle(host).getPropertyValue('--color-foreground').trim() || '#000'
        colorReadAt = now
      }
      const t = (now - started) / 1000
      context.clearRect(0, 0, width, height)
      context.fillStyle = color
      const columns = Math.ceil(width / CELL_W)
      const rows = Math.ceil(height / CELL_H)
      // A center that wanders, for rings that move across the page.
      const cx = columns * (0.62 + 0.18 * Math.sin(t * 0.13))
      const cy = rows * (0.3 + 0.15 * Math.cos(t * 0.11))
      const levels: [number, number][][] = RAMP.split('').map(() => [])
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const dx = column - cx
          const dy = (row - cy) * 1.6
          let value =
            Math.sin(column * 0.07 + t * 0.5) +
            Math.sin(row * 0.13 - t * 0.35) +
            Math.sin((column + row) * 0.045 + t * 0.25) +
            0.7 * Math.sin(Math.sqrt(dx * dx + dy * dy) * 0.22 - t * 1.1)
          value = (value + 3.7) / 7.4
          if (pointer.strength > 0) {
            const px = column * CELL_W - pointer.x
            const py = row * CELL_H - pointer.y
            const near = 1 - Math.sqrt(px * px + py * py) / POINTER_RADIUS
            if (near > 0) value += near * near * 0.7 * pointer.strength
          }
          const level = Math.min(
            RAMP.length - 1,
            Math.max(0, Math.floor(value ** 2.5 * 1.3 * RAMP.length))
          )
          if (level > 0) levels[level].push([column, row])
        }
      }
      for (let level = 1; level < RAMP.length; level++) {
        context.globalAlpha = 0.06 + (level / (RAMP.length - 1)) * 0.22
        const char = RAMP[level]
        for (const [column, row] of levels[level])
          context.fillText(char, column * CELL_W, row * CELL_H)
      }
      context.globalAlpha = 1
    }

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (document.hidden || now - last < FRAME_MS) return
      last = now
      pointer.strength = Math.max(0, pointer.strength - 0.02)
      draw(now)
    }

    const move = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      pointer.x = event.clientX - rect.left
      pointer.y = event.clientY - rect.top
      pointer.strength = 1
    }

    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    if (!still) {
      host.addEventListener('pointermove', move)
      frame = requestAnimationFrame(tick)
    }
    return () => {
      observer.disconnect()
      host.removeEventListener('pointermove', move)
      cancelAnimationFrame(frame)
    }
  }, [host])
  return <canvas ref={canvasRef} className="remote-ascii" aria-hidden />
}
