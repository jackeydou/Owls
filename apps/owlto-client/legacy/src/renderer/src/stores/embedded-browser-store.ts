import { create } from 'zustand'
import { normalizeWebTargetUrl } from '../../../shared/web-targets'

export const EMBEDDED_BROWSER_DRAFT_SESSION_KEY = '__draft__'
// Keep recently used Browser panels mounted so their <webview> pages survive session switches.
export const MAX_RETAINED_EMBEDDED_BROWSER_SESSIONS = 8
export const MAX_LIVE_EMBEDDED_BROWSER_SESSIONS = MAX_RETAINED_EMBEDDED_BROWSER_SESSIONS

export type EmbeddedSideChatTab = `side-chat:${string}`
export type EmbeddedSideChatLoadingTab = `side-chat-loading:${string}`
export type EmbeddedBrowserTab =
  | 'browser'
  | 'files'
  | 'sop'
  | 'sop-detail'
  | EmbeddedSideChatTab
  | EmbeddedSideChatLoadingTab

const SIDE_CHAT_TAB_PREFIX = 'side-chat:'
const SIDE_CHAT_LOADING_TAB_PREFIX = 'side-chat-loading:'

export type EmbeddedSideChatLoadingState = {
  parentSessionId: string
  cwd: string
  displayIndex: number
  startedAt: string
  error: string | null
}

export function sideChatTabId(sessionId: string): EmbeddedSideChatTab {
  return `${SIDE_CHAT_TAB_PREFIX}${sessionId}`
}

export function sideChatLoadingTabId(): EmbeddedSideChatLoadingTab {
  return `${SIDE_CHAT_LOADING_TAB_PREFIX}${crypto.randomUUID()}`
}

export function isSideChatTab(tab: EmbeddedBrowserTab | null): tab is EmbeddedSideChatTab {
  return typeof tab === 'string' && tab.startsWith(SIDE_CHAT_TAB_PREFIX)
}

export function isSideChatLoadingTab(
  tab: EmbeddedBrowserTab | null
): tab is EmbeddedSideChatLoadingTab {
  return typeof tab === 'string' && tab.startsWith(SIDE_CHAT_LOADING_TAB_PREFIX)
}

export function sideChatSessionIdFromTab(tab: EmbeddedBrowserTab): string | null {
  return isSideChatTab(tab) ? tab.slice(SIDE_CHAT_TAB_PREFIX.length) || null : null
}

function isSideChatPanelTabForStore(
  tab: EmbeddedBrowserTab
): tab is EmbeddedSideChatTab | EmbeddedSideChatLoadingTab {
  return isSideChatTab(tab) || isSideChatLoadingTab(tab)
}

export type EmbeddedSopDetail = {
  sopId: string
  title: string
}

export type EmbeddedFileSelectionRequest = {
  path: string
  absolutePath: string | null
  targetLine: number | null
  requestId: number
}

export type EmbeddedBrowserSessionState = {
  open: boolean
  activeTab: EmbeddedBrowserTab | null
  openTabs: EmbeddedBrowserTab[]
  currentUrl: string | null
  pageTitle: string | null
  addressInput: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  annotationMode: 'browse' | 'comment'
  annotationCount: number
  pendingUrl: string | null
  previousUrl: string | null
  lastError: string | null
  sopDetail: EmbeddedSopDetail | null
  fileSelectionRequest: EmbeddedFileSelectionRequest | null
  sideChatTabIndexes: Partial<Record<EmbeddedSideChatTab | EmbeddedSideChatLoadingTab, number>>
  sideChatLoadingTabs: Record<EmbeddedSideChatLoadingTab, EmbeddedSideChatLoadingState>
}

export type EmbeddedBrowserStatusUpdate = {
  url: string | null
  title: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  annotationMode: 'browse' | 'comment'
  annotationCount: number
}

