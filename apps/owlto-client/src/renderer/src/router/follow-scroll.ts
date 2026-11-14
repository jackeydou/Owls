import { useCallback, useEffect, useLayoutEffect, useRef, useState, type WheelEvent } from 'react'
import { prefersCalm } from './motion'

/** Scrolling this far up from the bottom lets go; a wheel turn upward lets go sooner. */
const RELEASE_SLACK = 24
/** Back within this of the bottom, following resumes. Lower than the release so they don't fight. */
const RESUME_SLACK = 2

const distanceToBottom = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop

/**
 * Keeps a scroller at its bottom while its content grows, like a chat. Scrolling up lets go
 * and reports `away`, so the view can offer `jumpToBottom`; reaching the bottom again, by hand
 * or by the jump, resumes following. Turning `active` on starts over at the bottom; while it is
 * off (another view shares the scroller) nothing follows and the view starts at the top.
 */
export function useFollowScroll(active: boolean) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  /** Set while the jump's smooth scroll runs, so its in-between positions do not let go. */
  const jumping = useRef(false)
  const enabled = useRef(active)
  const [away, setAway] = useState(false)
  const follow = useCallback((on: boolean) => {
    following.current = on
    setAway(!on)
  }, [])

  useLayoutEffect(() => {
    enabled.current = active
    jumping.current = false
    following.current = active
    setAway(false)
    const el = scroller.current
    if (el) el.scrollTop = active ? el.scrollHeight : 0
  }, [active])

  // Watches sizes, not items: streaming text, opened tool calls, and the panel's own height all
  // move the bottom.
  useEffect(() => {
    const el = scroller.current
    const body = content.current
    if (!el || !body) return
    const observer = new ResizeObserver(() => {
      if (!enabled.current || jumping.current) return
      if (following.current) el.scrollTop = el.scrollHeight
      // Let go but back at the bottom, say after the content shrank: follow again.
      else follow(distanceToBottom(el) <= RESUME_SLACK)
    })
    observer.observe(el)
    observer.observe(body)
    return () => observer.disconnect()
  }, [follow])

  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el || !enabled.current || jumping.current) return
    const distance = distanceToBottom(el)
    if (following.current) {
      if (distance > RELEASE_SLACK) follow(false)
    } else follow(distance <= RESUME_SLACK)
  }, [follow])

  // A wheel turn upward lets go at once, before the content can grow back under the slack.
  const onWheel = useCallback(
    (event: WheelEvent) => {
      const el = scroller.current
      if (!enabled.current || event.deltaY >= 0 || !el || el.scrollTop <= 0) return
      jumping.current = false
      if (following.current) follow(false)
    },
    [follow]
  )

  const jumpToBottom = useCallback(() => {
    const el = scroller.current
    if (!el) return
    follow(true)
    if (prefersCalm()) {
      el.scrollTop = el.scrollHeight
      return
    }
    jumping.current = true
    const done = () => {
      el.removeEventListener('scrollend', done)
      window.clearTimeout(fallback)
      if (!jumping.current) return
      jumping.current = false
      // The content may have grown during the scroll.
      if (following.current) el.scrollTop = el.scrollHeight
    }
    el.addEventListener('scrollend', done)
    const fallback = window.setTimeout(done, 1000)
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [follow])

  /** Stops following, for a change the user made above the bottom, like unfolding history. */
  const release = useCallback(() => {
    jumping.current = false
    following.current = false
  }, [])

  return { scroller, content, away: active && away, onScroll, onWheel, jumpToBottom, release }
}
