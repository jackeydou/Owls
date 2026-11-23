import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type OwlId, owlDrawing } from './owl-art'

/**
 * Owl, scale, and how much of the drawing shows from the top of the head (drawing units).
 * An owl with something above its head, like Antigravity's orbit ring, starts higher.
 */
const FLOCK: [OwlId, number, number, number?][] = [
  ['antigravity', 0.72, 290, 72],
  ['user', 0.78, 300],
  ['claude-code', 0.86, 315],
  ['router', 1, 335],
  ['codex', 0.86, 315],
  ['cursor', 0.78, 300]
]
const HEAD_TOP = 80
/** How far a pupil travels toward the pointer, in drawing units, so it stays inside the eye. */
const REACH = 26
const HOOTS = 5

type Hoot = { id: number; owl: OwlId; text: string }

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The website hero's owls: they peek up from the bottom edge, blink, follow the pointer with
 * their eyes, and hop and hoot when clicked. `hop` makes owls hop once, for example when their
 * agent connects; `compact` is the small row on the setup card.
 */
export function OwlFlock({
  hop = [],
  compact = false,
  className
}: {
  hop?: OwlId[]
  compact?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [hoots, setHoots] = useState<Hoot[]>([])
  const [hopping, setHopping] = useState<Record<string, number>>({})
  const turn = useRef(0)

  useEffect(() => {
    const flock = ref.current
    if (!flock || reducedMotion()) return
    let frame = 0
    let point: { x: number; y: number } | null = null
    const look = () => {
      frame = 0
      if (!point) return
      for (const svg of flock.querySelectorAll<SVGSVGElement>('.onb-owl-svg')) {
        const box = svg.getBoundingClientRect()
        if (box.width === 0) continue
        // The eye line sits about 45% down the visible drawing.
        const dx = point.x - (box.left + box.width / 2)
        const dy = point.y - (box.top + box.height * 0.45)
        const distance = Math.hypot(dx, dy) || 1
        const pull = Math.min(1, distance / 220) * REACH
        svg.style.setProperty('--px', `${((dx / distance) * pull).toFixed(1)}px`)
        svg.style.setProperty('--py', `${((dy / distance) * pull).toFixed(1)}px`)
      }
    }
    const move = (event: PointerEvent) => {
      point = { x: event.clientX, y: event.clientY }
      if (!frame) frame = requestAnimationFrame(look)
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // Only owls newly in `hop` jump, so an agent connecting does not bounce the others again.
  const hopKey = hop.join(',')
  const hopped = useRef<string[]>([])
  useEffect(() => {
    const owls = hopKey ? hopKey.split(',') : []
    const fresh = owls.filter((owl) => !hopped.current.includes(owl))
    hopped.current = owls
    if (!fresh.length) return
    setHopping((current) => {
      const next = { ...current }
      for (const owl of fresh) next[owl] = (next[owl] ?? 0) + 1
      return next
    })
  }, [hopKey])

  function hootFrom(owl: OwlId) {
    const index = turn.current++
    const hoot = { id: index, owl, text: t(`onboarding.hoot${index % HOOTS}`) }
    setHoots((current) => [...current, hoot])
    setHopping((current) => ({ ...current, [owl]: (current[owl] ?? 0) + 1 }))
  }

  return (
    <div
      ref={ref}
      className={['onb-flock', compact ? 'is-compact' : null, className].filter(Boolean).join(' ')}
    >
      {FLOCK.map(([owl, scale, height, top = HEAD_TOP], index) => (
        <button
          key={owl}
          type="button"
          className="onb-owl"
          style={{ '--s': scale, '--i': index } as CSSProperties}
          aria-label={t(`onboarding.owl.${owl}`)}
          onClick={() => hootFrom(owl)}
        >
          {/* Re-keyed on every hop so the animation restarts. */}
          <span
            key={hopping[owl] ?? 0}
            className={hopping[owl] ? 'onb-owl-body is-hopping' : 'onb-owl-body'}
          >
            <svg
              className="onb-owl-svg"
              viewBox={`52 ${top} 408 ${height + HEAD_TOP - top}`}
              aria-hidden="true"
              focusable="false"
            >
              {owlDrawing(owl)}
            </svg>
          </span>
          {hoots
            .filter((hoot) => hoot.owl === owl)
            .map((hoot) => (
              <span
                key={hoot.id}
                className="onb-hoot"
                aria-hidden="true"
                onAnimationEnd={() =>
                  setHoots((current) => current.filter((h) => h.id !== hoot.id))
                }
              >
                {hoot.text}
              </span>
            ))}
        </button>
      ))}
    </div>
  )
}