export type EmbeddedBrowserState = {
  activeSessionKey: string
  statesBySessionKey: Record<string, EmbeddedBrowserSessionState>
  liveSessionKeys: string[]
  setActiveSession: (sessionId: string | null) => string
  migrateDraftToSession: (sessionId: string) => void
  resetDraft: () => void
  show: (sessionKey?: string) => void
  openBlank: (sessionKey?: string) => string
  openUrl: (url: string, sessionKey?: string) => string
  loadUrlHidden: (url: string, sessionKey?: string) => string
  close: (sessionKey?: string) => void
  setActiveTab: (tab: EmbeddedBrowserTab, sessionKey?: string) => void
  requestFileSelection: (
    path: string,
    sessionKey?: string,
    targetLine?: number | null,
    absolutePath?: string | null
  ) => void
  replaceTab: (oldTab: EmbeddedBrowserTab, newTab: EmbeddedBrowserTab, sessionKey?: string) => void
  setSopDetail: (detail: EmbeddedSopDetail, sessionKey?: string) => void
  closeTab: (tab: EmbeddedBrowserTab, sessionKey?: string) => void
  startSideChatLoading: (
    tab: EmbeddedSideChatLoadingTab,
    state: Omit<EmbeddedSideChatLoadingState, 'displayIndex' | 'startedAt' | 'error'>,
    sessionKey?: string
  ) => void
  failSideChatLoading: (tab: EmbeddedSideChatLoadingTab, error: string, sessionKey?: string) => void
  setAddressInput: (value: string, sessionKey?: string) => void
  setCurrentUrl: (url: string, sessionKey?: string) => void
  setStatus: (status: EmbeddedBrowserStatusUpdate, sessionKey?: string) => void
  setError: (message: string | null, sessionKey?: string) => void
}

let embeddedBrowserEventUnsubscribe: (() => void) | null = null
let fileSelectionRequestId = 0

export function normalizeEmbeddedBrowserUrl(value: string): string | null {
  return normalizeWebTargetUrl(value)
}

function defaultSessionState(): EmbeddedBrowserSessionState {
  return {
    open: false,
    activeTab: null,
    openTabs: [],
    currentUrl: null,
    pageTitle: null,
    addressInput: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    annotationMode: 'browse',
    annotationCount: 0,
    pendingUrl: null,
    previousUrl: null,
    lastError: null,
    sopDetail: null,
    fileSelectionRequest: null,
    sideChatTabIndexes: {},
    sideChatLoadingTabs: {}
  }
}

export function getEmbeddedBrowserStateForSession(
  state: EmbeddedBrowserState,
  sessionKey = state.activeSessionKey
): EmbeddedBrowserSessionState {
  return state.statesBySessionKey[sessionKey] ?? defaultSessionState()
}

function keyForSession(sessionId: string | null): string {
  return sessionId || EMBEDDED_BROWSER_DRAFT_SESSION_KEY
}

function promoteLiveSessionKey(liveSessionKeys: string[], sessionKey: string): string[] {
  return [sessionKey, ...liveSessionKeys.filter((key) => key !== sessionKey)].slice(
    0,
    MAX_RETAINED_EMBEDDED_BROWSER_SESSIONS
  )
}

function addOpenTab(openTabs: EmbeddedBrowserTab[], tab: EmbeddedBrowserTab): EmbeddedBrowserTab[] {
  return openTabs.includes(tab) ? openTabs : [...openTabs, tab]
}

function activeTabAfterClose(
  openTabs: EmbeddedBrowserTab[],
  closingTab: EmbeddedBrowserTab,
  currentActiveTab: EmbeddedBrowserTab | null
): EmbeddedBrowserTab | null {
  const nextTabs = openTabs.filter((tab) => tab !== closingTab)
  if (currentActiveTab && nextTabs.includes(currentActiveTab)) return currentActiveTab
  return nextTabs.at(-1) ?? null
}

