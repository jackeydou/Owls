import { IconButton } from '@renderer/components/ui/icon-button'
import {
  CardsIcon,
  FileCodeIcon,
  FolderIcon,
  FolderOpenTiltIcon,
  GlobeIcon,
  PlusIcon,
  SidebarRightIcon,
  SmartphoneIcon
} from '@renderer/components/ui/icons'
import { ResizeHandle } from '@renderer/components/ui/resize-handle'
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { RightPanel } from '../../../shared/app'
import type { Card } from '../../../shared/cards'
import { useAppStore } from '../app/store'
import { BrowserPane } from '../browser/BrowserPane'
import { NEW_CARD } from '../cards/CardEditor'
import { useCardsStore } from '../cards/store'
import { FileViewerPane } from '../files/FileViewer'
import { SimulatorPane } from '../simulator/SimulatorPane'
import { ProjectsPane } from './ProjectsSidebar'
import { usePaneWidth } from './pane-width'
import { useRouterStore } from './store'
import { WorkerDetail } from './WorkerDetail'

/**
 * Opens and closes the right-hand sidebar from the window's top-right corner, whatever the view:
 * over the sidebar's head while it is open, and at the end of the title bar while it is closed.
 */
export function RightSidebarToggle() {
  const { t } = useTranslation()
  const open = useAppStore((s) => s.settings.layout.projectsOpen)
  const toggleProjects = useAppStore((s) => s.toggleProjects)
  const label = t(open ? 'router.hideRightSidebar' : 'router.showRightSidebar')
  return (
    <IconButton
      className="router-projects-toggle"
      label={label}
      tooltip={label}
      tooltipSide="bottom"
      aria-expanded={open}
      icon={<SidebarRightIcon size={18} />}
      onClick={toggleProjects}
    />
  )
}

const byUpdated = (a: Card, b: Card) =>
  b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)

function CardsPane() {
  const { t } = useTranslation()
  const allCards = useCardsStore((s) => s.cards)
  const openCardId = useCardsStore((s) => s.openCardId)
  const inCards = useAppStore((s) => s.view === 'cards')
  const showCards = useAppStore((s) => s.showCards)
  const cards = useMemo(
    () => allCards.filter((card) => card.status === 'active').sort(byUpdated),
    [allCards]
  )
  // Cards open in the Cards page's editor, so the page comes first.
  const open = (cardId: string) => {
    if (!inCards) showCards()
    useCardsStore.getState().openCard(cardId)
  }
  return (
    <section className="router-right-pane" aria-label={t('router.panel.cards')}>
      <header>
        <h2>{t('router.panel.cards')}</h2>
        <IconButton
          size="sm"
          label={t('router.panel.newCard')}
          tooltip={t('router.panel.newCard')}
          tooltipSide="left"
          icon={<PlusIcon size={16} />}
          onClick={() => open(NEW_CARD)}
        />
      </header>
      {cards.length ? (
        <ul className="router-right-cards" aria-label={t('router.panel.cards')}>
          {cards.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                aria-current={(inCards && openCardId === card.id) || undefined}
                onClick={() => open(card.id)}
              >
                <strong>{card.title}</strong>
                {card.body ? <span>{card.body}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t('router.panel.noCards')}</p>
      )}
    </section>
  )
}

function PanelTab({
  panel,
  current,
  icon
}: {
  panel: RightPanel
  /** The tab whose list shows, or null while a worker's conversation covers the lists. */
  current: RightPanel | null
  icon: ReactNode
}) {
  const { t } = useTranslation()
  const showRightPanel = useAppStore((s) => s.showRightPanel)
  const label = t(`router.panel.${panel}`)
  return (
    <IconButton
      className="router-right-tab"
      label={label}
      tooltip={label}
      tooltipSide="bottom"
      aria-pressed={panel === current}
      icon={icon}
      onClick={() => showRightPanel(panel)}
    />
  )
}

/** The right-hand sidebar: one list at a time, picked from the icons in its head. */
export function RightSidebar() {
  const { t } = useTranslation()
  const tab = useAppStore((s) => s.settings.layout.rightPanel)
  const worker = useRouterStore((s) => {
    const panel = s.panel
    return panel?.kind === 'worker' ? s.workers.find((w) => w.id === panel.workerId) : undefined
  })
  // An open worker covers the lists until the user goes back or picks a tab.
  const panel = worker ? null : tab
  // One width for every tab and an open worker, so switching never resizes the sidebar.
  const { width, handle } = usePaneWidth('right', 'left')
  return (
    <aside className="router-projects" style={{ width }} aria-label={t('router.rightSidebar')}>
      <header className="router-projects-head">
        <nav className="router-right-tabs" aria-label={t('router.rightSidebar')}>
          <PanelTab
            panel="projects"
            current={panel}
            icon={
              panel === 'projects' ? <FolderOpenTiltIcon size={18} /> : <FolderIcon size={18} />
            }
          />
          <PanelTab panel="cards" current={panel} icon={<CardsIcon size={18} />} />
          <PanelTab panel="files" current={panel} icon={<FileCodeIcon size={18} />} />
          <PanelTab panel="browser" current={panel} icon={<GlobeIcon size={18} />} />
          <PanelTab panel="simulator" current={panel} icon={<SmartphoneIcon size={18} />} />
        </nav>
      </header>
      {worker ? (
        <WorkerDetail key={worker.id} worker={worker} />
      ) : panel === 'simulator' ? (
        <SimulatorPane />
      ) : panel === 'browser' ? (
        <BrowserPane />
      ) : panel === 'files' ? (
        <FileViewerPane />
      ) : panel === 'cards' ? (
        <CardsPane />
      ) : (
        <ProjectsPane />
      )}
      <ResizeHandle {...handle} />
    </aside>
  )
}
