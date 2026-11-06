import { IconButton } from '@renderer/components/ui/icon-button'
import { AlertCircle, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { failureMessage } from '../codex/failures'
import { CodexSettingsPage } from '../codex/Settings'
import { useCodexStore } from '../codex/store'
import { MapView } from './map/MapView'
import { RouterChat } from './RouterChat'
import { RouterDetail } from './RouterDetail'
import { Sidebar } from './Sidebar'
import { useRouterStore } from './store'
import { WorkerDetail } from './WorkerDetail'
import './router.css'

function Panel() {
  const panel = useRouterStore((s) => s.panel)
  const projectId = useCodexStore((s) => s.routerProjectId)
  const router = useRouterStore((s) => s.routers.find((r) => r.projectId === projectId))
  const worker = useRouterStore((s) =>
    panel?.kind === 'worker' ? s.workers.find((w) => w.id === panel.workerId) : undefined
  )
  if (panel?.kind === 'router') return <RouterDetail router={router} />
  return worker ? <WorkerDetail key={worker.id} worker={worker} /> : null
}
function ActionError() {
  const { t } = useTranslation()
  const error = useRouterStore((s) => s.error)
  const clearError = useRouterStore((s) => s.clearError)
  if (!error) return null
  return (
    <div className="codex-error-toast" role="alert">
      <AlertCircle size={16} />
      <span>{failureMessage(error)}</span>
      <IconButton size="sm" label={t('dismissError')} icon={<X size={14} />} onClick={clearError} />
    </div>
  )
}
/** Backs out one level at a time: Settings, then details, then the map. */
function stepBack() {
  const { panel, showPanel } = useRouterStore.getState()
  const { view, showChat, leaveSettings } = useCodexStore.getState()
  if (view === 'settings') leaveSettings()
  else if (panel) showPanel(null)
  else if (view === 'map') showChat()
}
export function RouterShell() {
  const { t } = useTranslation()
  const view = useCodexStore((s) => s.view)
  const collapsed = useCodexStore((s) => s.settings.sidebarCollapsed)
  const toggleSidebar = useCodexStore((s) => s.toggleSidebar)
  const projectId = useCodexStore((s) => s.routerProjectId)
  const sidebarLabel = t(collapsed ? 'router.showSidebar' : 'router.hideSidebar')
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) return stepBack()
      if (!(event.metaKey || event.ctrlKey)) return
      const { view, showMap, showChat, showSettings, toggleSidebar } = useCodexStore.getState()
      if (event.key === ',') {
        event.preventDefault()
        showSettings()
      }
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault()
        // Settings' navigation is its only way between tabs, so it can't be hidden.
        if (view !== 'settings') toggleSidebar()
      }
      if (event.key.toLowerCase() === 'j') {
        event.preventDefault()
        if (view === 'map') showChat()
        else showMap()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])
  if (view === 'settings') {
    return (
      <>
        <CodexSettingsPage />
        <ActionError />
      </>
    )
  }
  return (
    <>
      {collapsed ? null : <Sidebar />}
      <div className={collapsed ? 'router-stage sidebar-hidden' : 'router-stage'}>
        {view === 'map' ? <MapView /> : <RouterChat key={projectId ?? 'none'} />}
        <Panel />
      </div>
      {/* Stays after the stage: Chromium applies app regions in document order, whatever the
          z-index, so a title bar later in the DOM would turn this button back into a drag area. */}
      <IconButton
        className="router-sidebar-toggle"
        label={sidebarLabel}
        tooltip={sidebarLabel}
        tooltipSide="bottom"
        icon={collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        onClick={toggleSidebar}
      />
      <ActionError />
    </>
  )
}