export const useEmbeddedBrowserStore = create<EmbeddedBrowserState>((set, get) => ({
  activeSessionKey: EMBEDDED_BROWSER_DRAFT_SESSION_KEY,
  statesBySessionKey: {
    [EMBEDDED_BROWSER_DRAFT_SESSION_KEY]: defaultSessionState()
  },
  liveSessionKeys: [EMBEDDED_BROWSER_DRAFT_SESSION_KEY],

  setActiveSession: (sessionId) => {
    const sessionKey = keyForSession(sessionId)
    set((state) => ({
      activeSessionKey: sessionKey,
      statesBySessionKey: {
        ...state.statesBySessionKey,
        [sessionKey]: state.statesBySessionKey[sessionKey] ?? defaultSessionState()
      },
      liveSessionKeys: promoteLiveSessionKey(state.liveSessionKeys, sessionKey)
    }))
    return sessionKey
  },

  migrateDraftToSession: (sessionId) => {
    const sessionKey = keyForSession(sessionId)
    if (sessionKey === EMBEDDED_BROWSER_DRAFT_SESSION_KEY) return

    set((state) => {
      const draft = state.statesBySessionKey[EMBEDDED_BROWSER_DRAFT_SESSION_KEY]
      if (!draft) return {}

      const { [EMBEDDED_BROWSER_DRAFT_SESSION_KEY]: _draft, ...rest } = state.statesBySessionKey
      const nextLiveKeys = state.liveSessionKeys.map((key) =>
        key === EMBEDDED_BROWSER_DRAFT_SESSION_KEY ? sessionKey : key
      )

      return {
        activeSessionKey:
          state.activeSessionKey === EMBEDDED_BROWSER_DRAFT_SESSION_KEY
            ? sessionKey
            : state.activeSessionKey,
        statesBySessionKey: {
          ...rest,
          [sessionKey]: state.statesBySessionKey[sessionKey] ?? draft
        },
        liveSessionKeys: promoteLiveSessionKey(nextLiveKeys, sessionKey)
      }
    })
  },

  resetDraft: () =>
    set((state) => ({
      activeSessionKey: EMBEDDED_BROWSER_DRAFT_SESSION_KEY,
      statesBySessionKey: {
        ...state.statesBySessionKey,
        [EMBEDDED_BROWSER_DRAFT_SESSION_KEY]: defaultSessionState()
      },
      liveSessionKeys: promoteLiveSessionKey(
        state.liveSessionKeys,
        EMBEDDED_BROWSER_DRAFT_SESSION_KEY
      )
    })),

  show: (sessionKey = get().activeSessionKey) =>
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            open: true,
            lastError: null
          }
        },
        liveSessionKeys: promoteLiveSessionKey(state.liveSessionKeys, sessionKey)
      }
    }),

  openBlank: (sessionKey = get().activeSessionKey) => {
    set((state) => ({
      statesBySessionKey: {
        ...state.statesBySessionKey,
        [sessionKey]: {
          open: true,
          activeTab: 'browser',
          openTabs: ['browser'],
          currentUrl: 'about:blank',
          pageTitle: null,
          addressInput: '',
          loading: false,
          canGoBack: false,
          canGoForward: false,
          annotationMode: 'browse',
          annotationCount: 0,
          pendingUrl: null,
          previousUrl: null,
          lastError: null,
          sopDetail: null,
          fileSelectionRequest: null,
          sideChatTabIndexes: {},
          sideChatLoadingTabs: {}
        }
      },
      liveSessionKeys: promoteLiveSessionKey(state.liveSessionKeys, sessionKey)
    }))
    return sessionKey
  },

  openUrl: (url, sessionKey = get().activeSessionKey) => {
    const normalizedUrl = normalizeEmbeddedBrowserUrl(url)
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            open: true,
            activeTab: 'browser',
            openTabs: addOpenTab(current.openTabs, 'browser'),
            currentUrl: normalizedUrl,
            pageTitle: normalizedUrl === current.currentUrl ? current.pageTitle : null,
            addressInput: normalizedUrl ?? url,
            loading: Boolean(normalizedUrl),
            pendingUrl: normalizedUrl,
            previousUrl: current.currentUrl,
            lastError: normalizedUrl ? null : 'Enter a valid URL or local HTML path.'
          }
        },
        liveSessionKeys: promoteLiveSessionKey(state.liveSessionKeys, sessionKey)
      }
    })
    return sessionKey
  },

  loadUrlHidden: (url, sessionKey = get().activeSessionKey) => {
    const normalizedUrl = normalizeEmbeddedBrowserUrl(url)
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      const nextOpenTabs = normalizedUrl
        ? addOpenTab(current.openTabs, 'browser')
        : current.openTabs
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            activeTab: current.activeTab ?? (normalizedUrl ? 'browser' : null),
            openTabs: nextOpenTabs,
            currentUrl: normalizedUrl,
            pageTitle: normalizedUrl === current.currentUrl ? current.pageTitle : null,
            addressInput: normalizedUrl ?? url,
            loading: Boolean(normalizedUrl),
            pendingUrl: normalizedUrl,
            previousUrl: current.currentUrl,
            lastError: normalizedUrl ? null : 'Enter a valid URL or local HTML path.'
          }
        },
        liveSessionKeys: promoteLiveSessionKey(state.liveSessionKeys, sessionKey)
      }
    })
    return sessionKey
  },

  close: (sessionKey = get().activeSessionKey) =>
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            open: false
          }
        }
      }
    }),

  setActiveTab: (tab, sessionKey = get().activeSessionKey) =>
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            activeTab: tab,
            openTabs: addOpenTab(current.openTabs, tab),
            currentUrl:
              tab === 'browser' ? (current.currentUrl ?? 'about:blank') : current.currentUrl
          }
        }
      }
    }),

  requestFileSelection: (
    path,
    sessionKey = get().activeSessionKey,
    targetLine = null,
    absolutePath = null
  ) => {
    const requestId = ++fileSelectionRequestId
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      return {
        activeSessionKey: sessionKey,
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            open: true,
            activeTab: 'files',
            openTabs: addOpenTab(current.openTabs, 'files'),
            fileSelectionRequest: { path, absolutePath, targetLine, requestId }
          }
        },
        liveSessionKeys: promoteLiveSessionKey(state.liveSessionKeys, sessionKey)
      }
    })
  },

  replaceTab: (oldTab, newTab, sessionKey = get().activeSessionKey) =>
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      const nextOpenTabs = current.openTabs.map((tab) => (tab === oldTab ? newTab : tab))
      const dedupedOpenTabs = nextOpenTabs.filter(
        (tab, index) => nextOpenTabs.indexOf(tab) === index
      )
      const { [oldTab as EmbeddedSideChatLoadingTab]: _removed, ...sideChatLoadingTabs } =
        current.sideChatLoadingTabs
      const sideChatTabIndexes = { ...(current.sideChatTabIndexes ?? {}) }
      const removedIndex = isSideChatPanelTabForStore(oldTab) ? sideChatTabIndexes[oldTab] : null
      if (isSideChatPanelTabForStore(oldTab)) {
        delete sideChatTabIndexes[oldTab]
      }
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            activeTab: current.activeTab === oldTab ? newTab : current.activeTab,
            openTabs: dedupedOpenTabs,
            sideChatTabIndexes: {
              ...sideChatTabIndexes,
              ...(removedIndex ? { [newTab]: removedIndex } : {})
            },
            sideChatLoadingTabs
          }
        }
      }
    }),

  setSopDetail: (detail, sessionKey = get().activeSessionKey) =>
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            activeTab: 'sop-detail',
            openTabs: addOpenTab(current.openTabs, 'sop-detail'),
            sopDetail: detail
          }
        }
      }
    }),

  closeTab: (tab, sessionKey = get().activeSessionKey) =>
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      const nextOpenTabs = current.openTabs.filter((openTab) => openTab !== tab)
      const nextActiveTab = activeTabAfterClose(current.openTabs, tab, current.activeTab)
      const { [tab as EmbeddedSideChatLoadingTab]: _removed, ...sideChatLoadingTabs } =
        current.sideChatLoadingTabs
      const sideChatTabIndexes = { ...(current.sideChatTabIndexes ?? {}) }
      if (isSideChatPanelTabForStore(tab)) {
        delete sideChatTabIndexes[tab]
      }
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            open: nextOpenTabs.length > 0,
            activeTab: nextActiveTab,
            openTabs: nextOpenTabs,
            sopDetail: tab === 'sop-detail' ? null : current.sopDetail,
            sideChatTabIndexes,
            sideChatLoadingTabs
          }
        }
      }
    }),

  startSideChatLoading: (tab, loadingState, sessionKey = get().activeSessionKey) =>
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      let maxSideChatDisplayIndex = 0
      for (const index of Object.values(current.sideChatTabIndexes ?? {})) {
        maxSideChatDisplayIndex = Math.max(maxSideChatDisplayIndex, index ?? 0)
      }
      const displayIndex = maxSideChatDisplayIndex + 1
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            open: true,
            activeTab: tab,
            openTabs: addOpenTab(current.openTabs, tab),
            sideChatTabIndexes: {
              ...(current.sideChatTabIndexes ?? {}),
              [tab]: displayIndex
            },
            sideChatLoadingTabs: {
              ...current.sideChatLoadingTabs,
              [tab]: {
                ...loadingState,
                displayIndex,
                startedAt: new Date().toISOString(),
                error: null
              }
            }
          }
        },
        liveSessionKeys: promoteLiveSessionKey(state.liveSessionKeys, sessionKey)
      }
    }),

  failSideChatLoading: (tab, error, sessionKey = get().activeSessionKey) =>
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      const existing = current.sideChatLoadingTabs[tab]
      if (!existing) return {}
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            activeTab: tab,
            sideChatLoadingTabs: {
              ...current.sideChatLoadingTabs,
              [tab]: {
                ...existing,
                error
              }
            }
          }
        }
      }
    }),

  setAddressInput: (value, sessionKey = get().activeSessionKey) =>
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            addressInput: value
          }
        }
      }
    }),

  setCurrentUrl: (url, sessionKey = get().activeSessionKey) =>
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            currentUrl: url,
            addressInput: url === 'about:blank' ? '' : url,
            loading: false,
            pendingUrl: null,
            previousUrl: null,
            lastError: null
          }
        }
      }
    }),

  setStatus: (status, sessionKey = get().activeSessionKey) =>
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      const statusUrl = status.url
      const statusMatchesPending = Boolean(current.pendingUrl && statusUrl === current.pendingUrl)
      const statusMatchesPrevious = Boolean(
        current.pendingUrl && statusUrl && statusUrl === current.previousUrl
      )
      const shouldKeepPendingUrl = Boolean(
        status.loading && current.pendingUrl && (!statusUrl || statusMatchesPrevious)
      )
      const nextUrl = shouldKeepPendingUrl ? current.pendingUrl : (statusUrl ?? current.currentUrl)
      const statusTitle = status.title?.trim() || null
      const pendingUrl =
        status.loading &&
        current.pendingUrl &&
        (statusMatchesPending ||
          shouldKeepPendingUrl ||
          Boolean(statusUrl && !statusMatchesPrevious))
          ? current.pendingUrl
          : null

      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            currentUrl: nextUrl,
            pageTitle: statusUrl === nextUrl ? statusTitle : current.pageTitle,
            addressInput: nextUrl === 'about:blank' ? '' : (nextUrl ?? current.addressInput),
            loading: shouldKeepPendingUrl ? true : status.loading,
            canGoBack: status.canGoBack,
            canGoForward: status.canGoForward,
            annotationMode: status.annotationMode,
            annotationCount: status.annotationCount,
            pendingUrl,
            previousUrl: pendingUrl ? current.previousUrl : null,
            lastError: null
          }
        }
      }
    }),

  setError: (message, sessionKey = get().activeSessionKey) =>
    set((state) => {
      const current = getEmbeddedBrowserStateForSession(state, sessionKey)
      return {
        statesBySessionKey: {
          ...state.statesBySessionKey,
          [sessionKey]: {
            ...current,
            loading: false,
            pendingUrl: null,
            previousUrl: null,
            lastError: message
          }
        }
      }
    })
}))

