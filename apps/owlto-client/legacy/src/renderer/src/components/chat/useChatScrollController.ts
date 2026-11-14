import type { ToolWidgetState } from '@renderer/components/tool-widgets/types'
import type { ChatMessage, ModelReconnectStatus } from '@renderer/stores/session-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

function scrollElementToChildCenter(
  scrollElement: HTMLElement,
  target: HTMLElement,
  behavior: ScrollBehavior
): void {
  const scrollRect = scrollElement.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetCenterOffset =
    targetRect.top - scrollRect.top + targetRect.height / 2 - scrollElement.clientHeight / 2
  const nextTop = Math.max(0, scrollElement.scrollTop + targetCenterOffset)
  scrollElement.scrollTo({ top: nextTop, behavior })
}

export function useChatScrollController({
  busy,
  loadSession,
  messages,
  pendingReconnectStatus,
  queuedPrompts,
  reduceMotion,
  sessionId,
  showBottomComposer,
  streamingAssistant,
  widgets
}: {
  busy: boolean
  loadSession: (sessionId: string) => Promise<void>
  messages: ChatMessage[]
  pendingReconnectStatus: ModelReconnectStatus | null
  queuedPrompts: unknown[]
  reduceMotion: boolean
  sessionId: string | null
  showBottomComposer: boolean
  streamingAssistant: string
  widgets: Map<string, ToolWidgetState>
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const sourceNavigationSessionId = searchParams.get('session')
  const sourceNavigationMessageId = searchParams.get('message')
  const sourceNavigationPending = Boolean(sourceNavigationSessionId || sourceNavigationMessageId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const bottomComposerContentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const skipNextSessionBottomScrollRef = useRef(false)
  const showScrollDownRef = useRef(false)
  const resizeFrameRef = useRef<number | null>(null)
  const [showScrollDown, setShowScrollDownState] = useState(false)
  const [bottomComposerHeight, setBottomComposerHeight] = useState(0)

  const setShowScrollDown = useCallback((nextShowScrollDown: boolean) => {
    if (showScrollDownRef.current === nextShowScrollDown) return
    showScrollDownRef.current = nextShowScrollDown
    setShowScrollDownState(nextShowScrollDown)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const updateStickToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const canScroll = el.scrollHeight - el.clientHeight > 24
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom <= 24
    stickToBottomRef.current = atBottom
    setShowScrollDown(canScroll && !atBottom)
  }, [setShowScrollDown])

  const handleScrollToBottom = useCallback(() => {
    stickToBottomRef.current = true
    setShowScrollDown(false)
    scrollToBottom('smooth')
  }, [scrollToBottom, setShowScrollDown])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    updateStickToBottom()
    const handleScroll = () => updateStickToBottom()
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [updateStickToBottom])

  useEffect(() => {
    const content = scrollContentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current !== null) return
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null
        if (!scrollContentRef.current) return
        if (!sourceNavigationPending && stickToBottomRef.current) {
          scrollToBottom('auto')
        }
        updateStickToBottom()
      })
    })

    observer.observe(content)
    return () => {
      observer.disconnect()
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
    }
  }, [scrollToBottom, sourceNavigationPending, updateStickToBottom])

  useEffect(() => {
    if (sourceNavigationPending) {
      stickToBottomRef.current = false
      setShowScrollDown(false)
      return
    }
    if (skipNextSessionBottomScrollRef.current) {
      skipNextSessionBottomScrollRef.current = false
      stickToBottomRef.current = false
      setShowScrollDown(true)
      return
    }

    const expectedSessionId = sessionId
    stickToBottomRef.current = true
    setShowScrollDown(false)
    const frameId = requestAnimationFrame(() => {
      if (useSessionStore.getState().sessionId !== expectedSessionId) return
      scrollToBottom('auto')
      updateStickToBottom()
    })
    return () => cancelAnimationFrame(frameId)
  }, [sessionId, scrollToBottom, setShowScrollDown, sourceNavigationPending, updateStickToBottom])

  useEffect(() => {
    const targetSessionId = sourceNavigationSessionId
    const targetMessageId = sourceNavigationMessageId
    if (!targetSessionId && !targetMessageId) return

    stickToBottomRef.current = false
    setShowScrollDown(false)

    if (targetSessionId && targetSessionId !== sessionId) {
      void loadSession(targetSessionId)
      return
    }

    if (!targetMessageId) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('session')
      setSearchParams(nextParams, { replace: true })
      return
    }

    if (!messages.some((message) => message.id === targetMessageId)) return

    let cancelled = false
    let frameId: number | null = null
    let timeoutId: number | null = null

    const clearTimers = (): void => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
        frameId = null
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    const scrollToTarget = (attempt: number): void => {
      frameId = requestAnimationFrame(() => {
        frameId = null
        if (cancelled) return

        const content = scrollContentRef.current
        const target = content
          ? Array.from(content.querySelectorAll<HTMLElement>('[data-message-id]')).find(
              (element) => element.dataset.messageId === targetMessageId
            )
          : null

        if (!target) {
          if (attempt < 20) {
            timeoutId = window.setTimeout(() => {
              timeoutId = null
              scrollToTarget(attempt + 1)
            }, 50)
          }
          return
        }

        stickToBottomRef.current = false
        const scrollElement = scrollRef.current
        if (!scrollElement) return

        const behavior = reduceMotion ? 'auto' : 'smooth'
        scrollElementToChildCenter(scrollElement, target, behavior)
        window.setTimeout(
          () => {
            if (!cancelled && scrollRef.current) {
              scrollElementToChildCenter(scrollRef.current, target, 'auto')
            }
          },
          reduceMotion ? 0 : 280
        )
        target.classList.add('artifact-source-highlight')
        window.setTimeout(() => {
          target.classList.remove('artifact-source-highlight')
        }, 1600)

        const nextParams = new URLSearchParams(searchParams)
        nextParams.delete('session')
        nextParams.delete('message')
        skipNextSessionBottomScrollRef.current = true
        setSearchParams(nextParams, { replace: true })
      })
    }

    scrollToTarget(0)

    return () => {
      cancelled = true
      clearTimers()
    }
  }, [
    loadSession,
    messages,
    reduceMotion,
    searchParams,
    sessionId,
    setSearchParams,
    sourceNavigationMessageId,
    sourceNavigationSessionId,
    setShowScrollDown
  ])

  useEffect(() => {
    if (!showBottomComposer) {
      setBottomComposerHeight(0)
      return
    }

    const composerContent = bottomComposerContentRef.current
    if (!composerContent) return

    const updateHeight = () => {
      setBottomComposerHeight(composerContent.getBoundingClientRect().height)
    }

    updateHeight()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateHeight)
    observer.observe(composerContent)
    return () => observer.disconnect()
  }, [showBottomComposer])

  // biome-ignore lint/correctness/useExhaustiveDependencies: sync scroll to latest message/stream/widget
  useEffect(() => {
    if (sourceNavigationPending) return
    if (!stickToBottomRef.current) return
    const behavior = busy ? 'auto' : reduceMotion ? 'auto' : 'smooth'
    scrollToBottom(behavior)
  }, [
    messages,
    busy,
    streamingAssistant,
    pendingReconnectStatus,
    widgets,
    queuedPrompts,
    reduceMotion,
    sourceNavigationPending
  ])

  return {
    bottomComposerContentRef,
    bottomComposerHeight,
    handleScrollToBottom,
    scrollContentRef,
    scrollRef,
    showScrollDown,
    sourceNavigationPending
  }
}
