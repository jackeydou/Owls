import { useI18n } from '@renderer/lib/i18n'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  ArrowRight,
  Command,
  ExternalLink,
  Folders,
  Globe,
  GlobeX,
  LoaderCircle,
  MessageSquarePlus,
  MoreVertical,
  Option,
  Plus,
  RefreshCw,
  RotateCcw,
  Route,
  SquareDashedMousePointer,
  X
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MessageAttachment } from '../../../shared/attachments'
import { browserCommentPartToCommittedAnnotation } from '../../../shared/browser-annotation'
import { cn } from '../lib/utils'
import {
  EMBEDDED_BROWSER_DRAFT_SESSION_KEY,
  type EmbeddedBrowserTab,
  type EmbeddedSideChatLoadingTab,
  type EmbeddedSideChatTab,
  getEmbeddedBrowserStateForSession,
  isSideChatLoadingTab,
  isSideChatTab,
  normalizeEmbeddedBrowserUrl,
  sideChatLoadingTabId,
  sideChatSessionIdFromTab,
  sideChatTabId,
  useEmbeddedBrowserStore
} from '../stores/embedded-browser-store'
import { useSessionStore } from '../stores/session-store'
import { useSettingsStore } from '../stores/settings-store'
import { useSideChatStore } from '../stores/side-chat-store'
import { useUiOverlayStore } from '../stores/ui-overlay-store'
import type {
  AddChatCommentEventDetail,
  CommentAttachmentContext
} from './chat/chat-composer-types'
import {
  composeMessageParts,
  composePromptWithContexts,
  normalizeCommentAttachmentInput
} from './chat/chat-composer-utils'
import {
  COMPOSER_COMMENT_ATTACHMENTS_CHANGED_EVENT,
  COMPOSER_SELECT_COMMENT_ATTACHMENT_EVENT,
  type CommentAttachmentsChangedEventDetail,
  getLatestCommentAttachments,
  type SelectCommentAttachmentEventDetail
} from './chat/composer-events'
import { SavedSopDetailPanel, SavedSopPanel } from './SavedSopPanel'
import { SessionFilePanel } from './SessionFilePanel'
import { SideChatPanel } from './SideChatPanel'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'

type BrowserCursorPoint = { x: number; y: number }

type BrowserCursorState = BrowserCursorPoint & {
  visible: boolean
  pressed: boolean
  pulseKey: number
}

type EmbeddedBrowserWebviewElement = HTMLElement & {
  getURL?: () => string
  getWebContentsId?: () => number
}

type EmbeddedBrowserLoadFailure = {
  url: string
  errorCode: number | null
  errorDescription: string
}

function embeddedBrowserNavigationUrl(event: Event): string | null {
  const url = (event as { url?: unknown }).url
  return typeof url === 'string' ? url : null
}

function embeddedBrowserMainFrameEvent(event: Event): boolean {
  const isMainFrame = (event as { isMainFrame?: unknown }).isMainFrame
  return isMainFrame !== false
}

function cleanWebviewErrorDescription(errorDescription: string): string {
  return errorDescription.replace(/^net::/i, '').trim()
}

function readEmbeddedBrowserLoadFailure(
  event: Event,
  fallbackUrl: string | null
): EmbeddedBrowserLoadFailure | null {
  if (!embeddedBrowserMainFrameEvent(event)) return null

  const errorDescription = cleanWebviewErrorDescription(
    String((event as { errorDescription?: unknown }).errorDescription ?? '')
  )
  if (!errorDescription || errorDescription === 'ERR_ABORTED') return null

  const errorCode = (event as { errorCode?: unknown }).errorCode
  const validatedUrl = (event as { validatedURL?: unknown }).validatedURL
  const eventUrl = embeddedBrowserNavigationUrl(event)
  const url =
    (typeof validatedUrl === 'string' && validatedUrl) || eventUrl || fallbackUrl || 'about:blank'

  return {
    url,
    errorCode: typeof errorCode === 'number' ? errorCode : null,
    errorDescription
  }
}

function readEmbeddedBrowserLoadFailureFromError(
  error: unknown,
  fallbackUrl: string | null
): EmbeddedBrowserLoadFailure | null {
  const message = error instanceof Error ? error.message : String(error)
  const errorDescription = cleanWebviewErrorDescription(
    message.match(/\bERR_[A-Z0-9_]+\b/)?.[0] ?? ''
  )
  if (!errorDescription || errorDescription === 'ERR_ABORTED') return null

  const errorCodeMatch = message.match(/\((-?\d+)\)/)
  const loadingUrlMatch = message.match(/loading ['"]([^'"]+)['"]/i)

  return {
    url: loadingUrlMatch?.[1] || fallbackUrl || 'about:blank',
    errorCode: errorCodeMatch ? Number.parseInt(errorCodeMatch[1], 10) : null,
    errorDescription
  }
}

function browserHostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

function readEmbeddedBrowserWebviewUrl(webview: EmbeddedBrowserWebviewElement): string | null {
  try {
    return webview.getURL?.() || null
  } catch {
    // Electron throws if the webview is detached or not past dom-ready.
    return null
  }
}

