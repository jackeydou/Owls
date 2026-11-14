import { Layout } from '@renderer/components/Layout'
import { SessionImportStatusOverlay } from '@renderer/components/SessionImportStatusOverlay'
import { applyThemeMode, getSystemThemeMedia } from '@renderer/lib/theme'
import { ArtifactsPage } from '@renderer/pages/Artifacts'
import { AutomationPage } from '@renderer/pages/Automation'
import { AutomationDetailPage } from '@renderer/pages/AutomationDetail'
import { ChatPage } from '@renderer/pages/Chat'
import { PluginsPage } from '@renderer/pages/Plugins'
import { SettingsPage } from '@renderer/pages/Settings'
import { sideChatTabId, useEmbeddedBrowserStore } from '@renderer/stores/embedded-browser-store'
import { useFeatureGateStore } from '@renderer/stores/feature-gate-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'

const SessionInspectorPage = lazy(() =>
  import('@renderer/pages/SessionInspector').then((module) => ({
    default: module.SessionInspectorPage
  }))
)

function OpenSessionListener(): null {
  const navigate = useNavigate()

  useEffect(() => {
    const unsubscribeOpenSession = window.api.app.onOpenSession((payload) => {
      void (async () => {
        const store = useSessionStore.getState()
        if (payload.sessionKind === 'side' && payload.parentSessionId) {
          await store.loadSession(payload.parentSessionId)
          await store.loadSessionIndex()
          const browserStore = useEmbeddedBrowserStore.getState()
          const sessionKey = browserStore.setActiveSession(payload.parentSessionId)
          browserStore.show(sessionKey)
          browserStore.setActiveTab(sideChatTabId(payload.sessionId), sessionKey)
          navigate('/')
          return
        }
        await store.loadSession(payload.sessionId)
        await store.loadSessionIndex()
        navigate('/')
      })()
    })
    const unsubscribeNavigate = window.api.app.onNavigate(({ path }) => {
      navigate(path)
    })
    void window.api.app.rendererReady().then((pendingNavigation) => {
      if (pendingNavigation) {
        navigate(pendingNavigation.path)
      }
    })

    return () => {
      unsubscribeOpenSession()
      unsubscribeNavigate()
    }
  }, [navigate])

  return null
}

function SettingsSync(): null {
  const themeMode = useSettingsStore((state) => state.themeMode)
  const loadSettings = useSettingsStore((state) => state.load)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    applyThemeMode(themeMode)

    if (themeMode !== 'system') return

    const media = getSystemThemeMedia()
    const handleSystemThemeChange = () => applyThemeMode(themeMode)
    media.addEventListener('change', handleSystemThemeChange)
    return () => media.removeEventListener('change', handleSystemThemeChange)
  }, [themeMode])

  return null
}

function FeatureGateSync(): null {
  const loadFeatureGates = useFeatureGateStore((state) => state.load)

  useEffect(() => {
    void loadFeatureGates()
  }, [loadFeatureGates])

  return null
}

function clearFocusedActiveSessionUnread(activeSessionId?: string | null): void {
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return
  const store = useSessionStore.getState()
  const sessionId = activeSessionId ?? store.sessionId
  if (sessionId && store.unreadSessionIds.includes(sessionId)) {
    store.clearSessionUnread(sessionId)
  }
}

function UnreadSessionsSync(): null {
  const unreadSessionIds = useSessionStore((state) => state.unreadSessionIds)
  const unreadSessionIdsLoaded = useSessionStore((state) => state.unreadSessionIdsLoaded)

  useEffect(() => {
    let cancelled = false

    const loadUnreadSessionIds = async () => {
      try {
        const sessionIds = await window.api.app.getUnreadSessionIds()
        if (cancelled) return
        useSessionStore.getState().hydrateUnreadSessionIds(sessionIds)
        clearFocusedActiveSessionUnread()
      } catch (error) {
        console.error('[unread] failed to load unread sessions', error)
      }
    }

    void loadUnreadSessionIds()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!unreadSessionIdsLoaded) return
    void window.api.app.setMenuBarUnreadSessionIds(unreadSessionIds).catch((error) => {
      console.error('[unread] failed to update unread sessions', error)
    })
  }, [unreadSessionIds, unreadSessionIdsLoaded])

  return null
}

function SessionReadStateSync(): null {
  const sessionId = useSessionStore((state) => state.sessionId)
  const unreadSessionIdsLoaded = useSessionStore((state) => state.unreadSessionIdsLoaded)

  useEffect(() => {
    const clearCurrentSessionUnread = () => {
      clearFocusedActiveSessionUnread()
    }

    window.addEventListener('focus', clearCurrentSessionUnread)
    document.addEventListener('visibilitychange', clearCurrentSessionUnread)
    clearFocusedActiveSessionUnread()
    return () => {
      window.removeEventListener('focus', clearCurrentSessionUnread)
      document.removeEventListener('visibilitychange', clearCurrentSessionUnread)
    }
  }, [])

  useEffect(() => {
    if (!unreadSessionIdsLoaded) return
    clearFocusedActiveSessionUnread(sessionId)
  }, [sessionId, unreadSessionIdsLoaded])

  return null
}

function App(): React.JSX.Element {
  const isSessionInspectorWindow =
    new URLSearchParams(window.location.search).get('sessionInspectorWindow') === '1'

  if (isSessionInspectorWindow) {
    return (
      <>
        <SettingsSync />
        <Suspense fallback={null}>
          <SessionInspectorPage />
        </Suspense>
      </>
    )
  }

  return (
    <BrowserRouter>
      <SettingsSync />
      <FeatureGateSync />
      <UnreadSessionsSync />
      <SessionReadStateSync />
      <OpenSessionListener />
      <SessionImportStatusOverlay />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/plugins/*" element={<PluginsPage />} />
          <Route path="/automation" element={<AutomationPage />} />
          <Route path="/automation/:jobId" element={<AutomationDetailPage />} />
          <Route path="/artifacts" element={<ArtifactsPage />} />
          <Route path="/workbench/*" element={<Navigate to="/automation" replace />} />
          <Route path="/settings/*" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