export function initEmbeddedBrowserEvents(): () => void {
  if (embeddedBrowserEventUnsubscribe) return () => {}

  embeddedBrowserEventUnsubscribe = window.api.embeddedBrowser.onEvent((event) => {
    const store = useEmbeddedBrowserStore.getState()
    if (event.type === 'open-url') {
      if (event.visible && event.sessionKey && event.sessionKey !== store.activeSessionKey) {
        store.setActiveSession(
          event.sessionKey === EMBEDDED_BROWSER_DRAFT_SESSION_KEY ? null : event.sessionKey
        )
      }
      if (event.visible) {
        store.openUrl(event.url, event.sessionKey)
      } else {
        store.loadUrlHidden(event.url, event.sessionKey)
      }
      return
    }
    if (event.type === 'open-blank') {
      if (event.sessionKey && event.sessionKey !== store.activeSessionKey) {
        store.setActiveSession(
          event.sessionKey === EMBEDDED_BROWSER_DRAFT_SESSION_KEY ? null : event.sessionKey
        )
      }
      store.openBlank(event.sessionKey)
      return
    }
    if (event.type === 'close') {
      store.close(event.sessionKey)
      return
    }
    if (event.type === 'state') {
      store.setStatus(event.status, event.sessionKey)
    }
  })

  return () => {
    embeddedBrowserEventUnsubscribe?.()
    embeddedBrowserEventUnsubscribe = null
  }
}
