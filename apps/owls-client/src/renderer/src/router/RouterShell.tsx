import { IconButton } from '@renderer/components/ui/icon-button'
import {
  AlertCircleIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  XIcon
} from '@renderer/components/ui/icons'
import { ResizeHandle } from '@renderer/components/ui/resize-handle'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { failureMessage } from '../app/failures'
import { SettingsPage } from '../app/Settings'
import { useAppStore } from '../app/store'
import { ForwardDialog } from './ForwardDialog'
import { MapView } from './map/MapView'
import { ProjectsSidebar } from './ProjectsSidebar'
import { usePaneWidth } from './pane-width'
import { RouterChat } from './RouterChat'
import { RouterDetail } from './RouterDetail'
import { Sidebar } from './Sidebar'
import { useRouterStore } from './store'
import { WorkerDetail } from './WorkerDetail'
import './router.css'

function Panel() {
  const panel = useRouterStore((s) => s.panel)
  const router = useRouterStore((s) =>
    panel?.kind === 'router' ? s.routers.find((r) => r.id === panel.routerId) : undefined
  )
  const worker = useRouterStore((s) =>
    panel?.kind === 'worker' ? s.workers.find((w) => w.id === panel.workerId) : undefined
  )
  if (panel?.kind === 'router') return <RouterDetail router={router} />
  return worker ? <WorkerDetail key={worker.id} worker={worker} /> : null
}
/** The stage around the current view and its details panel, whose width it owns. */
function Stage({ sidebarHidden }: { sidebarHidden: boolean }) {
  const view = useAppStore((s) => s.view)
  const threadId = useAppStore((s) => s.threadId)
  const panelOpen = useRouterStore((s) => s.panel !== null)
  const { width, handle } = usePaneWidth('panel', 'left')
  return (
    <div
      className={sidebarHidden ? 'router-stage sidebar-hidden' : 'router-stage'}
      style={{ '--owl-panel-width': `${width}px` } as React.CSSProperties}
    >
      {view === 'map' ? <MapView /> : <RouterChat key={threadId ?? 'new'} />}
      <Panel />
      {/* A sibling over the panel's left edge, so neither detail view has to carry it. */}
      {panelOpen ? <ResizeHandle {...handle} className="router-panel-resize" /> : null}
    </div>
  )
}
function ActionError() {
  const { t } = useTranslation()
  const error = useRouterStore((s) => s.error)
  const clearError = useRouterStore((s) => s.clearError)
  if (!error) return null
  return (
    <div className="owls-error-toast" role="alert">
      <AlertCircleIcon size={16} />
      <span>{failureMessage(error)}</span>
      <IconButton
        size="sm"
        label={t('dismissError')}
        icon={<XIcon size={14} />}
        onClick={clearError}
      />
    </div>
  )
}
/** Backs out one level at a time: Settings, then details, then the map. */
function stepBack() {
  const { panel, showPanel } = useRouterStore.getState()
  const { view, showChat, leaveSettings } = useAppStore.getState()
  if (view === 'settings') leaveSettings()
  else if (panel) showPanel(null)
  else if (view === 'map') showChat()
}
export function RouterShell() {
  const { t } = useTranslation()
  const view = useAppStore((s) => s.view)
  const collapsed = useAppStore((s) => s.settings.sidebarCollapsed)
  const projectsOpen = useAppStore((s) => s.settings.layout.projectsOpen)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const sidebarLabel = t(collapsed ? 'router.showSidebar' : 'router.hideSidebar')
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) return stepBack()
      if (!(event.metaKey || event.ctrlKey)) return
      const { view, showMap, showChat, showSettings, toggleSidebar, newThread } =
        useAppStore.getState()
      if (event.key === ',') {
        event.preventDefault()
        showSettings()
      }
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault()
        // Settings' navigation is its only way between tabs, so it can't be hidden.
        if (view !== 'settings') toggleSidebar()
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        newThread()
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
        <SettingsPage />
        <ActionError />
      </>
    )
  }
  return (
    <>
      {collapsed ? null : <Sidebar />}
      <Stage sidebarHidden={collapsed} />
      {projectsOpen ? <ProjectsSidebar /> : null}
      {/* Stays after the stage: Chromium applies app regions in document order, whatever the
          z-index, so a title bar later in the DOM would turn this button back into a drag area. */}
      <IconButton
        className="router-sidebar-toggle"
        label={sidebarLabel}
        tooltip={sidebarLabel}
        tooltipSide="bottom"
        icon={collapsed ? <PanelLeftOpenIcon size={16} /> : <PanelLeftCloseIcon size={16} />}
        onClick={toggleSidebar}
      />
      <ForwardDialog />
      <ActionError />
    </>
  )
}
