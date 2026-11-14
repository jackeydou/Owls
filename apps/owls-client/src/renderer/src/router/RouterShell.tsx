import { IconButton } from '@renderer/components/ui/icon-button'
import { AlertCircleIcon, SidebarLeftIcon, XIcon } from '@renderer/components/ui/icons'
import { ResizeHandle } from '@renderer/components/ui/resize-handle'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { failureMessage } from '../app/failures'
import { SettingsPage } from '../app/Settings'
import { useAppStore } from '../app/store'
import { CaptureDialog, SendCardsDialog } from '../cards/CardDialogs'
import { CardsView } from '../cards/CardsView'
import { useCardsStore, watchCards } from '../cards/store'
import { PullRequestsView } from '../pulls/PullRequestsView'
import { ForwardDialog } from './ForwardDialog'
import { MapView } from './map/MapView'
import { usePaneWidth } from './pane-width'
import { RightSidebar, RightSidebarToggle } from './RightSidebar'
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
function Stage({
  sidebarHidden,
  projectsHidden
}: {
  sidebarHidden: boolean
  projectsHidden: boolean
}) {
  // Hiding the page in Settings returns to the thread instead of a page with no way back.
  const view = useAppStore((s) =>
    s.view === 'pulls' && !s.settings.pullRequestsVisible ? 'chat' : s.view
  )
  const threadId = useAppStore((s) => s.threadId)
  const panelOpen = useRouterStore((s) => s.panel !== null)
  const { width, handle } = usePaneWidth('panel', 'left')
  return (
    <div
      className={[
        'router-stage',
        sidebarHidden ? 'sidebar-hidden' : null,
        projectsHidden ? 'projects-hidden' : null
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--owl-panel-width': `${width}px` } as React.CSSProperties}
    >
      {view === 'map' ? (
        <MapView />
      ) : view === 'cards' ? (
        <CardsView />
      ) : view === 'pulls' ? (
        <PullRequestsView />
      ) : (
        <RouterChat key={threadId ?? 'new'} />
      )}
      {view === 'cards' ? null : <Panel />}
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
      <AlertCircleIcon size={18} />
      <span>{failureMessage(error)}</span>
      <IconButton
        size="sm"
        label={t('dismissError')}
        icon={<XIcon size={16} />}
        onClick={clearError}
      />
    </div>
  )
}
/** Keys whose ⌘ shortcuts the macOS application menu owns there; see main/app/menu.ts. */
const MENU_SHORTCUTS = new Set(window.owlsPlatform === 'darwin' ? [',', 'b', 'n', 'j', 'k'] : [])
/** Backs out one level at a time: Settings, then details, then the map. */
function stepBack() {
  const { panel, showPanel } = useRouterStore.getState()
  const { view, showChat, leaveSettings } = useAppStore.getState()
  if (view === 'cards') {
    // Escape in a card's fields leaves the field, so an unsaved edit is not closed away.
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.closest('.card-editor')) return focused.blur()
    const cards = useCardsStore.getState()
    if (cards.openCardId) cards.openCard(null)
    else if (cards.selected.length) cards.setSelected([])
    return
  }
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
  useEffect(() => watchCards(), [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) return stepBack()
      if (!(event.metaKey || event.ctrlKey)) return
      if (MENU_SHORTCUTS.has(event.key.toLowerCase())) return
      const { view, showMap, showChat, showCards, showSettings, toggleSidebar, newThread } =
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
      if (event.key.toLowerCase() === 'k' && !event.shiftKey) {
        event.preventDefault()
        if (view === 'cards') showChat()
        else showCards()
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
      <Stage sidebarHidden={collapsed} projectsHidden={!projectsOpen} />
      {projectsOpen ? <RightSidebar /> : null}
      {/* The toggles stay after the stage and the sidebars: Chromium applies app regions in
          document order, whatever the z-index, so a title bar later in the DOM would turn them
          back into drag areas. */}
      <IconButton
        className="router-sidebar-toggle"
        label={sidebarLabel}
        tooltip={sidebarLabel}
        tooltipSide="bottom"
        icon={<SidebarLeftIcon size={18} />}
        onClick={toggleSidebar}
      />
      <RightSidebarToggle />
      <ForwardDialog />
      <CaptureDialog />
      <SendCardsDialog />
      <ActionError />
    </>
  )
}
