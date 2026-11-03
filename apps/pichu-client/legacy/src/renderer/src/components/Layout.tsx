import type {
  FocusChatComposerEventDetail,
  OpenSideChatEventDetail
} from '@renderer/components/chat/chat-composer-types'
import {
  COMPOSER_FOCUS_EVENT,
  SIDE_CHAT_OPEN_EVENT
} from '@renderer/components/chat/composer-events'
import { EmbeddedBrowserPanel } from '@renderer/components/EmbeddedBrowserPanel'
import { SessionFilePanel } from '@renderer/components/SessionFilePanel'
import { SessionSearchModal } from '@renderer/components/SessionSearchModal'
import { TeamPanel } from '@renderer/components/TeamPanel'
import { copyTextToClipboard } from '@renderer/lib/clipboard'
import { useI18n } from '@renderer/lib/i18n'
import {
  getEmbeddedBrowserStateForSession,
  initEmbeddedBrowserEvents,
  isSideChatTab,
  sideChatLoadingTabId,
  sideChatSessionIdFromTab,
  sideChatTabId,
  useEmbeddedBrowserStore
} from '@renderer/stores/embedded-browser-store'
import { useFeatureGateStore } from '@renderer/stores/feature-gate-store'
import { initPluginEvents, usePluginStore } from '@renderer/stores/plugin-store'
import type { SessionIndexEntry } from '@renderer/stores/session-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useSideChatStore } from '@renderer/stores/side-chat-store'
import { useTeamStore } from '@renderer/stores/team-store'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FolderOpen,
  Info,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelRight,
  Search,
  SquarePen,
  X
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { AppHotkeyCommand } from '../../../shared/app-hotkeys'
import type { AutoUpdateState } from '../../../shared/auto-update'
import { SESSION_CONTEXT_MENU_SIZE, SessionContextMenu, SessionSidebar } from './SessionSidebar'
import { clampMenuPosition, MenuSurface, useDismissableMenu } from './ui/menu'
import { SidebarProvider } from './ui/sidebar'
import { SystemToast, Toast, type ToastVariant, ToastViewport } from './ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

type SessionSwitchDirection = 'previous' | 'next'
type TitleSessionMenuState = {
  entry: SessionIndexEntry
  x: number
  y: number
}
type ShareToastState = {
  id: number
  title: string
  description?: string
  variant: ToastVariant
}
type ArchiveToastState = {
  id: number
  sessionId: string
}

const PLUGIN_MARKETPLACE_REFRESH_INTERVAL_MS = 60 * 60 * 1000

function scheduleSideChatComposerFocus(): void {
  const dispatchFocus = (): void => {
    window.dispatchEvent(
      new CustomEvent<FocusChatComposerEventDetail>(COMPOSER_FOCUS_EVENT, {
        detail: { target: 'side' }
      })
    )
  }

  dispatchFocus()
  window.requestAnimationFrame(() => {
    dispatchFocus()
    window.requestAnimationFrame(dispatchFocus)
  })
  window.setTimeout(dispatchFocus, 100)
}
const LEFT_SIDEBAR_DEFAULT_WIDTH = 260
const LEFT_SIDEBAR_MIN_WIDTH = 230
const LEFT_SIDEBAR_MAX_WIDTH = 360
const LEFT_SIDEBAR_COLLAPSE_OVERSHOOT = 100
const RIGHT_PANEL_MIN_WIDTH = 300
const MAIN_CONTENT_MIN_WIDTH = 360
const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'pichu:rightPanelWidth:v2'

function compactUserPath(path: string): string {
  const homePrefix = path.match(/^\/(?:Users|home)\/[^/]+(?=\/|$)/)?.[0]
  if (!homePrefix) return path
  if (path === homePrefix) return '~'
  return `~${path.slice(homePrefix.length)}`
}

function getRightPanelMaxWidth(viewportWidth: number, visibleLeftSidebarWidth: number): number {
  return Math.max(
    RIGHT_PANEL_MIN_WIDTH,
    viewportWidth - visibleLeftSidebarWidth - MAIN_CONTENT_MIN_WIDTH
  )
}

function clampRightPanelWidth(
  width: number,
  viewportWidth: number,
  visibleLeftSidebarWidth: number
): number {
  return Math.min(
    getRightPanelMaxWidth(viewportWidth, visibleLeftSidebarWidth),
    Math.max(RIGHT_PANEL_MIN_WIDTH, width)
  )
}

function getDefaultRightPanelWidth(viewportWidth: number, visibleLeftSidebarWidth: number): number {
  return clampRightPanelWidth(Math.round(viewportWidth / 2), viewportWidth, visibleLeftSidebarWidth)
}

function readStoredRightPanelWidth(viewportWidth: number, visibleLeftSidebarWidth: number): number {
  const fallbackWidth = getDefaultRightPanelWidth(viewportWidth, visibleLeftSidebarWidth)
  try {
    const rawStoredWidth = window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY)
    if (rawStoredWidth === null) return fallbackWidth
    const storedWidth = Number(rawStoredWidth)
    if (!Number.isFinite(storedWidth)) return fallbackWidth
    return clampRightPanelWidth(storedWidth, viewportWidth, visibleLeftSidebarWidth)
  } catch {
    return fallbackWidth
  }
}

function hasStoredRightPanelWidth(): boolean {
  try {
    const rawStoredWidth = window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY)
    return rawStoredWidth !== null && Number.isFinite(Number(rawStoredWidth))
  } catch {
    return false
  }
}

function writeStoredRightPanelWidth(width: number): void {
  try {
    window.localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(Math.round(width)))
  } catch {
    // Best-effort UI preference.
  }
}

function getSessionSortTime(entry: SessionIndexEntry, sortKey: 'updated' | 'created'): number {
  const value = sortKey === 'created' ? entry.createdAt : entry.updatedAt || entry.createdAt
  return new Date(value).getTime()
}

function sortSessionIndex(
  entries: SessionIndexEntry[],
  sortKey: 'updated' | 'created'
): SessionIndexEntry[] {
  return [...entries].sort(
    (a, b) => getSessionSortTime(b, sortKey) - getSessionSortTime(a, sortKey)
  )
}

type DevInstancePathRowProps = {
  label: string
  value: string
  description?: string
  meta?: string
  copied?: boolean
  onCopy?: () => void
  onOpenFolder?: () => void
  openFolderLabel?: string
  copyLabel?: string
  copiedLabel?: string
  actionLabel?: string
  actionIcon?: React.ReactNode
  onAction?: () => void
}