function browserAddressNavigationTarget(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const normalizedUrl = normalizeEmbeddedBrowserUrl(trimmed)
  if (normalizedUrl) return normalizedUrl
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

const CURSOR_MIN_MOVE_MS = 120
const CURSOR_MAX_MOVE_MS = 650
const CURSOR_MOVE_MS_PER_POINT = 0.75
const DEFAULT_CURSOR_RATIO = { x: 0.62, y: 0.58 }

type SidebarLauncherItem = {
  id: string
  icon: LucideIcon
  title: string
  description: string
  shortcutKey?: string
  shortcutModifier?: 'command' | 'option'
  disabled?: boolean
  onSelect?: () => void
}

function SidebarLauncherRow({ item }: { item: SidebarLauncherItem }): React.JSX.Element {
  const Icon = item.icon
  const ShortcutIcon = item.shortcutModifier === 'option' ? Option : Command

  return (
    <button
      type="button"
      disabled={item.disabled}
      onClick={item.onSelect}
      className={cn(
        'flex h-10 w-full items-center gap-2.5 rounded-lg bg-card-muted/55 px-3.5 text-left transition-colors',
        item.disabled
          ? 'cursor-default'
          : 'hover:bg-card-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate text-[14px] font-normal text-foreground">
        {item.title}
      </span>
      {item.shortcutKey ? (
        <kbd className="inline-flex h-5 min-w-8 shrink-0 items-center justify-center gap-0.5 rounded-full bg-background/70 px-1.5 text-[12px] font-normal text-muted-foreground">
          <ShortcutIcon className="size-3" strokeWidth={2} />
          <span>{item.shortcutKey}</span>
        </kbd>
      ) : null}
    </button>
  )
}

function tabIcon(tab: EmbeddedBrowserTab): LucideIcon {
  if (tab === 'files') return Folders
  if (tab === 'sop' || tab === 'sop-detail') return Route
  if (isSideChatTab(tab) || isSideChatLoadingTab(tab)) return MessageSquarePlus
  return Globe
}

function isSideChatPanelTab(
  tab: EmbeddedBrowserTab
): tab is EmbeddedSideChatTab | EmbeddedSideChatLoadingTab {
  return isSideChatTab(tab) || isSideChatLoadingTab(tab)
}

function sideChatTitle(t: ReturnType<typeof useI18n>['t'], index: number): string {
  return index <= 1 ? t('sideChat.title') : t('sideChat.numberedTitle', { index })
}

function tabLabel(
  tab: EmbeddedBrowserTab,
  t: ReturnType<typeof useI18n>['t'],
  pageTitle?: string | null,
  sopDetailTitle?: string | null,
  sideChatDisplayTitle?: string | null
): string {
  if (tab === 'files') return t('rightSidebar.files')
  if (tab === 'sop') return t('rightSidebar.sop')
  if (tab === 'sop-detail') return sopDetailTitle || t('rightSidebar.sopDetail')
  if (isSideChatPanelTab(tab)) return sideChatDisplayTitle || t('sideChat.title')
  return pageTitle || t('rightSidebar.browser')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function localPathFromFileUrl(url: string): string | null {
  if (!url.startsWith('file://')) return null
  try {
    return decodeURIComponent(new URL(url).pathname)
  } catch {
    return null
  }
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function cursorDistance(a: BrowserCursorPoint, b: BrowserCursorPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function cursorDuration(from: BrowserCursorPoint, to: BrowserCursorPoint): number {
  return Math.round(
    Math.max(
      CURSOR_MIN_MOVE_MS,
      Math.min(CURSOR_MAX_MOVE_MS, cursorDistance(from, to) * CURSOR_MOVE_MS_PER_POINT)
    )
  )
}

function cursorInterpolate(
  t: number,
  a: BrowserCursorPoint,
  b: BrowserCursorPoint
): BrowserCursorPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  }
}

export function EmbeddedBrowserPanel({
  sessionKey,
  visible,
  hiddenHost = false,
  sopEnabled = true,
  reserveWindowControlsInset = false
}: {
  sessionKey: string
  visible: boolean
  hiddenHost?: boolean
  sopEnabled?: boolean
  reserveWindowControlsInset?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const browserViewportRef = useRef<HTMLDivElement | null>(null)
  const browserWebviewHostRef = useRef<HTMLDivElement | null>(null)
  const browserWebviewRef = useRef<EmbeddedBrowserWebviewElement | null>(null)
  const browserWebviewContentsIdRef = useRef<number | null>(null)
  const browserWebviewDomReadyRef = useRef(false)
  const currentUrlRef = useRef<string | null>(null)
  const cursorAnimationRef = useRef<number | null>(null)
  const annotationSendQueueRef = useRef<Promise<void>>(Promise.resolve())
  const cursorStateRef = useRef<BrowserCursorState>({
    visible: false,
    pressed: false,
    pulseKey: 0,
    x: 0,
    y: 0
  })
  const hasBlockingOverlay = useUiOverlayStore((state) => state.hasBlockingOverlay)
  const browserState = useEmbeddedBrowserStore((state) =>
    getEmbeddedBrowserStateForSession(state, sessionKey)
  )
  const {
    activeTab,
    openTabs,
    currentUrl,
    pageTitle,
    addressInput,
    loading,
    canGoBack,
    canGoForward,
    annotationMode,
    lastError,
    sopDetail,
    sideChatTabIndexes = {},
    sideChatLoadingTabs
  } = browserState
  const openUrl = useEmbeddedBrowserStore((state) => state.openUrl)
  const setActiveTab = useEmbeddedBrowserStore((state) => state.setActiveTab)
  const replaceTab = useEmbeddedBrowserStore((state) => state.replaceTab)
  const setSopDetail = useEmbeddedBrowserStore((state) => state.setSopDetail)
  const closeTab = useEmbeddedBrowserStore((state) => state.closeTab)
  const startSideChatLoading = useEmbeddedBrowserStore((state) => state.startSideChatLoading)
  const failSideChatLoading = useEmbeddedBrowserStore((state) => state.failSideChatLoading)
  const setAddressInput = useEmbeddedBrowserStore((state) => state.setAddressInput)
  const setError = useEmbeddedBrowserStore((state) => state.setError)
  const parentSessionId = sessionKey === EMBEDDED_BROWSER_DRAFT_SESSION_KEY ? null : sessionKey
  const parentSessionEntry = useSessionStore(
    (state) => state.sessionIndex.find((entry) => entry.sessionId === parentSessionId) ?? null
  )
  const workingDirectory = useSettingsStore((state) => state.workingDirectory)
  const openSideChatForParent = useSideChatStore((state) => state.openForParent)
  const closeSideChatSession = useSideChatStore((state) => state.closeSideChatSession)
  const clearSideChatUnread = useSideChatStore((state) => state.clearSessionUnread)
  const sideChatTitlesBySession = useSideChatStore((state) => state.sideChatTitlesBySession)
  const sendPrompt = useSessionStore((state) => state.sendPrompt)
  const parentCwd = parentSessionEntry?.cwd
  const sideChatCwd = parentCwd ?? workingDirectory
  const annotationCwd = parentCwd ?? workingDirectory
  const [cursorState, setCursorState] = useState<BrowserCursorState>(cursorStateRef.current)
  const [navigationFailure, setNavigationFailure] = useState<EmbeddedBrowserLoadFailure | null>(
    null
  )
  const visibleTab =
    visible &&
    activeTab &&
    openTabs.includes(activeTab) &&
    (sopEnabled || (activeTab !== 'sop' && activeTab !== 'sop-detail'))
      ? activeTab
      : null
  const browserSurfaceActive = visibleTab === 'browser' || hiddenHost
  const canOpenCurrentUrlExternally = currentUrl
    ? /^https?:\/\//i.test(currentUrl) || Boolean(localPathFromFileUrl(currentUrl))
    : false
  const visibleSideChatSessionId = visibleTab ? sideChatSessionIdFromTab(visibleTab) : null
  const visibleSideChatLoadingState =
    visibleTab && isSideChatLoadingTab(visibleTab) ? sideChatLoadingTabs[visibleTab] : null
  const sideChatPanelTabs = openTabs.filter(isSideChatPanelTab)
  const sideChatTabTitles = new Map(
    sideChatPanelTabs.map((tab, index) => {
      const sideSessionId = sideChatSessionIdFromTab(tab)
      return [
        tab,
        (sideSessionId ? sideChatTitlesBySession[sideSessionId]?.trim() : '') ||
          sideChatTitle(t, sideChatTabIndexes[tab] ?? index + 1)
      ]
    })
  )
  const hasSideChatPanelTabs = sideChatPanelTabs.length > 0
  const reserveTitlebarControls =
    reserveWindowControlsInset && document.documentElement.dataset.platform === 'darwin'
  const browserLoadFailure = visibleTab === 'browser' ? navigationFailure : null

  useEffect(() => {
    currentUrlRef.current = currentUrl
  }, [currentUrl])

  const updateCursorState = useCallback((patch: Partial<BrowserCursorState>) => {
    cursorStateRef.current = {
      ...cursorStateRef.current,
      ...patch
    }
    setCursorState(cursorStateRef.current)
  }, [])

  const hideCursor = useCallback(() => {
    if (cursorAnimationRef.current !== null) {
      cancelAnimationFrame(cursorAnimationRef.current)
      cursorAnimationRef.current = null
    }
    updateCursorState({
      visible: false,
      pressed: false,
      pulseKey: 0
    })
  }, [updateCursorState])

  const defaultCursorPoint = useCallback((): BrowserCursorPoint | null => {
    const rect = browserViewportRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    return {
      x: Math.round(rect.width * DEFAULT_CURSOR_RATIO.x),
      y: Math.round(rect.height * DEFAULT_CURSOR_RATIO.y)
    }
  }, [])

  const animateCursorTo = useCallback(
    (target: BrowserCursorPoint): Promise<void> => {
      const from = cursorStateRef.current.visible
        ? { x: cursorStateRef.current.x, y: cursorStateRef.current.y }
        : (defaultCursorPoint() ?? target)
      const durationMs = cursorDuration(from, target)
      const startedAt = performance.now()

      if (cursorAnimationRef.current !== null) {
        cancelAnimationFrame(cursorAnimationRef.current)
        cursorAnimationRef.current = null
      }

      updateCursorState({
        ...from,
        visible: true,
        pressed: false
      })

      return new Promise((resolve) => {
        const step = (now: number) => {
          const elapsed = now - startedAt
          const t = Math.min(1, elapsed / durationMs)
          const point = cursorInterpolate(easeOutCubic(t), from, target)
          updateCursorState({
            x: point.x,
            y: point.y,
            visible: true,
            pressed: false
          })
          if (t >= 1) {
            cursorAnimationRef.current = null
            resolve()
            return
          }
          cursorAnimationRef.current = requestAnimationFrame(step)
        }

        cursorAnimationRef.current = requestAnimationFrame(step)
      })
    },
    [defaultCursorPoint, updateCursorState]
  )

  const flashCursorClick = useCallback(
    async (point: BrowserCursorPoint): Promise<void> => {
      updateCursorState({
        ...point,
        visible: true,
        pressed: true,
        pulseKey: cursorStateRef.current.pulseKey + 1
      })
      await sleep(120)
      updateCursorState({ pressed: false })
      await sleep(140)
      updateCursorState({ pulseKey: 0 })
    },
    [updateCursorState]
  )

  useEffect(() => {
    return () => {
      if (cursorAnimationRef.current !== null) {
        cancelAnimationFrame(cursorAnimationRef.current)
        cursorAnimationRef.current = null
      }
      updateCursorState({
        visible: false,
        pressed: false,
        pulseKey: 0
      })
    }
  }, [updateCursorState])

  useEffect(() => {
    if (visible && visibleTab === 'browser') return
    hideCursor()
  }, [hideCursor, visible, visibleTab])

  useEffect(() => {
    const unsubscribe = window.api.embeddedBrowser.onEvent((event) => {
      if (event.type !== 'cursor-command' || event.sessionKey !== sessionKey) return

      const complete = (ok: boolean, error?: string) => {
        void window.api.embeddedBrowser.completeCursorCommand({
          commandId: event.commandId,
          ok,
          error
        })
      }

      void (async () => {
        try {
          if (event.action === 'move-click') {
            if (!event.point) {
              throw new Error('Missing cursor target point.')
            }
            const point = {
              x: event.point.x,
              y: event.point.y
            }
            await animateCursorTo(point)
            await flashCursorClick(point)
            complete(true)
            return
          }

          if (event.action === 'move') {
            if (!event.point) {
              throw new Error('Missing cursor target point.')
            }
            await animateCursorTo({
              x: event.point.x,
              y: event.point.y
            })
            complete(true)
            return
          }

          if (event.action === 'hide') {
            hideCursor()
            complete(true)
            return
          }
        } catch (error) {
          complete(false, error instanceof Error ? error.message : String(error))
        }
      })()
    })

    return unsubscribe
  }, [animateCursorTo, flashCursorClick, hideCursor, sessionKey])

  useEffect(() => {
    const element = browserViewportRef.current
    if (!element) return

    let animationFrame: number | null = null
    const reportBounds = () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
      }
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null
        const rect = element.getBoundingClientRect()
        void window.api.embeddedBrowser
          .setViewBounds({
            sessionKey,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            visible:
              browserSurfaceActive && Boolean(currentUrl) && (hiddenHost || !hasBlockingOverlay)
          })
          .catch((error) => {
            setError(error instanceof Error ? error.message : String(error), sessionKey)
          })
      })
    }

    const observer = new ResizeObserver(reportBounds)
    observer.observe(element)
    window.addEventListener('resize', reportBounds)
    reportBounds()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reportBounds)
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
      }
      void window.api.embeddedBrowser
        .setViewBounds({
          sessionKey,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          visible: false
        })
        .catch(() => {
          // The main window may already be closing.
        })
    }
  }, [browserSurfaceActive, currentUrl, hasBlockingOverlay, hiddenHost, sessionKey, setError])

  useEffect(() => {
    if (!visible || visibleTab !== 'browser') return
    void window.api.embeddedBrowser.setActiveSession(sessionKey).catch(console.error)
  }, [sessionKey, visible, visibleTab])

  useEffect(() => {
    const host = browserWebviewHostRef.current
    if (!host) return

    const webview = document.createElement('webview') as EmbeddedBrowserWebviewElement
    browserWebviewRef.current = webview
    browserWebviewDomReadyRef.current = false
    webview.className = 'h-full w-full'
    webview.style.backgroundColor = '#ffffff'
    webview.setAttribute('partition', 'persist:pichu-browser-profile-default')
    webview.setAttribute('webviewrole', 'tab')
    webview.setAttribute('allowpopups', '')
    webview.setAttribute('src', 'about:blank')
    let hasAttachedWebview = false

    const handleWebviewError = (error: unknown) => {
      setError(error instanceof Error ? error.message : String(error), sessionKey)
    }

    const handleDomReady = () => {
      browserWebviewDomReadyRef.current = true
      if (!hasAttachedWebview) {
        let webContentsId: number | undefined
        try {
          webContentsId = webview.getWebContentsId?.()
        } catch (error) {
          handleWebviewError(error)
          return
        }
        if (!webContentsId) return
        hasAttachedWebview = true
        browserWebviewContentsIdRef.current = webContentsId
        void window.api.embeddedBrowser
          .attachWebview({ sessionKey, webContentsId })
          .catch(handleWebviewError)
      }
    }

    const hideAutomationCursor = () => {
      hideCursor()
    }

    const handleStartNavigation = (event: Event) => {
      hideCursor()
      if (embeddedBrowserMainFrameEvent(event)) {
        setNavigationFailure(null)
      }
    }

    const rememberNavigation = (event: Event) => {
      hideCursor()
      const url =
        embeddedBrowserNavigationUrl(event) ||
        (browserWebviewDomReadyRef.current ? readEmbeddedBrowserWebviewUrl(webview) : null)
      if (!url) return
      setNavigationFailure(null)
      void window.api.embeddedBrowser.updateSessionUrl({ sessionKey, url }).catch(() => {
        // Main may already be tearing down this webview.
      })
    }

    const rememberLoadFailure = (event: Event) => {
      const failure = readEmbeddedBrowserLoadFailure(event, currentUrlRef.current)
      if (!failure) return
      setNavigationFailure(failure)
      setError(failure.errorDescription, sessionKey)
    }

    webview.addEventListener('dom-ready', handleDomReady)
    webview.addEventListener('focus', hideAutomationCursor)
    webview.addEventListener('did-start-navigation', handleStartNavigation)
    webview.addEventListener('did-navigate', rememberNavigation)
    webview.addEventListener('did-navigate-in-page', rememberNavigation)
    webview.addEventListener('did-fail-load', rememberLoadFailure)
    webview.addEventListener('did-fail-provisional-load', rememberLoadFailure)
    host.replaceChildren(webview)

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady)
      webview.removeEventListener('focus', hideAutomationCursor)
      webview.removeEventListener('did-start-navigation', handleStartNavigation)
      webview.removeEventListener('did-navigate', rememberNavigation)
      webview.removeEventListener('did-navigate-in-page', rememberNavigation)
      webview.removeEventListener('did-fail-load', rememberLoadFailure)
      webview.removeEventListener('did-fail-provisional-load', rememberLoadFailure)
      hideCursor()
      const webContentsId = browserWebviewContentsIdRef.current
      browserWebviewContentsIdRef.current = null
      browserWebviewDomReadyRef.current = false
      browserWebviewRef.current = null
      host.replaceChildren()
      if (webContentsId) {
        void window.api.embeddedBrowser.detachWebview({ sessionKey, webContentsId }).catch(() => {
          // Main may already be tearing down this webview.
        })
      }
    }
  }, [hideCursor, sessionKey, setError])

  const handleBrowserNavigationError = (error: unknown, url: string): void => {
    const failure = readEmbeddedBrowserLoadFailureFromError(error, url)
    if (failure) {
      setNavigationFailure(failure)
      setError(failure.errorDescription, sessionKey)
      return
    }
    setError(error instanceof Error ? error.message : String(error), sessionKey)
  }
  const navigateToAddress = (): void => {
    const targetUrl = browserAddressNavigationTarget(addressInput)
    if (!targetUrl) {
      setError(t('rightSidebar.enterValidUrl'), sessionKey)
      return
    }
    setNavigationFailure(null)
    hideCursor()
    openUrl(targetUrl, sessionKey)
    void window.api.embeddedBrowser.open({ sessionKey, url: targetUrl }).catch((error) => {
      handleBrowserNavigationError(error, targetUrl)
    })
  }

  const reloadBrowserLoadFailure = (): void => {
    const targetUrl = browserLoadFailure?.url || currentUrl
    if (!targetUrl || targetUrl === 'about:blank') return
    setNavigationFailure(null)
    hideCursor()
    openUrl(targetUrl, sessionKey)
    void window.api.embeddedBrowser.open({ sessionKey, url: targetUrl }).catch((error) => {
      handleBrowserNavigationError(error, targetUrl)
    })
  }

  const openCurrentUrlExternally = (): void => {
    if (!currentUrl || !canOpenCurrentUrlExternally) return
    const localPath = localPathFromFileUrl(currentUrl)
    if (localPath) {
      void window.api.attachments.open(localPath).catch((error) => {
        setError(error instanceof Error ? error.message : String(error), sessionKey)
      })
      return
    }
    void window.api.app.openExternal(currentUrl).catch((error) => {
      setError(error instanceof Error ? error.message : String(error), sessionKey)
    })
  }

  const attachCurrentBrowserWebview = useCallback(async (): Promise<void> => {
    const webview = browserWebviewRef.current
    if (!webview || !browserWebviewDomReadyRef.current) {
      throw new Error(t('rightSidebar.browserPageNotReady'))
    }
    const webContentsId = webview.getWebContentsId?.()
    if (!webContentsId) {
      throw new Error(t('rightSidebar.browserPageNotAttached'))
    }
    browserWebviewContentsIdRef.current = webContentsId
    await window.api.embeddedBrowser.attachWebview({ sessionKey, webContentsId })
    await window.api.embeddedBrowser.setActiveSession(sessionKey)
  }, [sessionKey, t])

  const runAttachedBrowserAction = useCallback(
    (action: () => Promise<unknown>): void => {
      hideCursor()
      void attachCurrentBrowserWebview()
        .then(action)
        .catch((error) => {
          setError(error instanceof Error ? error.message : String(error), sessionKey)
        })
    },
    [attachCurrentBrowserWebview, hideCursor, sessionKey, setError]
  )

  useEffect(() => {
    if (!browserSurfaceActive) return
    void attachCurrentBrowserWebview().catch(() => {
      // The dom-ready handler will attach once the webview is ready.
    })
  }, [attachCurrentBrowserWebview, browserSurfaceActive])

  const openEmbeddedBrowserDevTools = (): void => {
    runAttachedBrowserAction(() => window.api.embeddedBrowser.openDevTools(sessionKey))
  }

  const annotationLabels = useCallback(
    () => ({
      placeholder: t('rightSidebar.annotationPlaceholder'),
      add: t('rightSidebar.sendComment'),
      cancel: t('rightSidebar.annotationCancel'),
      hint: ''
    }),
    [t]
  )

  const setAnnotationMode = useCallback(
    async (mode: 'browse' | 'comment') => {
      try {
        if (mode === 'comment') {
          await attachCurrentBrowserWebview()
        }
        await window.api.embeddedBrowser.setAnnotationMode({
          sessionKey,
          mode,
          labels: annotationLabels()
        })
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error), sessionKey)
      }
    },
    [annotationLabels, attachCurrentBrowserWebview, sessionKey, setError]
  )

  const syncComposerBrowserComments = useCallback(
    (comments: CommentAttachmentContext[]) => {
      const browserComments = comments.filter((comment) => comment.origin === 'browser')
      const committedAnnotations = browserComments.flatMap((comment, index) => {
        const annotation = browserCommentPartToCommittedAnnotation(comment, index + 1)
        return annotation ? [annotation] : []
      })
      void window.api.embeddedBrowser
        .syncAnnotations({ sessionKey, comments: committedAnnotations })
        .catch((error) => {
          setError(error instanceof Error ? error.message : String(error))
        })
    },
    [sessionKey, setError]
  )

  useEffect(() => {
    if (!visible) return
    syncComposerBrowserComments(getLatestCommentAttachments('main'))
    const handleCommentAttachmentsChanged = (event: Event): void => {
      const detail = (
        event as CustomEvent<CommentAttachmentContext[] | CommentAttachmentsChangedEventDetail>
      ).detail
      if (!Array.isArray(detail) && detail?.target !== 'main') return
      const comments = Array.isArray(detail) ? detail : detail.comments
      syncComposerBrowserComments(comments)
    }
    window.addEventListener(
      COMPOSER_COMMENT_ATTACHMENTS_CHANGED_EVENT,
      handleCommentAttachmentsChanged
    )
    return () =>
      window.removeEventListener(
        COMPOSER_COMMENT_ATTACHMENTS_CHANGED_EVENT,
        handleCommentAttachmentsChanged
      )
  }, [syncComposerBrowserComments, visible])

  useEffect(() => {
    if (!visible) return
    const handleSelectCommentAttachment = (event: Event): void => {
      const detail = (event as CustomEvent<SelectCommentAttachmentEventDetail>).detail
      if ((detail?.target ?? 'main') !== 'main') return
      const selectedComment = detail?.comment
      if (!selectedComment || selectedComment.origin !== 'browser') return
      const selectedLabel =
        typeof detail.label === 'number' && Number.isInteger(detail.label) && detail.label > 0
          ? detail.label
          : undefined
      const browserComments = getLatestCommentAttachments('main').filter(
        (comment) => comment.origin === 'browser'
      )
      const selectedIndex = browserComments.findIndex(
        (comment) => comment.commentId === selectedComment.commentId
      )
      const selectedAnnotation = browserCommentPartToCommittedAnnotation(
        selectedComment,
        selectedLabel ?? (selectedIndex >= 0 ? selectedIndex + 1 : browserComments.length + 1)
      )
      if (!selectedAnnotation) return
      const committedAnnotations = browserComments
        .flatMap((comment, index) => {
          const annotation = browserCommentPartToCommittedAnnotation(comment, index + 1)
          return annotation ? [annotation] : []
        })
        .filter((annotation) => annotation.annotationId !== selectedAnnotation.annotationId)
      committedAnnotations.push(selectedAnnotation)
      setActiveTab('browser', sessionKey)
      void window.api.embeddedBrowser
        .syncAnnotations({ sessionKey, comments: committedAnnotations })
        .then(() =>
          window.api.embeddedBrowser.setAnnotationMode({
            sessionKey,
            mode: 'comment',
            labels: annotationLabels()
          })
        )
        .then(() =>
          window.api.embeddedBrowser.selectAnnotation({
            sessionKey,
            annotationId: selectedAnnotation.annotationId
          })
        )
        .catch((error) => {
          setError(error instanceof Error ? error.message : String(error), sessionKey)
        })
    }
    window.addEventListener(COMPOSER_SELECT_COMMENT_ATTACHMENT_EVENT, handleSelectCommentAttachment)
    return () =>
      window.removeEventListener(
        COMPOSER_SELECT_COMMENT_ATTACHMENT_EVENT,
        handleSelectCommentAttachment
      )
  }, [annotationLabels, sessionKey, setActiveTab, setError, visible])

  const exitAnnotationMode = useCallback(() => {
    void setAnnotationMode('browse')
  }, [setAnnotationMode])

  useEffect(() => {
    if (!visible || visibleTab !== 'browser' || annotationMode !== 'comment') return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      exitAnnotationMode()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [annotationMode, exitAnnotationMode, visible, visibleTab])

  const sendBrowserAnnotation = useCallback(
    async (
      annotationInput: AddChatCommentEventDetail,
      attachments: MessageAttachment[] = []
    ): Promise<void> => {
      const comment = normalizeCommentAttachmentInput(annotationInput)
      if (!comment) return

      const messageParts = composeMessageParts([], [], [], [comment])
      const agentPrompt = composePromptWithContexts('', [], [], [comment])
      await sendPrompt(comment.preview, annotationCwd, attachments, {
        agentText: agentPrompt,
        parts: messageParts
      })
    },
    [annotationCwd, sendPrompt]
  )

  useEffect(() => {
    const unsubscribe = window.api.embeddedBrowser.onEvent((event) => {
      if (event.type !== 'annotation-submitted' || event.sessionKey !== sessionKey) return

      const queuedSend = annotationSendQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const { annotation } = event
          const screenshotAttachment = annotation.screenshot
            ? await window.api.attachments
                .saveCommentScreenshot({
                  name: `browser-annotation-${annotation.annotationId}.png`,
                  mimeType: 'image/png',
                  data: annotation.screenshot.data
                })
                .catch(() => null)
            : null
          const pastedImageAttachments = (
            await Promise.all(
              (annotation.pastedImages ?? []).map((image, index) =>
                window.api.attachments
                  .saveClipboardImage({
                    name: image.name || `browser-annotation-paste-${index + 1}.png`,
                    mimeType: image.mimeType,
                    data: image.data
                  })
                  .catch(() => null)
              )
            )
          ).filter((attachment): attachment is MessageAttachment => Boolean(attachment))
          const messageAttachments = pastedImageAttachments

          const annotationInput: AddChatCommentEventDetail = {
            origin: 'browser',
            title: t('chat.comment.browser'),
            preview: annotation.comment,
            content: [{ content_type: 'text', text: annotation.comment }],
            localBrowserContext: {
              pageUrl: annotation.anchor.pageUrl,
              pageTitle: annotation.anchor.title,
              framePath: annotation.anchor.framePath,
              frameUrl: annotation.anchor.frameUrl,
              targetDescription: annotation.anchor.targetDescription,
              targetImmediateText: annotation.anchor.targetImmediateText,
              targetRole: annotation.anchor.targetRole,
              targetName: annotation.anchor.targetName,
              targetSelector: annotation.anchor.selector,
              targetPath: annotation.anchor.targetPath,
              nearbyText: annotation.anchor.nearbyText,
              documentContext: annotation.anchor.documentContext,
              isFixed: annotation.anchor.isFixed === true ? true : undefined,
              scrollContainers: annotation.anchor.scrollContainers
            },
            localBrowserCommentMetadata: {
              kind: annotation.anchor.kind,
              markerViewportPoint: annotation.anchor.viewportPoint,
              viewportSize: annotation.anchor.viewportSize
            },
            localBrowserScreenshot: screenshotAttachment?.path
              ? {
                  path: screenshotAttachment.path,
                  mimeType: 'image/png',
                  width: annotation.screenshot?.width ?? 0,
                  height: annotation.screenshot?.height ?? 0,
                  commentId: annotation.annotationId,
                  isCompact: true,
                  annotationViewportRect: annotation.screenshot?.annotationViewportRect,
                  cropViewportRect: annotation.screenshot?.cropViewportRect,
                  cropPaddingPx: annotation.screenshot?.cropPaddingPx,
                  markerViewportPoint: annotation.anchor.viewportPoint
                }
              : undefined
          }
          await sendBrowserAnnotation(annotationInput, messageAttachments)
        })

      annotationSendQueueRef.current = queuedSend.catch(() => undefined)
      void queuedSend.catch((error) => {
        setError(error instanceof Error ? error.message : String(error), sessionKey)
      })
    })

    return unsubscribe
  }, [sendBrowserAnnotation, sessionKey, setError, t])

  const openSideChatTab = (): void => {
    if (!parentSessionId) return
    const loadingTab = sideChatLoadingTabId()
    startSideChatLoading(
      loadingTab,
      {
        parentSessionId,
        cwd: sideChatCwd
      },
      sessionKey
    )
    void openSideChatForParent({
      parentSessionId,
      forceNew: true
    })
      .then((result) => {
        const current = getEmbeddedBrowserStateForSession(
          useEmbeddedBrowserStore.getState(),
          sessionKey
        )
        if (!current.openTabs.includes(loadingTab)) {
          void closeSideChatSession(result.sessionId).catch(console.error)
          return
        }
        replaceTab(loadingTab, sideChatTabId(result.sessionId), sessionKey)
      })
      .catch((error) => {
        failSideChatLoading(
          loadingTab,
          error instanceof Error ? error.message : String(error),
          sessionKey
        )
        console.error(error)
      })
  }

  const closePanelTab = (tab: EmbeddedBrowserTab): void => {
    closeTab(tab, sessionKey)
    const sideSessionId = sideChatSessionIdFromTab(tab)
    if (sideSessionId) {
      void closeSideChatSession(sideSessionId).catch(console.error)
    }
  }

  const launcherItems: SidebarLauncherItem[] = [
    {
      id: 'browser',
      icon: Globe,
      title: t('rightSidebar.browser'),
      description: t('rightSidebar.browserDescription'),
      shortcutKey: 'T',
      onSelect: () => setActiveTab('browser', sessionKey)
    },
    {
      id: 'files',
      icon: Folders,
      title: t('rightSidebar.files'),
      description: t('rightSidebar.filesDescription'),
      shortcutKey: 'P',
      onSelect: () => setActiveTab('files', sessionKey)
    },
    ...(parentSessionId
      ? [
          {
            id: 'side-chat',
            icon: MessageSquarePlus,
            title: t('rightSidebar.sideChat'),
            description: t('rightSidebar.sideChatDescription'),
            shortcutKey: 'S',
            shortcutModifier: 'option',
            onSelect: openSideChatTab
          } satisfies SidebarLauncherItem
        ]
      : []),
    ...(sopEnabled
      ? [
          {
            id: 'sop',
            icon: Route,
            title: t('rightSidebar.sop'),
            description: t('rightSidebar.sopDescription'),
            shortcutKey: 'S',
            shortcutModifier: 'option',
            onSelect: () => setActiveTab('sop', sessionKey)
          } satisfies SidebarLauncherItem
        ]
      : [])
  ]

  const showLauncherMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const availableLauncherItems = launcherItems.filter(
      (item) =>
        (item.id !== 'browser' || !openTabs.includes('browser')) &&
        (item.id !== 'files' || !openTabs.includes('files'))
    )
    void window.api.app
      .showContextMenu({
        x: Math.round(rect.left),
        y: Math.round(rect.bottom + 4),
        items: [
          ...availableLauncherItems.map((item) => ({
            id: `launcher:${item.id}`,
            label: item.title,
            enabled: item.disabled !== true
          })),
          ...(hasSideChatPanelTabs
            ? [
                ...(availableLauncherItems.length > 0 ? [{ type: 'separator' as const }] : []),
                ...sideChatPanelTabs.map((tab) => ({
                  id: `tab:${tab}`,
                  label: sideChatTabTitles.get(tab) ?? t('sideChat.title')
                }))
              ]
            : [])
        ]
      })
      .then((selectedId) => {
        if (!selectedId) return
        if (selectedId.startsWith('launcher:')) {
          const itemId = selectedId.slice('launcher:'.length)
          launcherItems.find((item) => item.id === itemId)?.onSelect?.()
          return
        }
        if (selectedId.startsWith('tab:')) {
          const tab = selectedId.slice('tab:'.length) as EmbeddedBrowserTab
          if (!openTabs.includes(tab)) return
          const sideSessionId = sideChatSessionIdFromTab(tab)
          setActiveTab(tab, sessionKey)
          if (sideSessionId) {
            clearSideChatUnread(sideSessionId)
          }
        }
      })
      .catch(console.error)
  }

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-l border-border/70 bg-card">
      <div
        className={cn(
          'relative flex h-10 shrink-0 items-center bg-card pr-20',
          reserveTitlebarControls ? 'pointer-events-none pl-[9.25rem]' : 'drag-region pl-2'
        )}
      >
        <div className="no-drag absolute inset-y-0 right-0 w-20" aria-hidden="true" />
        <div
          className={cn(
            'relative min-w-0 flex-1 overflow-hidden',
            reserveTitlebarControls ? 'pointer-events-auto drag-region' : ''
          )}
        >
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-3 bg-linear-to-r from-card to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-5 bg-linear-to-l from-card to-transparent" />
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {openTabs.map((tab) => {
              if (!sopEnabled && (tab === 'sop' || tab === 'sop-detail')) return null
              const selected = tab === visibleTab
              const Icon = tabIcon(tab)
              const sideSessionId = sideChatSessionIdFromTab(tab)
              const title = tabLabel(
                tab,
                t,
                pageTitle,
                sopDetail?.title,
                isSideChatPanelTab(tab) ? sideChatTabTitles.get(tab) : null
              )
              return (
                <div
                  key={tab}
                  className={`flex h-7 min-w-24 max-w-44 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] transition ${
                    selected
                      ? 'bg-card-muted font-semibold text-foreground'
                      : 'font-medium text-muted-foreground hover:bg-card-muted hover:text-foreground'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab(tab, sessionKey)
                      if (sideSessionId) {
                        clearSideChatUnread(sideSessionId)
                      }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1.5"
                  >
                    <Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
                    <span className="truncate">{title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      closePanelTab(tab)
                    }}
                    className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background/80 hover:text-foreground"
                    aria-label={t('rightSidebar.closeTab', {
                      name: title
                    })}
                  >
                    <X className="size-3" strokeWidth={2} />
                  </button>
                </div>
              )
            })}
            <div className="mr-10 flex h-7 shrink-0 items-center">
              <button
                type="button"
                onClick={showLauncherMenu}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-card-muted hover:text-foreground"
                aria-label={t('rightSidebar.addTab')}
              >
                <Plus className="size-4" strokeWidth={1.8} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {visibleTab === 'browser' ? (
        <div className="relative flex h-10 shrink-0 items-center gap-1.5 border-b border-border/70 px-3">
          <button
            type="button"
            disabled={!canGoBack}
            onClick={() => {
              runAttachedBrowserAction(() => window.api.embeddedBrowser.goBack(sessionKey))
            }}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-card-muted hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            aria-label={t('rightSidebar.goBack')}
          >
            <ArrowLeft className="size-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            disabled={!canGoForward}
            onClick={() => {
              runAttachedBrowserAction(() => window.api.embeddedBrowser.goForward(sessionKey))
            }}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-card-muted hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            aria-label={t('rightSidebar.goForward')}
          >
            <ArrowRight className="size-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (loading) {
                runAttachedBrowserAction(() => window.api.embeddedBrowser.stop(sessionKey))
              } else if (currentUrl) {
                runAttachedBrowserAction(() => window.api.embeddedBrowser.reload(sessionKey))
              }
            }}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-card-muted hover:text-foreground"
            aria-label={loading ? t('rightSidebar.stopLoading') : t('rightSidebar.reloadPage')}
          >
            {loading ? (
              <span className="block size-3 rounded-[2px] bg-current" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5" strokeWidth={1.8} />
            )}
          </button>
          <form
            className="group/address relative min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault()
              navigateToAddress()
            }}
          >
            <label className="sr-only" htmlFor="embedded-browser-address">
              {t('rightSidebar.browserAddress')}
            </label>
            <input
              id="embedded-browser-address"
              value={addressInput}
              onFocus={hideCursor}
              onChange={(event) => setAddressInput(event.target.value, sessionKey)}
              placeholder={t('rightSidebar.enterUrl')}
              spellCheck={false}
              className={`h-7 w-full rounded-md border py-0 pr-8 pl-2 text-center text-[12px] text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:bg-card-muted focus:text-left ${
                loading
                  ? 'border-codex-blue-300/45 bg-codex-blue-50/35 dark:border-codex-blue-300/35 dark:bg-codex-blue-900/20'
                  : 'border-transparent bg-transparent focus:border-border'
              }`}
            />
            <button
              type="button"
              disabled={!canOpenCurrentUrlExternally}
              onClick={openCurrentUrlExternally}
              className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-md text-muted-foreground opacity-0 transition hover:bg-card hover:text-foreground disabled:pointer-events-none disabled:opacity-0 group-hover/address:opacity-100 group-focus-within/address:opacity-100"
              aria-label={t('rightSidebar.openCurrentPageExternally')}
            >
              <ExternalLink className="size-3.5" strokeWidth={1.8} />
            </button>
          </form>
          <button
            type="button"
            disabled={annotationMode !== 'comment' && (!currentUrl || currentUrl === 'about:blank')}
            onClick={() =>
              annotationMode === 'comment' ? exitAnnotationMode() : setAnnotationMode('comment')
            }
            className={`flex h-7 items-center justify-center rounded-md transition disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground ${
              annotationMode === 'comment'
                ? 'gap-1.5 bg-codex-blue-50 px-2.5 text-codex-blue-700 hover:bg-codex-blue-100 dark:bg-codex-blue-400/15 dark:text-codex-blue-200 dark:hover:bg-codex-blue-400/20'
                : 'size-7 text-muted-foreground hover:bg-card-muted hover:text-foreground'
            }`}
            aria-label={
              annotationMode === 'comment'
                ? t('rightSidebar.exitAnnotationMode')
                : t('rightSidebar.annotatePage')
            }
            aria-pressed={annotationMode === 'comment'}
          >
            <SquareDashedMousePointer className="size-4" strokeWidth={1.8} />
            {annotationMode === 'comment' ? (
              <span className="whitespace-nowrap text-[12px] font-semibold">
                {t('rightSidebar.stopAnnotating')}
              </span>
            ) : null}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={!currentUrl || currentUrl === 'about:blank'}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-card-muted hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                aria-label={t('rightSidebar.browserMoreActions')}
              >
                <MoreVertical className="size-4" strokeWidth={1.8} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="w-44">
              <DropdownMenuItem onSelect={openEmbeddedBrowserDevTools}>
                {t('rightSidebar.openDevTools')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {loading ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-codex-blue-300/15">
              <div className="pichu-browser-loading-line h-full w-1/2 rounded-full bg-codex-blue-400 shadow-[0_0_10px_rgb(2_133_255/0.45)]" />
            </div>
          ) : null}
        </div>
      ) : null}

      {visibleTab === 'browser' && lastError && !browserLoadFailure ? (
        <div className="shrink-0 border-b border-destructive/15 bg-destructive/5 px-3 py-2 text-[12px] leading-relaxed text-destructive">
          {lastError}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={browserViewportRef}
          className={`absolute inset-0 bg-card ${browserSurfaceActive ? '' : 'hidden'}`}
        >
          <div ref={browserWebviewHostRef} className="absolute inset-0" />
          {browserLoadFailure ? (
            <div className="absolute inset-0 z-10 overflow-auto bg-card">
              <div className="mx-auto flex min-h-full w-full max-w-[64rem] flex-col items-center px-[clamp(1.5rem,5%,2rem)] pt-[clamp(4.5rem,14vh,8rem)] pb-14 text-foreground">
                <div className="w-full max-w-[31rem] min-w-0">
                  <GlobeX className="mb-7 size-8 text-codex-blue-600" strokeWidth={1.7} />
                  <h2 className="text-[20px] font-semibold leading-tight">
                    {t('rightSidebar.browserLoadFailedTitle')}
                  </h2>
                  <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
                    {browserLoadFailure.errorDescription === 'ERR_CONNECTION_REFUSED'
                      ? t('rightSidebar.browserLoadFailedRefused', {
                          host: browserHostFromUrl(browserLoadFailure.url) ?? browserLoadFailure.url
                        })
                      : t('rightSidebar.browserLoadFailedDescription')}
                  </p>
                  <div className="mt-7 text-[13px] leading-5 text-muted-foreground">
                    <p>{t('rightSidebar.browserLoadFailedTry')}</p>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                      <li>{t('rightSidebar.browserLoadFailedCheckConnection')}</li>
                      <li>{t('rightSidebar.browserLoadFailedCheckProxy')}</li>
                    </ul>
                  </div>
                  <p className="mt-7 break-words text-[12px] font-medium text-muted-foreground">
                    {browserLoadFailure.errorDescription}
                    {browserLoadFailure.errorCode !== null
                      ? ` (${browserLoadFailure.errorCode})`
                      : ''}
                  </p>
                  <button
                    type="button"
                    onClick={reloadBrowserLoadFailure}
                    className="mt-12 inline-flex h-8 w-fit items-center rounded-md bg-card-muted px-3 text-[13px] font-semibold text-foreground transition hover:bg-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    {t('rightSidebar.browserLoadFailedReload')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {currentUrl ? (
            cursorState.visible ? (
              <div
                className="pointer-events-none absolute top-0 left-0 z-10"
                style={{
                  transform: `translate3d(${cursorState.x}px, ${cursorState.y}px, 0) scale(${cursorState.pressed ? 0.92 : 1})`,
                  transformOrigin: '2px 2px'
                }}
                aria-hidden
              >
                {cursorState.pulseKey > 0 ? (
                  <span
                    key={cursorState.pulseKey}
                    className="-translate-x-1/2 -translate-y-1/2 absolute top-0 left-0 size-10 animate-[ping_260ms_cubic-bezier(0,0,0.2,1)_1] rounded-full bg-black/25 blur-md"
                  />
                ) : null}
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 28 28"
                  fill="none"
                  aria-hidden="true"
                  focusable="false"
                  className="drop-shadow-[0_5px_10px_rgba(0,0,0,0.4)]"
                >
                  <path
                    d="M5.5 3.75V22.25L10.88 16.9L14.05 24.05L17.35 22.58L14.18 15.45H21.75L5.5 3.75Z"
                    fill="#050505"
                    stroke="#ffffff"
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            ) : null
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <RotateCcw className="size-3.5 opacity-60" strokeWidth={1.8} />
                {t('rightSidebar.blankPage')}
              </span>
            </div>
          )}
        </div>

        {visibleTab === 'files' ? (
          <div className="absolute inset-0 bg-card">
            <SessionFilePanel showHeader={false} className="h-full" />
          </div>
        ) : null}
        {visibleTab === 'sop' ? (
          <div className="absolute inset-0 bg-card">
            <SavedSopPanel
              onOpenSop={(detail) => {
                setSopDetail(detail, sessionKey)
              }}
            />
          </div>
        ) : null}
        {visibleTab === 'sop-detail' ? (
          <div className="absolute inset-0 bg-card">
            <SavedSopDetailPanel detail={sopDetail} />
          </div>
        ) : null}
        {visibleSideChatSessionId ? (
          <div className="absolute inset-0 bg-card">
            <SideChatPanel
              cwd={sideChatCwd}
              parentSessionId={parentSessionId}
              sideSessionId={visibleSideChatSessionId}
            />
          </div>
        ) : null}
        {visibleSideChatLoadingState ? (
          <div className="absolute inset-0 flex items-center justify-center bg-card px-8 text-center">
            <div className="max-w-[280px]">
              <div className="mx-auto mb-3 flex size-9 items-center justify-center rounded-lg bg-card-muted text-muted-foreground">
                {visibleSideChatLoadingState.error ? (
                  <MessageSquarePlus className="size-4" strokeWidth={1.8} />
                ) : (
                  <LoaderCircle className="size-4 animate-spin" strokeWidth={1.8} />
                )}
              </div>
              <div className="text-[14px] font-semibold text-foreground">
                {visibleSideChatLoadingState.error
                  ? t('sideChat.startFailed')
                  : t('sideChat.starting')}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                {visibleSideChatLoadingState.error
                  ? visibleSideChatLoadingState.error
                  : t('sideChat.startingDescription')}
              </p>
              {visibleSideChatLoadingState.error ? (
                <button
                  type="button"
                  onClick={openSideChatTab}
                  className="mt-4 inline-flex h-8 items-center justify-center rounded-md bg-foreground px-3 text-[12px] font-semibold text-background transition hover:bg-foreground/90"
                >
                  {t('sideChat.startNew')}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {visibleTab === null ? (
          <div className="absolute inset-0 flex items-center justify-center bg-card px-9 py-10">
            <div
              className={cn(
                'drag-region absolute top-0 right-20 h-(--titlebar-height)',
                reserveTitlebarControls ? 'left-[9.25rem]' : 'left-0'
              )}
            />
            <div className="flex w-full max-w-[560px] flex-col gap-1">
              {launcherItems.map((item) => (
                <SidebarLauncherRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