function DevInstancePathRow({
  label,
  value,
  description,
  meta,
  copied,
  onCopy,
  onOpenFolder,
  openFolderLabel,
  copyLabel,
  copiedLabel,
  actionLabel,
  actionIcon,
  onAction
}: DevInstancePathRowProps): React.JSX.Element {
  return (
    <div className="grid gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <span className="shrink-0">{label}</span>
        {description ? (
          <Tooltip>
            <TooltipTrigger
              className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-card-muted hover:text-foreground focus-visible:bg-card-muted focus-visible:text-foreground focus-visible:outline-none"
              aria-label={description}
            >
              <Info className="size-3" strokeWidth={1.8} />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[300px] text-left">
              {description}
            </TooltipContent>
          </Tooltip>
        ) : null}
        {meta ? <span className="min-w-0 truncate font-normal">{meta}</span> : null}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0 break-all rounded-md bg-card-muted/45 px-2 py-1.5 font-mono text-[11px] leading-4 text-foreground">
          {value}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onOpenFolder && openFolderLabel ? (
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-card-muted hover:text-foreground focus-visible:bg-card-muted focus-visible:text-foreground focus-visible:outline-none"
              aria-label={openFolderLabel}
              onClick={onOpenFolder}
            >
              <FolderOpen className="size-3.5" strokeWidth={1.8} />
            </button>
          ) : null}
          {onCopy && copyLabel && copiedLabel ? (
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-card-muted hover:text-foreground focus-visible:bg-card-muted focus-visible:text-foreground focus-visible:outline-none"
              aria-label={copied ? copiedLabel : copyLabel}
              onClick={onCopy}
            >
              {copied ? (
                <Check className="size-3.5 text-success" strokeWidth={1.9} />
              ) : (
                <Copy className="size-3.5" strokeWidth={1.8} />
              )}
            </button>
          ) : null}
          {onAction && actionLabel ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-card-muted hover:text-foreground focus-visible:bg-card-muted focus-visible:text-foreground focus-visible:outline-none"
                  aria-label={actionLabel}
                  onClick={onAction}
                >
                  {actionIcon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{actionLabel}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function Layout(): React.JSX.Element {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(LEFT_SIDEBAR_DEFAULT_WIDTH)
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    readStoredRightPanelWidth(window.innerWidth, LEFT_SIDEBAR_DEFAULT_WIDTH)
  )
  const [rightPanelMaximized, setRightPanelMaximized] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [resizingSidebar, setResizingSidebar] = useState(false)
  const [titleSessionMenu, setTitleSessionMenu] = useState<TitleSessionMenuState | null>(null)
  const [titleRenamingSessionId, setTitleRenamingSessionId] = useState<string | null>(null)
  const [titleRenameValue, setTitleRenameValue] = useState('')
  const [shareToast, setShareToast] = useState<ShareToastState | null>(null)
  const [archiveToast, setArchiveToast] = useState<ArchiveToastState | null>(null)
  const [autoUpdateState, setAutoUpdateState] = useState<AutoUpdateState | null>(null)
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null)
  const [devInstancePanelOpen, setDevInstancePanelOpen] = useState(false)
  const [copiedDevInstancePath, setCopiedDevInstancePath] = useState<string | null>(null)
  const reduceMotion = useReducedMotion()
  const titleSessionMenuRef = useRef<HTMLDivElement | null>(null)
  const titleRenameInputRef = useRef<HTMLInputElement | null>(null)
  const devInstancePanelRef = useRef<HTMLDivElement | null>(null)
  const wasRightSidebarOpenRef = useRef(false)
  const rightPanelWidthRef = useRef(rightPanelWidth)
  const rightPanelUserSizedRef = useRef(hasStoredRightPanelWidth())
  const location = useLocation()
  const navigate = useNavigate()
  const resetConversation = useSessionStore((state) => state.resetConversation)
  const sessionId = useSessionStore((state) => state.sessionId)
  const activeSessionEntry = useSessionStore(
    (state) => state.sessionIndex.find((entry) => entry.sessionId === state.sessionId) ?? null
  )
  const activeSessionTitle = activeSessionEntry?.title.trim() ?? ''
  const loadSessionIndex = useSessionStore((state) => state.loadSessionIndex)
  const archiveSession = useSessionStore((state) => state.archiveSession)
  const markSessionUnread = useSessionStore((state) => state.markSessionUnread)
  const clearSessionUnread = useSessionStore((state) => state.clearSessionUnread)
  const toggleSessionPinned = useSessionStore((state) => state.toggleSessionPinned)
  const sessionIndexSortKey = useSessionStore((state) => state.sessionIndexSortKey)
  const unreadSessionIds = useSessionStore((state) => state.unreadSessionIds)
  const filePanelOpen = useSessionStore((state) => state.filePanelOpen)
  const toggleFilePanel = useSessionStore((state) => state.toggleFilePanel)
  const activeBrowserSessionKey = useEmbeddedBrowserStore((state) => state.activeSessionKey)
  const liveBrowserSessionKeys = useEmbeddedBrowserStore((state) => state.liveSessionKeys)
  const browserStatesBySessionKey = useEmbeddedBrowserStore((state) => state.statesBySessionKey)
  const browserPanelOpen = useEmbeddedBrowserStore(
    (state) => getEmbeddedBrowserStateForSession(state).open
  )
  const setActiveBrowserSession = useEmbeddedBrowserStore((state) => state.setActiveSession)
  const showBrowser = useEmbeddedBrowserStore((state) => state.show)
  const closeBrowser = useEmbeddedBrowserStore((state) => state.close)
  const setActiveBrowserTab = useEmbeddedBrowserStore((state) => state.setActiveTab)
  const replaceBrowserTab = useEmbeddedBrowserStore((state) => state.replaceTab)
  const startSideChatLoading = useEmbeddedBrowserStore((state) => state.startSideChatLoading)
  const failSideChatLoading = useEmbeddedBrowserStore((state) => state.failSideChatLoading)
  const teamPanelOpen = useTeamStore((state) => state.open)
  const toggleTeamPanel = useTeamStore((state) => state.toggleOpen)
  const openSideChatForParent = useSideChatStore((state) => state.openForParent)
  const closeSideChatSession = useSideChatStore((state) => state.closeSideChatSession)
  const queueSideChatComposerText = useSideChatStore((state) => state.queueComposerText)
  const devInstance = useSettingsStore((state) => state.devInstance)
  const devInstanceBadgeVisible = useSettingsStore((state) => state.devInstanceBadgeVisible)
  const updateDevInstanceBadgeVisible = useSettingsStore(
    (state) => state.updateDevInstanceBadgeVisible
  )
  const dataRoot = useSettingsStore((state) => state.dataRoot)
  const reloadInstalledPlugins = usePluginStore((state) => state.reloadInstalledPlugins)
  const refreshPluginMarketplaces = usePluginStore((state) => state.refreshPluginMarketplaces)
  const sopCreatorFeatureEnabled = useFeatureGateStore((state) =>
    state.isFeatureGated('sopCreator')
  )
  const isSettingsRoute = location.pathname.startsWith('/settings')
  const canUseRightSidebar = location.pathname === '/' && !isSettingsRoute
  const rightSidebarOpen =
    canUseRightSidebar && (teamPanelOpen || filePanelOpen || browserPanelOpen)
  const hasHiddenBrowserHost = liveBrowserSessionKeys.some((browserSessionKey) => {
    const browserState = browserStatesBySessionKey[browserSessionKey]
    return Boolean(browserState?.currentUrl) && browserState?.openTabs.includes('browser') === true
  })
  const showSessionTitle =
    location.pathname === '/' &&
    !isSettingsRoute &&
    !isFullScreen &&
    !rightPanelMaximized &&
    Boolean(activeSessionTitle)
  const canToggleRightSidebar = canUseRightSidebar
  const visibleLeftSidebarWidth = !isSettingsRoute && !collapsed ? leftSidebarWidth : 0
  const rightPanelResizeMaxWidth = getRightPanelMaxWidth(viewportWidth, visibleLeftSidebarWidth)
  const activeRightPanelWidth = rightPanelMaximized
    ? Math.max(RIGHT_PANEL_MIN_WIDTH, viewportWidth - visibleLeftSidebarWidth)
    : rightPanelWidth
  const closeTitleSessionMenu = useCallback(() => setTitleSessionMenu(null), [])
  const closeDevInstancePanel = useCallback(() => setDevInstancePanelOpen(false), [])
  const openSearch = useCallback(() => setSearchOpen(true), [])
  useDismissableMenu({
    open: Boolean(titleSessionMenu),
    ref: titleSessionMenuRef,
    onClose: closeTitleSessionMenu
  })
  useDismissableMenu({
    open: devInstancePanelOpen,
    ref: devInstancePanelRef,
    onClose: closeDevInstancePanel
  })

  useEffect(() => {
    if (!showSessionTitle) {
      setTitleSessionMenu(null)
      setTitleRenamingSessionId(null)
    }
  }, [showSessionTitle])

  useEffect(() => {
    if (!copiedDevInstancePath) return
    const timeout = window.setTimeout(() => setCopiedDevInstancePath(null), 1600)
    return () => window.clearTimeout(timeout)
  }, [copiedDevInstancePath])

  useEffect(() => {
    if (!titleRenamingSessionId) return
    requestAnimationFrame(() => {
      titleRenameInputRef.current?.focus()
      titleRenameInputRef.current?.select()
    })
  }, [titleRenamingSessionId])

  const copyDevInstancePath = useCallback(async (path: string) => {
    try {
      await copyTextToClipboard(path)
      setCopiedDevInstancePath(path)
    } catch (error) {
      console.error('[dev-instance] failed to copy path', error)
    }
  }, [])

  const openDevInstanceFolder = useCallback(async (path: string) => {
    try {
      await window.api.attachments.openFolder(path)
    } catch (error) {
      console.error('[dev-instance] failed to open folder', error)
    }
  }, [])

  const openSessionInspectorFromBadge = useCallback(async () => {
    try {
      await window.api.sessionInspector.openWindow()
    } catch (error) {
      console.error('[dev-instance] failed to open session inspector', error)
      setShareToast({
        id: Date.now(),
        title: t('advanced.sessionInspector.open.label'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'error'
      })
    }
  }, [t])

  const hideDevInstanceBadge = useCallback(async () => {
    try {
      await updateDevInstanceBadgeVisible(false)
      setDevInstancePanelOpen(false)
      setShareToast({
        id: Date.now(),
        title: t('layout.devInstance.hidden'),
        description: t('layout.devInstance.restoreHint'),
        variant: 'success'
      })
    } catch (error) {
      console.error('[settings] failed to hide dev instance badge', error)
    }
  }, [t, updateDevInstanceBadgeVisible])

  useEffect(() => {
    if (!shareToast) return
    const timeout = window.setTimeout(() => setShareToast(null), 3200)
    return () => window.clearTimeout(timeout)
  }, [shareToast])

  useEffect(() => {
    if (!archiveToast) return
    const timeout = window.setTimeout(() => setArchiveToast(null), 7000)
    return () => window.clearTimeout(timeout)
  }, [archiveToast])

  const toggleRightSidebar = () => {
    if (!canToggleRightSidebar) return
    if (teamPanelOpen) {
      toggleTeamPanel()
    }
    if (filePanelOpen) {
      toggleFilePanel()
    }
    if (browserPanelOpen) {
      closeBrowser()
    }
    if (!rightSidebarOpen) {
      showBrowser()
    }
  }

  const toggleRightPanelMaximized = () => {
    if (!rightSidebarOpen) return
    setRightPanelMaximized((value) => !value)
  }

  const startNewSession = useCallback(() => {
    resetConversation()
    navigate('/')
  }, [navigate, resetConversation])

  const openTitleSessionMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!activeSessionEntry) return
      event.preventDefault()
      event.stopPropagation()

      const rect = event.currentTarget.getBoundingClientRect()
      const position = clampMenuPosition({
        x: rect.left,
        y: rect.bottom + 4,
        width: SESSION_CONTEXT_MENU_SIZE.width,
        height: SESSION_CONTEXT_MENU_SIZE.height
      })
      setTitleSessionMenu({
        entry: activeSessionEntry,
        x: position.x,
        y: position.y
      })
    },
    [activeSessionEntry]
  )

  const startTitleRename = useCallback((entry: SessionIndexEntry) => {
    setTitleRenamingSessionId(entry.sessionId)
    setTitleRenameValue(entry.title || entry.sessionId)
  }, [])

  const submitTitleRename = useCallback(() => {
    if (!titleRenamingSessionId) return
    const title = titleRenameValue.trim()
    const entry = activeSessionEntry
    setTitleRenamingSessionId(null)
    if (!title || !entry || entry.sessionId !== titleRenamingSessionId || title === entry.title) {
      return
    }
    void window.api.agent
      .sessionIndexUpdateTitle(titleRenamingSessionId, title)
      .then(() => loadSessionIndex(sessionIndexSortKey))
      .catch(console.error)
  }, [
    activeSessionEntry,
    loadSessionIndex,
    sessionIndexSortKey,
    titleRenameValue,
    titleRenamingSessionId
  ])

  const cancelTitleRename = useCallback(() => {
    setTitleRenamingSessionId(null)
    setTitleRenameValue('')
  }, [])

  const renameSessionFromMenu = useCallback(
    (entry: SessionIndexEntry) => {
      startTitleRename(entry)
    },
    [startTitleRename]
  )

  const showArchivedChatsSettings = useCallback(() => {
    setArchiveToast(null)
    navigate('/settings/archived')
  }, [navigate])

  const undoArchivedSession = useCallback(
    async (sessionIdToRestore: string) => {
      try {
        await window.api.agent.sessionIndexUnarchive(sessionIdToRestore)
        await loadSessionIndex(sessionIndexSortKey)
        setArchiveToast(null)
      } catch (error) {
        console.error('[session] failed to undo archive', error)
      }
    },
    [loadSessionIndex, sessionIndexSortKey]
  )

  const archiveSessionWithToast = useCallback(
    async (entry: SessionIndexEntry) => {
      try {
        await archiveSession(entry.sessionId)
        setArchiveToast({
          id: Date.now(),
          sessionId: entry.sessionId
        })
      } catch (error) {
        console.error('[session] failed to archive session', error)
      }
    },
    [archiveSession]
  )

  const archiveSessionFromMenu = useCallback(
    (entry: SessionIndexEntry) => {
      if (!window.confirm(t('nav.removeSession'))) return
      void archiveSessionWithToast(entry)
    },
    [archiveSessionWithToast, t]
  )

  const openBrowserTab = useCallback(() => {
    navigate('/')
    if (teamPanelOpen) {
      toggleTeamPanel()
    }
    if (filePanelOpen) {
      toggleFilePanel()
    }
    showBrowser()
    setActiveBrowserTab('browser')
  }, [
    filePanelOpen,
    navigate,
    setActiveBrowserTab,
    showBrowser,
    teamPanelOpen,
    toggleFilePanel,
    toggleTeamPanel
  ])

  const openFilesTab = useCallback(() => {
    navigate('/')
    if (teamPanelOpen) {
      toggleTeamPanel()
    }
    if (filePanelOpen) {
      toggleFilePanel()
    }
    showBrowser()
    setActiveBrowserTab('files')
  }, [
    filePanelOpen,
    navigate,
    setActiveBrowserTab,
    showBrowser,
    teamPanelOpen,
    toggleFilePanel,
    toggleTeamPanel
  ])

  const openSideChatTab = useCallback(
    (
      params: {
        parentSessionId?: string
        focusComposer?: boolean
        forceNew?: boolean
        initialText?: string
        selectionText?: string
        sourceMessageId?: string
      } = {}
    ) => {
      const parentSessionId = params.parentSessionId ?? sessionId
      if (!parentSessionId) return
      const parentEntry =
        activeSessionEntry?.sessionId === parentSessionId
          ? activeSessionEntry
          : useSessionStore
              .getState()
              .sessionIndex.find((entry) => entry.sessionId === parentSessionId)
      navigate('/')
      if (teamPanelOpen) {
        toggleTeamPanel()
      }
      if (filePanelOpen) {
        toggleFilePanel()
      }
      const browserSessionKey = setActiveBrowserSession(parentSessionId)
      const existingState = getEmbeddedBrowserStateForSession(
        useEmbeddedBrowserStore.getState(),
        browserSessionKey
      )
      const existingSideChatTab =
        params.forceNew || params.initialText
          ? null
          : existingState.openTabs.find((tab) => isSideChatTab(tab))
      if (existingSideChatTab) {
        const existingSideSessionId = sideChatSessionIdFromTab(existingSideChatTab)
        if (params.selectionText && existingSideSessionId) {
          queueSideChatComposerText(
            parentSessionId,
            existingSideSessionId,
            params.selectionText,
            params.sourceMessageId
          )
        }
        setActiveBrowserTab(existingSideChatTab, browserSessionKey)
        showBrowser(browserSessionKey)
        if (params.focusComposer) {
          scheduleSideChatComposerFocus()
        }
        return
      }
      const loadingTab = sideChatLoadingTabId()
      startSideChatLoading(
        loadingTab,
        {
          parentSessionId,
          cwd: parentEntry?.cwd || ''
        },
        browserSessionKey
      )
      void openSideChatForParent({
        parentSessionId,
        initialText: params.initialText,
        forceNew: params.forceNew
      })
        .then((result) => {
          const current = getEmbeddedBrowserStateForSession(
            useEmbeddedBrowserStore.getState(),
            browserSessionKey
          )
          if (!current.openTabs.includes(loadingTab)) {
            void closeSideChatSession(result.sessionId).catch(console.error)
            return
          }
          if (params.selectionText) {
            queueSideChatComposerText(
              parentSessionId,
              result.sessionId,
              params.selectionText,
              params.sourceMessageId
            )
          }
          replaceBrowserTab(loadingTab, sideChatTabId(result.sessionId), browserSessionKey)
          if (params.focusComposer) {
            scheduleSideChatComposerFocus()
          }
        })
        .catch((error) => {
          failSideChatLoading(
            loadingTab,
            error instanceof Error ? error.message : String(error),
            browserSessionKey
          )
          console.error(error)
        })
      showBrowser(browserSessionKey)
    },
    [
      activeSessionEntry,
      closeSideChatSession,
      failSideChatLoading,
      filePanelOpen,
      navigate,
      openSideChatForParent,
      queueSideChatComposerText,
      replaceBrowserTab,
      sessionId,
      setActiveBrowserSession,
      setActiveBrowserTab,
      showBrowser,
      startSideChatLoading,
      teamPanelOpen,
      toggleFilePanel,
      toggleTeamPanel
    ]
  )

  useEffect(() => {
    const handleOpenSideChat = (event: Event): void => {
      const detail = (event as CustomEvent<OpenSideChatEventDetail>).detail
      const parentSessionId = detail?.parentSessionId ?? sessionId
      if (!parentSessionId) return
      if (detail?.selectionText) {
        openSideChatTab({
          parentSessionId,
          focusComposer: detail.focusComposer ?? true,
          forceNew: detail.forceNew ?? true,
          selectionText: detail.selectionText,
          sourceMessageId: detail.sourceMessageId
        })
        return
      }
      openSideChatTab({
        parentSessionId,
        focusComposer: detail?.focusComposer,
        initialText: detail?.initialText,
        forceNew: detail?.forceNew ?? true
      })
    }

    window.addEventListener(SIDE_CHAT_OPEN_EVENT, handleOpenSideChat)
    return () => window.removeEventListener(SIDE_CHAT_OPEN_EVENT, handleOpenSideChat)
  }, [openSideChatTab, sessionId])

  const switchSession = useCallback(
    async (direction: SessionSwitchDirection) => {
      const store = useSessionStore.getState()
      if (!store.sessionIndexLoaded) {
        await store.loadSessionIndex(store.sessionIndexSortKey)
      }

      const latestStore = useSessionStore.getState()
      const sortedSessions = sortSessionIndex(
        latestStore.sessionIndex,
        latestStore.sessionIndexSortKey
      )
      if (sortedSessions.length === 0) return

      const currentIndex = sortedSessions.findIndex(
        (entry) => entry.sessionId === latestStore.sessionId
      )
      const nextIndex =
        currentIndex === -1
          ? direction === 'next'
            ? 0
            : sortedSessions.length - 1
          : direction === 'next'
            ? (currentIndex + 1) % sortedSessions.length
            : (currentIndex - 1 + sortedSessions.length) % sortedSessions.length
      const nextSession = sortedSessions[nextIndex]
      if (!nextSession || nextSession.sessionId === latestStore.sessionId) return

      await latestStore.loadSession(nextSession.sessionId)
      navigate('/')
    },
    [navigate]
  )

  const handleHotkey = useCallback(
    (command: AppHotkeyCommand) => {
      switch (command) {
        case 'open-settings':
          navigate('/settings')
          break
        case 'new-session':
          startNewSession()
          break
        case 'open-search':
          setSearchOpen(true)
          break
        case 'toggle-sidebar':
          setCollapsed((value) => !value)
          break
        case 'open-browser-tab':
          openBrowserTab()
          break
        case 'open-files-tab':
          openFilesTab()
          break
        case 'open-side-chat-tab':
          openSideChatTab({ focusComposer: true, forceNew: true })
          break
        case 'previous-session':
          void switchSession('previous')
          break
        case 'next-session':
          void switchSession('next')
          break
        case 'hide-app':
          break
      }
    },
    [navigate, openBrowserTab, openFilesTab, openSideChatTab, startNewSession, switchSession]
  )

  const startRightPanelResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = rightPanelWidth
      let latestWidth = startWidth
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      setResizingSidebar(true)

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = startX - moveEvent.clientX
        const nextWidth = Math.min(
          rightPanelResizeMaxWidth,
          Math.max(RIGHT_PANEL_MIN_WIDTH, startWidth + delta)
        )
        latestWidth = nextWidth
        setRightPanelWidth(nextWidth)
      }

      const handlePointerUp = () => {
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        rightPanelUserSizedRef.current = true
        writeStoredRightPanelWidth(latestWidth)
        setResizingSidebar(false)
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp, { once: true })
    },
    [rightPanelResizeMaxWidth, rightPanelWidth]
  )

  useEffect(() => initEmbeddedBrowserEvents(), [])

  useEffect(() => initPluginEvents(), [])

  useEffect(() => {
    let cancelled = false
    void window.api.autoUpdate.getState().then((nextState) => {
      if (!cancelled) setAutoUpdateState(nextState)
    })
    const unsubscribe = window.api.autoUpdate.onStateChange(setAutoUpdateState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', updateViewportWidth)
    return () => window.removeEventListener('resize', updateViewportWidth)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.app
      .isFullScreen()
      .then((value) => {
        if (!cancelled) setIsFullScreen(value)
      })
      .catch(console.error)

    const unsubscribe = window.api.app.onFullScreenChange(({ isFullScreen }) => {
      setIsFullScreen(isFullScreen)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => window.api.app.onHotkey(({ command }) => handleHotkey(command)), [handleHotkey])

  useEffect(() => {
    if (!rightSidebarOpen) {
      setRightPanelMaximized(false)
    }
  }, [rightSidebarOpen])

  useEffect(() => {
    rightPanelWidthRef.current = rightPanelWidth
  }, [rightPanelWidth])

  useEffect(() => {
    const wasRightSidebarOpen = wasRightSidebarOpenRef.current
    if (!wasRightSidebarOpen && rightSidebarOpen && !rightPanelUserSizedRef.current) {
      setRightPanelWidth(getDefaultRightPanelWidth(viewportWidth, visibleLeftSidebarWidth))
    }
    if (wasRightSidebarOpen && !rightSidebarOpen && rightPanelUserSizedRef.current) {
      writeStoredRightPanelWidth(rightPanelWidthRef.current)
    }
    wasRightSidebarOpenRef.current = rightSidebarOpen
  }, [rightSidebarOpen, viewportWidth, visibleLeftSidebarWidth])

  useEffect(() => {
    setRightPanelWidth((width) => Math.min(width, rightPanelResizeMaxWidth))
  }, [rightPanelResizeMaxWidth])

  useEffect(() => {
    let cancelled = false
    const refresh = async (): Promise<void> => {
      try {
        await refreshPluginMarketplaces('startup')
      } catch {
        if (!cancelled) {
          await reloadInstalledPlugins()
        }
      }
    }

    void refresh()
    const interval = window.setInterval(
      () => void refresh(),
      PLUGIN_MARKETPLACE_REFRESH_INTERVAL_MS
    )

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [refreshPluginMarketplaces, reloadInstalledPlugins])

  useEffect(() => {
    const sessionKey = setActiveBrowserSession(sessionId)
    void window.api.embeddedBrowser.setActiveSession(sessionKey).catch(console.error)
  }, [sessionId, setActiveBrowserSession])

  const startLeftSidebarResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = leftSidebarWidth
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setResizingSidebar(true)

    let finished = false
    const finishResize = () => {
      if (finished) return
      finished = true
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      setResizingSidebar(false)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const rawWidth = startWidth + moveEvent.clientX - startX
      if (rawWidth <= LEFT_SIDEBAR_MIN_WIDTH - LEFT_SIDEBAR_COLLAPSE_OVERSHOOT) {
        setLeftSidebarWidth(LEFT_SIDEBAR_MIN_WIDTH)
        setCollapsed(true)
        finishResize()
        return
      }
      const nextWidth = Math.min(LEFT_SIDEBAR_MAX_WIDTH, Math.max(LEFT_SIDEBAR_MIN_WIDTH, rawWidth))
      setLeftSidebarWidth(nextWidth)
    }

    const handlePointerUp = () => {
      finishResize()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
  }

  const titlebarRightInset = (rightSidebarOpen ? activeRightPanelWidth : 0) + 88

  return (
    <SidebarProvider collapsed={collapsed} onCollapsedChange={setCollapsed}>
      <div className="relative flex h-full flex-col overflow-hidden bg-background text-foreground">
        <div className="pointer-events-none titlebar-safe-area absolute inset-x-0 top-0 z-[80]">
          <div
            className="drag-region absolute inset-y-0 left-0"
            style={{ right: rightSidebarOpen ? activeRightPanelWidth : 0 }}
          />
          <div className="pointer-events-auto no-drag absolute left-[82px] top-[7px] flex items-center">
            {!isSettingsRoute ? (
              <>
                <Tooltip>
                  <TooltipTrigger
                    onClick={() => {
                      setCollapsed(!collapsed)
                    }}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground"
                    aria-label={collapsed ? t('layout.expandSidebar') : t('layout.collapseSidebar')}
                  >
                    <PanelRight className="size-4 rotate-180" strokeWidth={1.8} />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {collapsed ? t('layout.expandSidebar') : t('layout.collapseSidebar')}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <motion.div
                    animate={
                      collapsed
                        ? { width: 28, opacity: 1, marginLeft: 4 }
                        : { width: 0, opacity: 0, marginLeft: 0 }
                    }
                    transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                    aria-hidden={!collapsed}
                  >
                    <TooltipTrigger
                      onClick={startNewSession}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground"
                      aria-label={t('nav.newSession')}
                      tabIndex={collapsed ? 0 : -1}
                    >
                      <SquarePen className="size-4" strokeWidth={1.8} />
                    </TooltipTrigger>
                  </motion.div>
                  <TooltipContent side="bottom">{t('nav.newSession')}</TooltipContent>
                </Tooltip>
              </>
            ) : null}
          </div>

          {!isSettingsRoute ? (
            <div
              className="pointer-events-none drag-region absolute top-[7px] flex h-7 min-w-0 items-center gap-1.5 overflow-hidden"
              style={{
                left: collapsed ? 154 : leftSidebarWidth + 18,
                right: titlebarRightInset
              }}
              aria-hidden={!showSessionTitle}
            >
              {showSessionTitle ? (
                <>
                  {titleRenamingSessionId === activeSessionEntry?.sessionId ? (
                    <form
                      className="pointer-events-auto flex min-w-0 flex-1"
                      onSubmit={(event) => {
                        event.preventDefault()
                        submitTitleRename()
                      }}
                    >
                      <input
                        ref={titleRenameInputRef}
                        value={titleRenameValue}
                        onChange={(event) => setTitleRenameValue(event.target.value)}
                        onBlur={submitTitleRename}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelTitleRename()
                          }
                        }}
                        className="h-7 min-w-0 flex-1 rounded-md border border-border/80 bg-card px-2 text-[14px] font-semibold text-foreground outline-none focus:border-border-strong focus:ring-1 focus:ring-border-strong"
                        aria-label={t('nav.context.rename')}
                      />
                    </form>
                  ) : (
                    <span
                      className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-7 text-foreground"
                      title={activeSessionTitle}
                    >
                      {activeSessionTitle}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={openTitleSessionMenu}
                    className="pointer-events-auto flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground"
                    aria-label={t('nav.sessionActions')}
                    aria-expanded={Boolean(titleSessionMenu)}
                  >
                    <MoreHorizontal className="size-4" strokeWidth={1.8} />
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          {titleSessionMenu ? (
            <SessionContextMenu
              ref={titleSessionMenuRef}
              entry={titleSessionMenu.entry}
              unread={unreadSessionIds.includes(titleSessionMenu.entry.sessionId)}
              className="pointer-events-auto fixed z-100 w-[218px]"
              style={{ left: titleSessionMenu.x, top: titleSessionMenu.y }}
              onClose={closeTitleSessionMenu}
              onTogglePinned={(entry) => {
                void toggleSessionPinned(entry.sessionId, !entry.pinned).catch(console.error)
              }}
              onRename={renameSessionFromMenu}
              onToggleUnread={(entry) => {
                if (unreadSessionIds.includes(entry.sessionId)) {
                  clearSessionUnread(entry.sessionId)
                } else {
                  markSessionUnread(entry.sessionId)
                }
              }}
              onArchive={archiveSessionFromMenu}
            />
          ) : null}
        </div>
        {!isSettingsRoute ? (
          <div
            className="pointer-events-auto no-drag absolute top-[7px] right-2 z-50 flex items-center gap-1"
            data-no-drag="true"
          >
            {rightSidebarOpen ? (
              <Tooltip>
                <TooltipTrigger
                  onClick={toggleRightPanelMaximized}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground"
                  aria-label={
                    rightPanelMaximized
                      ? t('layout.restoreRightSidebar')
                      : t('layout.maximizeRightSidebar')
                  }
                >
                  {rightPanelMaximized ? (
                    <Minimize2 className="size-4" strokeWidth={1.8} />
                  ) : (
                    <Maximize2 className="size-4" strokeWidth={1.8} />
                  )}
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {rightPanelMaximized
                    ? t('layout.restoreRightSidebar')
                    : t('layout.maximizeRightSidebar')}
                </TooltipContent>
              </Tooltip>
            ) : null}
            {canUseRightSidebar ? (
              <Tooltip>
                <TooltipTrigger
                  onClick={toggleRightSidebar}
                  aria-disabled={!canToggleRightSidebar}
                  className={`flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground ${
                    canToggleRightSidebar
                      ? ''
                      : 'cursor-default opacity-35 hover:bg-transparent hover:text-muted-foreground'
                  }`}
                  aria-label={
                    rightSidebarOpen
                      ? t('layout.collapseRightSidebar')
                      : t('layout.expandRightSidebar')
                  }
                >
                  <PanelRight className="size-4" strokeWidth={1.8} />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {rightSidebarOpen
                    ? t('layout.collapseRightSidebar')
                    : t('layout.expandRightSidebar')}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {resizingSidebar ? (
            <div className="fixed inset-0 z-50 cursor-col-resize" aria-hidden="true" />
          ) : null}
          <AnimatePresence initial={false}>
            {!isSettingsRoute && !collapsed ? (
              <motion.div
                key="left-sidebar"
                initial={reduceMotion ? false : { width: 0, opacity: 0 }}
                animate={{ width: leftSidebarWidth, opacity: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { width: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="relative h-full shrink-0 overflow-hidden"
              >
                <SessionSidebar
                  searchOpen={searchOpen}
                  onOpenSearch={openSearch}
                  onArchiveSession={archiveSessionWithToast}
                />
                <button
                  type="button"
                  aria-label={t('layout.resizeLeftSidebar')}
                  onPointerDown={startLeftSidebarResize}
                  className="no-drag absolute top-0 right-0 z-20 h-full w-1 cursor-col-resize bg-transparent transition hover:bg-border-strong/50"
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <main
            className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card ${
              isSettingsRoute ? '' : 'pt-(--titlebar-height)'
            }`}
          >
            <Outlet />
          </main>
          {(canUseRightSidebar || hasHiddenBrowserHost) &&
            liveBrowserSessionKeys.map((browserSessionKey) => {
              const isVisible =
                canUseRightSidebar &&
                browserSessionKey === activeBrowserSessionKey &&
                browserPanelOpen
              const browserState = browserStatesBySessionKey[browserSessionKey]
              const hiddenHost =
                !isVisible &&
                Boolean(browserState?.currentUrl) &&
                browserState?.openTabs.includes('browser') === true
              return (
                <motion.div
                  key={`embedded-browser-panel-${browserSessionKey}`}
                  initial={reduceMotion ? false : { width: 0, opacity: 0, x: 18 }}
                  animate={{
                    width: isVisible ? activeRightPanelWidth : hiddenHost ? 1280 : 0,
                    opacity: isVisible ? 1 : hiddenHost ? 0.001 : 0,
                    x: isVisible || hiddenHost ? 0 : 18
                  }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className={`${hiddenHost ? 'fixed top-0 left-0 h-[720px]' : 'relative h-full'} shrink-0 overflow-hidden ${
                    isVisible ? '' : 'pointer-events-none'
                  }`}
                  aria-hidden={!isVisible}
                >
                  {isVisible && !rightPanelMaximized ? (
                    <button
                      type="button"
                      aria-label={t('layout.resizeRightSidebar')}
                      onPointerDown={startRightPanelResize}
                      className="absolute top-0 left-0 z-20 h-full w-1 cursor-col-resize bg-transparent transition hover:bg-border-strong/50"
                    />
                  ) : null}
                  <EmbeddedBrowserPanel
                    sessionKey={browserSessionKey}
                    visible={isVisible}
                    hiddenHost={hiddenHost}
                    sopEnabled={sopCreatorFeatureEnabled}
                    reserveWindowControlsInset={
                      rightPanelMaximized && visibleLeftSidebarWidth === 0
                    }
                  />
                </motion.div>
              )
            })}
          <AnimatePresence initial={false}>
            {canUseRightSidebar && teamPanelOpen && !browserPanelOpen ? (
              <motion.div
                key="team-panel"
                initial={reduceMotion ? false : { width: 0, opacity: 0, x: 18 }}
                animate={{ width: activeRightPanelWidth, opacity: 1, x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { width: 0, opacity: 0, x: 18 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="relative h-full shrink-0 overflow-hidden"
              >
                {!rightPanelMaximized ? (
                  <button
                    type="button"
                    aria-label={t('layout.resizeRightSidebar')}
                    onPointerDown={startRightPanelResize}
                    className="absolute top-0 left-0 z-20 h-full w-1 cursor-col-resize bg-transparent transition hover:bg-border-strong/50"
                  />
                ) : null}
                <TeamPanel />
              </motion.div>
            ) : null}
            {canUseRightSidebar &&
            filePanelOpen &&
            sessionId &&
            !browserPanelOpen &&
            !teamPanelOpen ? (
              <motion.div
                key="file-panel"
                initial={reduceMotion ? false : { width: 0, opacity: 0, x: 18 }}
                animate={{ width: activeRightPanelWidth, opacity: 1, x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { width: 0, opacity: 0, x: 18 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="relative h-full shrink-0 overflow-hidden"
              >
                {!rightPanelMaximized ? (
                  <button
                    type="button"
                    aria-label={t('layout.resizeRightSidebar')}
                    onPointerDown={startRightPanelResize}
                    className="absolute top-0 left-0 z-20 h-full w-1 cursor-col-resize bg-transparent transition hover:bg-border-strong/50"
                  />
                ) : null}
                <SessionFilePanel />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
        {devInstance && devInstanceBadgeVisible ? (
          <div
            ref={devInstancePanelRef}
            className="pointer-events-auto no-drag absolute right-3 bottom-3 z-40 flex max-w-[min(420px,calc(100vw-24px))] items-center"
          >
            {devInstancePanelOpen ? (
              <MenuSurface className="absolute right-0 bottom-9 w-[min(520px,calc(100vw-24px))] p-3 text-left">
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-medium text-muted-foreground">
                      {t('layout.devInstanceTooltip.name')}
                    </div>
                    <div className="mt-1 rounded-md bg-card-muted/45 px-2 py-1.5 font-mono text-[11px] leading-4 text-foreground">
                      {devInstance.name}
                    </div>
                  </div>
                  <DevInstancePathRow
                    label={t('layout.devInstanceTooltip.worktreeRoot')}
                    value={compactUserPath(devInstance.worktreeRoot)}
                    copied={copiedDevInstancePath === devInstance.worktreeRoot}
                    onCopy={() => void copyDevInstancePath(devInstance.worktreeRoot)}
                    onOpenFolder={() => void openDevInstanceFolder(devInstance.worktreeRoot)}
                    openFolderLabel={t('layout.devInstance.openFolder', {
                      label: t('layout.devInstanceTooltip.worktreeRoot')
                    })}
                    copyLabel={t('layout.devInstance.copyPath', {
                      label: t('layout.devInstanceTooltip.worktreeRoot')
                    })}
                    copiedLabel={t('layout.devInstance.copiedPath', {
                      label: t('layout.devInstanceTooltip.worktreeRoot')
                    })}
                  />
                  <DevInstancePathRow
                    label={t('layout.devInstanceTooltip.dataRoot')}
                    description={t('layout.devInstance.dataRootDescription')}
                    value={compactUserPath(dataRoot)}
                    copied={copiedDevInstancePath === dataRoot}
                    onCopy={() => void copyDevInstancePath(dataRoot)}
                    onOpenFolder={() => void openDevInstanceFolder(dataRoot)}
                    openFolderLabel={t('layout.devInstance.openFolder', {
                      label: t('layout.devInstanceTooltip.dataRoot')
                    })}
                    copyLabel={t('layout.devInstance.copyPath', {
                      label: t('layout.devInstanceTooltip.dataRoot')
                    })}
                    copiedLabel={t('layout.devInstance.copiedPath', {
                      label: t('layout.devInstanceTooltip.dataRoot')
                    })}
                    actionLabel={t('advanced.sessionInspector.open.label')}
                    actionIcon={<Search className="size-3.5" strokeWidth={1.8} />}
                    onAction={() => void openSessionInspectorFromBadge()}
                  />
                  <DevInstancePathRow
                    label={t('layout.devInstanceTooltip.profile')}
                    description={t('layout.devInstance.profileDescription')}
                    value={compactUserPath(devInstance.userDataPath)}
                    copied={copiedDevInstancePath === devInstance.userDataPath}
                    onCopy={() => void copyDevInstancePath(devInstance.userDataPath)}
                    onOpenFolder={() => void openDevInstanceFolder(devInstance.userDataPath)}
                    openFolderLabel={t('layout.devInstance.openFolder', {
                      label: t('layout.devInstanceTooltip.profile')
                    })}
                    copyLabel={t('layout.devInstance.copyPath', {
                      label: t('layout.devInstanceTooltip.profile')
                    })}
                    copiedLabel={t('layout.devInstance.copiedPath', {
                      label: t('layout.devInstanceTooltip.profile')
                    })}
                  />
                </div>
              </MenuSurface>
            ) : null}
            <div className="flex h-7 min-w-0 items-center gap-0.5 overflow-hidden rounded-lg bg-white/90 px-0.5 text-[11px] font-medium text-[#1d1d1f] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.10)] dark:bg-white/9 dark:text-white/90 dark:shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.16)]">
              <button
                type="button"
                className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-2"
                aria-label={t('layout.devInstance', { path: devInstance.displayPath })}
                aria-expanded={devInstancePanelOpen}
                onClick={() => setDevInstancePanelOpen((open) => !open)}
              >
                <span className="size-1.5 shrink-0 rounded-full bg-[conic-gradient(from_35deg,#ff3b30,#ffcc00,#34c759,#0a84ff,#af52de,#ff3b30)]" />
                <span className="min-w-0 truncate">{devInstance.displayPath}</span>
              </button>
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#6e6e73] transition-colors hover:bg-black/7 hover:text-[#1d1d1f] dark:text-white/60 dark:hover:bg-white/12 dark:hover:text-white/95"
                aria-label={
                  devInstancePanelOpen
                    ? t('layout.devInstance.collapse')
                    : t('layout.devInstance.expand')
                }
                aria-expanded={devInstancePanelOpen}
                onClick={() => setDevInstancePanelOpen((open) => !open)}
              >
                {devInstancePanelOpen ? (
                  <ChevronDown className="size-3.5" strokeWidth={1.9} />
                ) : (
                  <ChevronUp className="size-3.5" strokeWidth={1.9} />
                )}
              </button>
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#6e6e73] transition-colors hover:bg-black/7 hover:text-[#1d1d1f] dark:text-white/60 dark:hover:bg-white/12 dark:hover:text-white/95"
                aria-label={t('layout.devInstance.close')}
                onClick={() => void hideDevInstanceBadge()}
              >
                <X className="size-3.5" strokeWidth={1.8} />
              </button>
            </div>
          </div>
        ) : null}
        <ToastViewport>
          {autoUpdateState?.status === 'downloaded' &&
          autoUpdateState.availableVersion !== dismissedUpdateVersion ? (
            <SystemToast
              message={t('layout.relaunchToUpdate', {
                version: autoUpdateState.availableVersion ?? ''
              })}
              detail={t('layout.updateDownloaded')}
              action={
                <button
                  type="button"
                  className="cursor-pointer font-medium text-[#0969da] hover:underline dark:text-[#58a6ff]"
                  onClick={() => void window.api.autoUpdate.install()}
                >
                  {t('layout.restart')}
                </button>
              }
              onClose={() => setDismissedUpdateVersion(autoUpdateState.availableVersion)}
              closeLabel={t('layout.closeUpdateDialog')}
            />
          ) : null}
          {archiveToast ? (
            <SystemToast
              key={archiveToast.id}
              icon={null}
              message={
                <span>
                  <button
                    type="button"
                    className="cursor-pointer text-[#0969da] underline-offset-2 hover:underline focus-visible:underline dark:text-[#58a6ff]"
                    onClick={() => void undoArchivedSession(archiveToast.sessionId)}
                  >
                    {t('archiveToast.undo')}
                  </button>{' '}
                  {t('archiveToast.orViewArchivedChatsIn')}{' '}
                  <button
                    type="button"
                    className="cursor-pointer text-[#0969da] underline-offset-2 hover:underline focus-visible:underline dark:text-[#58a6ff]"
                    onClick={showArchivedChatsSettings}
                  >
                    {t('archiveToast.settings')}
                  </button>
                </span>
              }
              onClose={() => setArchiveToast(null)}
              closeLabel={t('archiveToast.dismiss')}
              messageClassName="text-[14px] font-normal leading-5"
              className="max-w-[min(520px,calc(100vw-24px))] items-center rounded-[18px] px-3.5 py-1.5 shadow-[0_6px_24px_rgb(0_0_0_/_0.12)]"
            />
          ) : null}
          {shareToast?.variant === 'error' || shareToast?.variant === 'loading' ? (
            <Toast
              key={shareToast.id}
              title={shareToast.title}
              description={shareToast.description}
              variant={shareToast.variant}
              onClose={() => setShareToast(null)}
              closeLabel={t('nav.dismissShareToast')}
            />
          ) : shareToast ? (
            <SystemToast
              key={shareToast.id}
              message={shareToast.title}
              detail={shareToast.description}
              onClose={() => setShareToast(null)}
              closeLabel={t('nav.dismissShareToast')}
            />
          ) : null}
        </ToastViewport>
        <SessionSearchModal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onSelectSession={(selectedSessionId) => {
            void useSessionStore.getState().loadSession(selectedSessionId)
            navigate('/')
            setSearchOpen(false)
          }}
        />
      </div>
    </SidebarProvider>
  )
}
