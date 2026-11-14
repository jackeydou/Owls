import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import {
  sideChatSessionIdFromTab,
  useEmbeddedBrowserStore
} from '@renderer/stores/embedded-browser-store'
import { useProjectsStore } from '@renderer/stores/projects-store'
import type { SessionIndexEntry } from '@renderer/stores/session-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { type LanguageSetting, useSettingsStore } from '@renderer/stores/settings-store'
import { useSideChatStore } from '@renderer/stores/side-chat-store'
import { useToolApprovalStore } from '@renderer/stores/tool-approval-store'
import {
  Clock3,
  FolderOpen,
  FolderPlus,
  GalleryVerticalEnd,
  Lightbulb,
  ListFilter,
  Maximize2,
  Minimize2,
  Search,
  SquarePen
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ProjectEntry } from '../../../preload/index.d'
import { APP_HOTKEYS } from '../../../shared/app-hotkeys'
import { AppNavItem } from './session-sidebar/AppNavItem'
import { ProjectContextMenu } from './session-sidebar/ProjectContextMenu'
import { ProjectItem } from './session-sidebar/ProjectItem'
import { SessionContextMenu } from './session-sidebar/SessionContextMenu'
import { SessionItem, type SessionItemStatus } from './session-sidebar/SessionItem'
import { SessionSectionHeader } from './session-sidebar/SessionSectionHeader'
import { SessionSidebarFooter } from './session-sidebar/SessionSidebarFooter'
import { SortablePinnedSessionItem } from './session-sidebar/SortablePinnedSessionItem'
import { compareProjectsBySortKey, compareSessionsBySortKey } from './session-sidebar/sidebar-utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemCheck,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { clampMenuPosition, useDismissableMenu } from './ui/menu'
import { Sidebar, SidebarContent, SidebarGroup, useSidebar } from './ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export { SessionContextMenu }

type SessionSidebarProps = {
  searchOpen: boolean
  onOpenSearch: () => void
  onArchiveSession: (entry: SessionIndexEntry) => void | Promise<void>
}
type SessionContextMenuState = {
  entry: SessionIndexEntry
  x: number
  y: number
}
type ProjectContextMenuState = {
  project: ProjectEntry
  x: number
  y: number
}

export const SESSION_CONTEXT_MENU_SIZE = {
  width: 218,
  height: 292
} as const
const PROJECT_CONTEXT_MENU_SIZE = {
  width: 224,
  height: 154
} as const
const SESSION_LIST_FADE_EDGE_THRESHOLD = 16
const NEW_SESSION_HOTKEY = APP_HOTKEYS.find((hotkey) => hotkey.id === 'new-session')?.keys
const SEARCH_HOTKEY = APP_HOTKEYS.find((hotkey) => hotkey.id === 'open-search')?.keys

function SessionSidebarBase({
  searchOpen,
  onOpenSearch,
  onArchiveSession
}: SessionSidebarProps): React.JSX.Element {
  const { t } = useI18n()
  const { collapsed } = useSidebar()
  const navigate = useNavigate()
  const location = useLocation()
  const loadSettings = useSettingsStore((state) => state.load)
  const settingsLanguage = useSettingsStore((state) => state.language)
  const dataRoot = useSettingsStore((state) => state.dataRoot)
  const workingDirectory = useSettingsStore((state) => state.workingDirectory)
  const updateLanguage = useSettingsStore((state) => state.updateLanguage)
  const updateWorkingDirectory = useSettingsStore((state) => state.updateWorkingDirectory)
  const projectSortKey = useSettingsStore((state) => state.projectSortKey)
  const updateProjectSortKey = useSettingsStore((state) => state.updateProjectSortKey)
  const projects = useProjectsStore((state) => state.projects)
  const loadProjects = useProjectsStore((state) => state.load)
  const createProjectFromScratch = useProjectsStore((state) => state.createFromScratch)
  const addExistingProjectFolder = useProjectsStore((state) => state.addExistingFolder)
  const touchProject = useProjectsStore((state) => state.touch)
  const setProjectPinned = useProjectsStore((state) => state.setPinned)
  const renameProject = useProjectsStore((state) => state.rename)
  const removeProject = useProjectsStore((state) => state.remove)
  const currentSessionId = useSessionStore((state) => state.sessionLoadingId ?? state.sessionId)
  const sessionIndex = useSessionStore((state) => state.sessionIndex)
  const sessionIndexLoaded = useSessionStore((state) => state.sessionIndexLoaded)
  const loadSessionIndex = useSessionStore((state) => state.loadSessionIndex)
  const resetConversation = useSessionStore((state) => state.resetConversation)
  const loadSession = useSessionStore((state) => state.loadSession)
  const markSessionUnread = useSessionStore((state) => state.markSessionUnread)
  const clearSessionUnread = useSessionStore((state) => state.clearSessionUnread)
  const toggleSessionPinned = useSessionStore((state) => state.toggleSessionPinned)
  const reorderPinnedSessions = useSessionStore((state) => state.reorderPinnedSessions)
  const sessionIndexSortKey = useSessionStore((state) => state.sessionIndexSortKey)
  const runningSessionIds = useSessionStore((state) => state.runningSessionIds)
  const unreadSessionIds = useSessionStore((state) => state.unreadSessionIds)
  const failedSessionIds = useSessionStore((state) => state.failedSessionIds)
  const sideChatSessionId = useSideChatStore((state) => state.sessionId)
  const sideChatParentSessionId = useSideChatStore((state) => state.parentSessionId)
  const sideChatRunningSessionIds = useSideChatStore((state) => state.runningSessionIds)
  const sideChatUnreadSessionIds = useSideChatStore((state) => state.unreadSessionIds)
  const sideChatFailedSessionIds = useSideChatStore((state) => state.failedSessionIds)
  const clearSideChatUnread = useSideChatStore((state) => state.clearSessionUnread)
  const approvalRequests = useToolApprovalStore((state) => state.requests)
  const loadApprovals = useToolApprovalStore((state) => state.load)
  const attachApprovalListeners = useToolApprovalStore((state) => state.attachListeners)
  const embeddedBrowserStatesBySessionKey = useEmbeddedBrowserStore(
    (state) => state.statesBySessionKey
  )

  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [projectSortMenuOpen, setProjectSortMenuOpen] = useState(false)
  const [projectActionPending, setProjectActionPending] = useState(false)
  const [sessionMenu, setSessionMenu] = useState<SessionContextMenuState | null>(null)
  const [projectContextMenu, setProjectContextMenu] = useState<ProjectContextMenuState | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renamingProjectPath, setRenamingProjectPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [projectRenameValue, setProjectRenameValue] = useState('')
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false)
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [collapsedProjectPaths, setCollapsedProjectPaths] = useState<string[]>([])
  const [chatsCollapsed, setChatsCollapsed] = useState(false)
  const [confirmRemoveSessionId, setConfirmRemoveSessionId] = useState<string | null>(null)
  const [sessionListFade, setSessionListFade] = useState({ top: false, bottom: false })
  const sessionMenuRef = useRef<HTMLDivElement | null>(null)
  const projectContextMenuRef = useRef<HTMLDivElement | null>(null)
  const sessionListRef = useRef<HTMLDivElement | null>(null)
  const pinnedSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6
      }
    })
  )

  const pinnedSessionIndex = useMemo(
    () =>
      sessionIndex
        .filter((entry) => entry.pinned)
        .sort(
          (a, b) =>
            (b.pinnedOrder ?? 0) - (a.pinnedOrder ?? 0) ||
            compareSessionsBySortKey(a, b, sessionIndexSortKey)
        ),
    [sessionIndex, sessionIndexSortKey]
  )
  const pinnedSessionIds = useMemo(
    () => pinnedSessionIndex.map((entry) => entry.sessionId),
    [pinnedSessionIndex]
  )
  const allProjectPaths = useMemo(() => projects.map((project) => project.path), [projects])
  const allProjectGroupsCollapsed = useMemo(
    () =>
      allProjectPaths.length > 0 &&
      allProjectPaths.every((path) => collapsedProjectPaths.includes(path)),
    [allProjectPaths, collapsedProjectPaths]
  )
  const chatSessionIndex = useMemo(
    () =>
      sessionIndex
        .filter((entry) => !entry.pinned)
        .sort((a, b) => compareSessionsBySortKey(a, b, sessionIndexSortKey)),
    [sessionIndex, sessionIndexSortKey]
  )
  const projectPathSet = useMemo(() => new Set(projects.map((project) => project.path)), [projects])
  const pinnedProjects = useMemo(
    () =>
      projects
        .filter((project) => project.pinned)
        .sort(
          (left, right) =>
            (right.pinnedOrder ?? 0) - (left.pinnedOrder ?? 0) ||
            compareProjectsBySortKey(left, right, projectSortKey)
        ),
    [projectSortKey, projects]
  )
  const regularProjects = useMemo(
    () =>
      projects
        .filter((project) => !project.pinned)
        .sort((left, right) => compareProjectsBySortKey(left, right, projectSortKey)),
    [projectSortKey, projects]
  )
  const projectSessionsByPath = useMemo(() => {
    const sessionsByProjectPath = new Map<string, SessionIndexEntry[]>()
    for (const project of projects) {
      sessionsByProjectPath.set(project.path, [])
    }
    for (const entry of chatSessionIndex) {
      const projectSessions = sessionsByProjectPath.get(entry.cwd)
      if (projectSessions) {
        projectSessions.push(entry)
      }
    }
    return sessionsByProjectPath
  }, [chatSessionIndex, projects])
  const nonProjectChatSessionIndex = useMemo(
    () => chatSessionIndex.filter((entry) => !projectPathSet.has(entry.cwd)),
    [chatSessionIndex, projectPathSet]
  )
  const sortedSessionIndex = useMemo(
    () => [...pinnedSessionIndex, ...chatSessionIndex],
    [chatSessionIndex, pinnedSessionIndex]
  )
  const visibleSessionListSignature = [
    collapsed ? '1' : '0',
    sessionIndexLoaded ? '1' : '0',
    projectsCollapsed ? '1' : '0',
    collapsedProjectPaths.join('|'),
    pinnedCollapsed ? '1' : '0',
    chatsCollapsed ? '1' : '0',
    pinnedProjects.length,
    regularProjects.length,
    pinnedSessionIndex.length,
    nonProjectChatSessionIndex.length
  ].join(':')
  const visibleProjectCount = collapsed
    ? projects.length
    : (pinnedCollapsed
        ? 0
        : pinnedProjects.reduce((count, project) => {
            if (collapsedProjectPaths.includes(project.path)) return count + 1
            return count + 1 + (projectSessionsByPath.get(project.path)?.length || 1)
          }, 0)) +
      (projectsCollapsed
        ? 0
        : regularProjects.reduce((count, project) => {
            if (collapsedProjectPaths.includes(project.path)) return count + 1
            return count + 1 + (projectSessionsByPath.get(project.path)?.length || 1)
          }, 0))
  const visibleSessionCount = collapsed
    ? sortedSessionIndex.length
    : (pinnedCollapsed ? 0 : pinnedSessionIndex.length) +
      (chatsCollapsed ? 0 : nonProjectChatSessionIndex.length)
  const showBottomFade =
    sessionListFade.bottom ||
    (!sessionListFade.top && visibleSessionCount + visibleProjectCount > 12)
  const sideChatSessionIdsByParent = useMemo(() => {
    const idsByParent = new Map<string, Set<string>>()
    const addSideChatSession = (parentSessionId: string | null | undefined, sessionId: string) => {
      const normalizedParentId = parentSessionId?.trim()
      const normalizedSessionId = sessionId.trim()
      if (!normalizedParentId || !normalizedSessionId) return
      const existing = idsByParent.get(normalizedParentId) ?? new Set<string>()
      existing.add(normalizedSessionId)
      idsByParent.set(normalizedParentId, existing)
    }

    if (sideChatSessionId) {
      addSideChatSession(sideChatParentSessionId, sideChatSessionId)
    }

    for (const entry of sessionIndex) {
      if ((entry.sessionKind ?? 'main') === 'side') {
        addSideChatSession(entry.parentSessionId, entry.sessionId)
      }
    }

    for (const [parentSessionId, browserState] of Object.entries(
      embeddedBrowserStatesBySessionKey
    )) {
      for (const tab of browserState.openTabs) {
        const sideSessionId = sideChatSessionIdFromTab(tab)
        if (sideSessionId) {
          addSideChatSession(parentSessionId, sideSessionId)
        }
      }
    }

    return idsByParent
  }, [embeddedBrowserStatesBySessionKey, sessionIndex, sideChatParentSessionId, sideChatSessionId])

  const clearSideChatUnreadForParent = useCallback(
    (parentSessionId: string) => {
      for (const sideSessionId of sideChatSessionIdsByParent.get(parentSessionId) ?? []) {
        clearSessionUnread(sideSessionId)
        clearSideChatUnread(sideSessionId)
      }
    },
    [clearSessionUnread, clearSideChatUnread, sideChatSessionIdsByParent]
  )

  const addParentStatusForSideChats = useCallback(
    (ids: Set<string>, sideStatusIds: Set<string>): Set<string> => {
      const next = new Set(ids)
      for (const [parentSessionId, sideSessionIds] of sideChatSessionIdsByParent) {
        if ([...sideSessionIds].some((sideSessionId) => sideStatusIds.has(sideSessionId))) {
          next.add(parentSessionId)
        }
      }
      return next
    },
    [sideChatSessionIdsByParent]
  )

  const runningSessionIdSet = useMemo(() => {
    const ids = new Set(runningSessionIds)
    const sideStatusIds = new Set([...runningSessionIds, ...sideChatRunningSessionIds])
    return addParentStatusForSideChats(ids, sideStatusIds)
  }, [addParentStatusForSideChats, runningSessionIds, sideChatRunningSessionIds])
  const unreadSessionIdSet = useMemo(() => {
    const ids = new Set(unreadSessionIds)
    const sideStatusIds = new Set([...unreadSessionIds, ...sideChatUnreadSessionIds])
    return addParentStatusForSideChats(ids, sideStatusIds)
  }, [addParentStatusForSideChats, sideChatUnreadSessionIds, unreadSessionIds])
  const failedSessionIdSet = useMemo(() => {
    const ids = new Set(failedSessionIds)
    const sideStatusIds = new Set([...failedSessionIds, ...sideChatFailedSessionIds])
    return addParentStatusForSideChats(ids, sideStatusIds)
  }, [addParentStatusForSideChats, failedSessionIds, sideChatFailedSessionIds])
  const waitingApprovalSessionIdSet = useMemo(() => {
    const approvalSessionIds = approvalRequests.map((request) => request.sessionId)
    return addParentStatusForSideChats(new Set(approvalSessionIds), new Set(approvalSessionIds))
  }, [addParentStatusForSideChats, approvalRequests])
  const sessionById = useMemo(
    () => new Map(sessionIndex.map((entry) => [entry.sessionId, entry])),
    [sessionIndex]
  )

  useEffect(() => {
    void loadSessionIndex(sessionIndexSortKey)
    return window.api.cron.onEvent((event) => {
      if (event.type === 'run-session-created') {
        void loadSessionIndex(sessionIndexSortKey)
      }
    })
  }, [loadSessionIndex, sessionIndexSortKey])

  useEffect(() => {
    const detachApprovalListeners = attachApprovalListeners()
    void loadApprovals()
    return detachApprovalListeners
  }, [attachApprovalListeners, loadApprovals])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  const closeAccountMenu = useCallback(() => setAccountMenuOpen(false), [])
  const closeSessionMenu = useCallback(() => setSessionMenu(null), [])
  const closeProjectContextMenu = useCallback(() => setProjectContextMenu(null), [])
  useDismissableMenu({ open: Boolean(sessionMenu), ref: sessionMenuRef, onClose: closeSessionMenu })
  useDismissableMenu({
    open: Boolean(projectContextMenu),
    ref: projectContextMenuRef,
    onClose: closeProjectContextMenu
  })

  const updateSessionListFade = useCallback(() => {
    const element = sessionListRef.current
    if (!element) {
      setSessionListFade((previous) =>
        previous.top || previous.bottom ? { top: false, bottom: false } : previous
      )
      return
    }

    const maxScrollTop = element.scrollHeight - element.clientHeight
    const canScroll = maxScrollTop > 1
    const next = {
      top: canScroll && element.scrollTop > SESSION_LIST_FADE_EDGE_THRESHOLD,
      bottom: canScroll && element.scrollTop < maxScrollTop - SESSION_LIST_FADE_EDGE_THRESHOLD
    }

    setSessionListFade((previous) =>
      previous.top === next.top && previous.bottom === next.bottom ? previous : next
    )
  }, [])

  useEffect(() => {
    if (collapsed) {
      setAccountMenuOpen(false)
      setSortMenuOpen(false)
      setProjectMenuOpen(false)
      setProjectSortMenuOpen(false)
      setSessionMenu(null)
      setProjectContextMenu(null)
      setRenamingSessionId(null)
      setRenamingProjectPath(null)
      setConfirmRemoveSessionId(null)
    }
  }, [collapsed])

  useEffect(() => {
    void visibleSessionListSignature
    setSessionListFade((previous) =>
      previous.top || previous.bottom ? { top: false, bottom: false } : previous
    )
  }, [visibleSessionListSignature])

  const selectLanguage = useCallback(
    async (nextLanguage: LanguageSetting) => {
      await updateLanguage(nextLanguage)
      closeAccountMenu()
    },
    [closeAccountMenu, updateLanguage]
  )

  const selectProject = useCallback(
    async (project: ProjectEntry) => {
      await touchProject(project.path)
      await updateWorkingDirectory(project.path)
      resetConversation()
      navigate('/')
    },
    [navigate, resetConversation, touchProject, updateWorkingDirectory]
  )

  const toggleProject = useCallback((project: ProjectEntry) => {
    setCollapsedProjectPaths((paths) =>
      paths.includes(project.path)
        ? paths.filter((path) => path !== project.path)
        : [...paths, project.path]
    )
  }, [])

  const toggleAllProjects = useCallback(() => {
    if (allProjectPaths.length === 0) return
    setProjectsCollapsed(false)
    setCollapsedProjectPaths(allProjectGroupsCollapsed ? [] : allProjectPaths)
  }, [allProjectGroupsCollapsed, allProjectPaths])

  const startProjectChat = useCallback(
    (project: ProjectEntry) => {
      void (async () => {
        await updateWorkingDirectory(project.path)
        resetConversation()
        navigate('/')
      })().catch(console.error)
    },
    [navigate, resetConversation, updateWorkingDirectory]
  )

  const toggleProjectPinned = useCallback(
    (project: ProjectEntry) => {
      void setProjectPinned(project.path, !project.pinned).catch(console.error)
    },
    [setProjectPinned]
  )

  const openProjectInFinder = useCallback((project: ProjectEntry) => {
    void window.api.attachments.reveal(project.path).catch(console.error)
  }, [])

  const startRenamingProject = useCallback((project: ProjectEntry) => {
    setRenamingProjectPath(project.path)
    setProjectRenameValue(project.name)
  }, [])

  const submitProjectRename = useCallback(
    (project: ProjectEntry, name: string) => {
      const nextName = name.trim()
      setRenamingProjectPath((current) => (current === project.path ? null : current))
      if (!nextName || nextName === project.name) return
      void renameProject(project.path, nextName).catch(console.error)
    },
    [renameProject]
  )

  const removeProjectFromSidebar = useCallback(
    (project: ProjectEntry) => {
      void removeProject(project.path).catch(console.error)
    },
    [removeProject]
  )

  const runProjectAction = useCallback(
    async (mode: 'scratch' | 'existing') => {
      setProjectMenuOpen(false)
      setProjectActionPending(true)
      try {
        const project =
          mode === 'scratch' ? await createProjectFromScratch() : await addExistingProjectFolder()
        if (!project) return
        await selectProject(project)
      } catch (error) {
        console.error('Failed to create project', error)
      } finally {
        setProjectActionPending(false)
      }
    },
    [addExistingProjectFolder, createProjectFromScratch, selectProject]
  )

  const startNewSession = useCallback(() => {
    void (async () => {
      try {
        if (projectPathSet.has(workingDirectory)) {
          await updateWorkingDirectory(dataRoot)
        }
      } catch (error) {
        console.error('Failed to switch to local workspace', error)
      } finally {
        resetConversation()
        navigate('/')
      }
    })()
  }, [
    dataRoot,
    navigate,
    projectPathSet,
    resetConversation,
    updateWorkingDirectory,
    workingDirectory
  ])

  const openSessionMenu = useCallback(
    (sessionId: string, event: React.MouseEvent) => {
      const entry = sessionById.get(sessionId)
      if (!entry) return
      event.preventDefault()
      event.stopPropagation()
      setConfirmRemoveSessionId(null)
      const position = clampMenuPosition({
        x: event.clientX,
        y: event.clientY,
        width: SESSION_CONTEXT_MENU_SIZE.width,
        height: SESSION_CONTEXT_MENU_SIZE.height
      })
      setSessionMenu({
        entry,
        x: position.x,
        y: position.y
      })
    },
    [sessionById]
  )

  const openProjectContextMenu = useCallback((project: ProjectEntry, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setSessionMenu(null)
    setConfirmRemoveSessionId(null)
    const position = clampMenuPosition({
      x: event.clientX,
      y: event.clientY,
      width: PROJECT_CONTEXT_MENU_SIZE.width,
      height: PROJECT_CONTEXT_MENU_SIZE.height
    })
    setProjectContextMenu({
      project,
      x: position.x,
      y: position.y
    })
  }, [])

  const startRenamingSession = useCallback((entry: SessionIndexEntry) => {
    setSessionMenu(null)
    setRenamingSessionId(entry.sessionId)
    setRenameValue(entry.title || entry.sessionId)
  }, [])

  const submitSessionRename = useCallback(
    async (sessionId: string, nextTitle: string) => {
      const title = nextTitle.trim()
      setRenamingSessionId((current) => (current === sessionId ? null : current))
      if (!title) return
      await window.api.agent.sessionIndexUpdateTitle(sessionId, title)
      await loadSessionIndex(sessionIndexSortKey)
    },
    [loadSessionIndex, sessionIndexSortKey]
  )

  const finishPinnedSessionSort = useCallback(
    (event: DragEndEvent) => {
      const activeSessionId = String(event.active.id)
      const overSessionId = event.over ? String(event.over.id) : null
      if (!overSessionId || activeSessionId === overSessionId) return

      const currentSessionIds = pinnedSessionIndex.map((entry) => entry.sessionId)
      const activeIndex = currentSessionIds.indexOf(activeSessionId)
      const overIndex = currentSessionIds.indexOf(overSessionId)
      if (activeIndex === -1 || overIndex === -1) return

      void reorderPinnedSessions(arrayMove(currentSessionIds, activeIndex, overIndex)).catch(
        console.error
      )
    },
    [pinnedSessionIndex, reorderPinnedSessions]
  )

  const handleRemoveSession = useCallback((sessionId: string) => {
    setConfirmRemoveSessionId(sessionId)
  }, [])

  const handleConfirmRemoveSession = useCallback(
    (sessionId: string) => {
      const entry = sessionIndex.find((candidate) => candidate.sessionId === sessionId)
      if (!entry) return
      setConfirmRemoveSessionId(null)
      void onArchiveSession(entry)
    },
    [onArchiveSession, sessionIndex]
  )

  const handleRenameCancel = useCallback(() => {
    setRenamingSessionId(null)
  }, [])

  const handleUnpinSession = useCallback(
    (sessionId: string) => {
      void toggleSessionPinned(sessionId, false).catch(console.error)
    },
    [toggleSessionPinned]
  )

  const handleSelectSession = useCallback(
    (sessionId: string, _isPinned: boolean, _status: SessionItemStatus) => {
      setConfirmRemoveSessionId(null)
      clearSideChatUnreadForParent(sessionId)
      void loadSession(sessionId)
      navigate('/')
    },
    [clearSideChatUnreadForParent, loadSession, navigate]
  )

  const renderSessionItem = (
    entry: SessionIndexEntry,
    options: { isDragging?: boolean; isProjectChild?: boolean } = {}
  ): React.JSX.Element => (
    <SessionItem
      key={entry.sessionId}
      sessionId={entry.sessionId}
      agentId={entry.agentId}
      title={entry.title}
      createdAt={entry.createdAt}
      updatedAt={entry.updatedAt}
      sortKey={sessionIndexSortKey}
      isActive={currentSessionId === entry.sessionId && location.pathname === '/'}
      isContextMenuOpen={sessionMenu?.entry.sessionId === entry.sessionId}
      confirmRemove={confirmRemoveSessionId === entry.sessionId}
      isRunning={runningSessionIdSet.has(entry.sessionId)}
      isAwaitingApproval={waitingApprovalSessionIdSet.has(entry.sessionId)}
      isUnread={unreadSessionIdSet.has(entry.sessionId)}
      isFailed={failedSessionIdSet.has(entry.sessionId)}
      isPinned={Boolean(entry.pinned)}
      isProjectChild={options.isProjectChild}
      isDragging={options.isDragging}
      isRenaming={renamingSessionId === entry.sessionId}
      renameValue={renamingSessionId === entry.sessionId ? renameValue : ''}
      onRemove={handleRemoveSession}
      onConfirmRemove={handleConfirmRemoveSession}
      onContextMenu={openSessionMenu}
      onRenameCancel={handleRenameCancel}
      onRenameSubmit={submitSessionRename}
      onRenameValueChange={setRenameValue}
      onUnpin={handleUnpinSession}
      removeLabel={t('nav.removeSession')}
      confirmRemoveLabel={t('nav.confirmRemoveSession')}
      runningLabel={t('nav.sessionRunning')}
      awaitingApprovalLabel={t('nav.sessionAwaitingApproval')}
      unreadLabel={t('nav.sessionUnread')}
      failedLabel={t('nav.sessionFailed')}
      pinnedLabel={t(entry.pinned ? 'nav.context.unpin' : 'nav.sessionPinned')}
      onSelect={handleSelectSession}
    />
  )

  const renderProjectItem = (project: ProjectEntry): React.JSX.Element => (
    <ProjectItem
      key={project.path}
      project={project}
      collapsed={collapsed}
      expanded={!collapsedProjectPaths.includes(project.path)}
      isContextMenuOpen={projectContextMenu?.project.path === project.path}
      isRenaming={renamingProjectPath === project.path}
      renameValue={renamingProjectPath === project.path ? projectRenameValue : ''}
      onOpenFinder={openProjectInFinder}
      onRemove={removeProjectFromSidebar}
      onContextMenu={openProjectContextMenu}
      onRenameCancel={() => setRenamingProjectPath(null)}
      onRenameSubmit={submitProjectRename}
      onRenameValueChange={setProjectRenameValue}
      onStartChat={startProjectChat}
      onStartRename={startRenamingProject}
      onTogglePinned={toggleProjectPinned}
      onToggle={toggleProject}
    />
  )

  const renderProjectGroup = (project: ProjectEntry): React.JSX.Element => {
    const projectSessions = projectSessionsByPath.get(project.path) ?? []
    const projectExpanded = !collapsedProjectPaths.includes(project.path)

    return (
      <div key={project.path} className="flex min-w-0 flex-col">
        {renderProjectItem(project)}
        {projectExpanded ? (
          projectSessions.length > 0 ? (
            <div className="mt-0.5 flex min-w-0 flex-col gap-px">
              {projectSessions.map((entry) => renderSessionItem(entry, { isProjectChild: true }))}
            </div>
          ) : (
            <p className="select-none py-1.5 pr-2.5 pl-[34px] text-[14px] text-muted-foreground/45">
              {t('nav.noSessions')}
            </p>
          )
        ) : null}
      </div>
    )
  }

  return (
    <Sidebar>
      <SidebarContent className="overflow-hidden pb-1 pl-2">
        <SidebarGroup
          className={cn('shrink-0 gap-px pt-2', collapsed ? 'items-center px-0' : 'pl-0 pr-2')}
        >
          <AppNavItem
            label={t('nav.newSession')}
            icon={SquarePen}
            active={false}
            collapsed={collapsed}
            shortcut={NEW_SESSION_HOTKEY}
            onClick={startNewSession}
          />
          <AppNavItem
            label={t('nav.search')}
            icon={Search}
            active={searchOpen}
            collapsed={collapsed}
            shortcut={SEARCH_HOTKEY}
            onClick={() => {
              onOpenSearch()
            }}
          />
          <AppNavItem
            label={t('nav.automation')}
            icon={Clock3}
            active={location.pathname.startsWith('/automation')}
            collapsed={collapsed}
            onClick={() => {
              navigate('/automation')
            }}
          />
          <AppNavItem
            label={t('nav.plugins')}
            icon={Lightbulb}
            active={location.pathname.startsWith('/plugins')}
            collapsed={collapsed}
            onClick={() => {
              navigate('/plugins')
            }}
          />
          <AppNavItem
            label={t('nav.artifacts')}
            icon={GalleryVerticalEnd}
            active={location.pathname === '/artifacts'}
            collapsed={collapsed}
            onClick={() => {
              navigate('/artifacts')
            }}
          />
        </SidebarGroup>

        <SidebarGroup className={cn('min-h-0 flex-1 pt-0', collapsed ? 'px-0' : 'px-0')}>
          <div className="relative min-h-0 flex-1">
            <div
              className={cn(
                'pointer-events-none absolute inset-x-0 top-0 z-10 h-2.5 bg-linear-to-b from-sidebar to-transparent opacity-0 transition-opacity duration-150',
                sessionListFade.top && 'opacity-100'
              )}
              aria-hidden="true"
            />
            <div
              ref={sessionListRef}
              onScroll={updateSessionListFade}
              className={cn(
                'chat-scrollbar flex h-full min-h-0 flex-col gap-px overflow-y-auto',
                collapsed && 'items-center'
              )}
            >
              {collapsed ? (
                <>
                  {projects.map((project) => renderProjectItem(project))}
                  {sortedSessionIndex.map((entry) => renderSessionItem(entry))}
                </>
              ) : (
                <>
                  {pinnedProjects.length > 0 || pinnedSessionIndex.length > 0 ? (
                    <>
                      <SessionSectionHeader
                        label={t('nav.pinnedSessions')}
                        collapsed={pinnedCollapsed}
                        onToggle={() => {
                          setPinnedCollapsed((value) => !value)
                        }}
                      />
                      {pinnedCollapsed ? null : (
                        <>
                          {pinnedProjects.map((project) => renderProjectGroup(project))}
                          {pinnedSessionIndex.length > 0 ? (
                            <DndContext
                              sensors={pinnedSensors}
                              collisionDetection={closestCenter}
                              onDragEnd={finishPinnedSessionSort}
                            >
                              <SortableContext
                                items={pinnedSessionIds}
                                strategy={verticalListSortingStrategy}
                              >
                                {pinnedSessionIndex.map((entry) => (
                                  <SortablePinnedSessionItem
                                    key={entry.sessionId}
                                    sessionId={entry.sessionId}
                                  >
                                    {({ isDragging }) => renderSessionItem(entry, { isDragging })}
                                  </SortablePinnedSessionItem>
                                ))}
                              </SortableContext>
                            </DndContext>
                          ) : null}
                        </>
                      )}
                    </>
                  ) : null}
                  <SessionSectionHeader
                    label={t('nav.projects')}
                    collapsed={projectsCollapsed}
                    onToggle={() => {
                      setProjectsCollapsed((value) => !value)
                    }}
                    actions={
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={toggleAllProjects}
                              disabled={allProjectPaths.length === 0}
                              className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-sidebar-hover hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/70"
                              aria-label={t(
                                allProjectGroupsCollapsed
                                  ? 'nav.expandProjects'
                                  : 'nav.collapseProjects'
                              )}
                            >
                              {allProjectGroupsCollapsed ? (
                                <Maximize2 className="size-3" strokeWidth={1.75} />
                              ) : (
                                <Minimize2 className="size-3" strokeWidth={1.75} />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={6}>
                            {t(
                              allProjectGroupsCollapsed
                                ? 'nav.expandProjects'
                                : 'nav.collapseProjects'
                            )}
                          </TooltipContent>
                        </Tooltip>
                        <DropdownMenu
                          open={projectSortMenuOpen}
                          onOpenChange={setProjectSortMenuOpen}
                        >
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                'flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-sidebar-hover hover:text-foreground',
                                projectSortMenuOpen && 'bg-sidebar-hover text-foreground'
                              )}
                              aria-label={t('nav.organizeProjects')}
                              title={t('nav.organizeProjects')}
                            >
                              <ListFilter className="size-3" strokeWidth={1.75} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="bottom" className="w-44">
                            <DropdownMenuLabel>{t('nav.sortBy')}</DropdownMenuLabel>
                            {(['updated', 'created', 'name'] as const).map((value) => (
                              <DropdownMenuItem
                                key={value}
                                selected={projectSortKey === value}
                                onSelect={() => {
                                  void updateProjectSortKey(value).catch(console.error)
                                }}
                                className="justify-between text-foreground/90"
                              >
                                <span>
                                  {t(
                                    value === 'updated'
                                      ? 'nav.sortUpdated'
                                      : value === 'created'
                                        ? 'nav.sortCreated'
                                        : 'nav.sortName'
                                  )}
                                </span>
                                <DropdownMenuItemCheck visible={projectSortKey === value} />
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <DropdownMenu open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                '-mr-2 flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-sidebar-hover hover:text-foreground',
                                projectMenuOpen && 'bg-sidebar-hover text-foreground'
                              )}
                              aria-label={t('nav.projectActions')}
                            >
                              <FolderPlus className="size-3" strokeWidth={1.75} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" side="bottom" className="w-56">
                            <DropdownMenuItem
                              disabled={projectActionPending}
                              onSelect={() => {
                                void runProjectAction('scratch')
                              }}
                              className="text-foreground/90"
                            >
                              <FolderPlus className="size-3.5 shrink-0" strokeWidth={1.75} />
                              <span>{t('nav.startProjectFromScratch')}</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={projectActionPending}
                              onSelect={() => {
                                void runProjectAction('existing')
                              }}
                              className="text-foreground/90"
                            >
                              <FolderOpen className="size-3.5 shrink-0" strokeWidth={1.75} />
                              <span>{t('nav.useExistingProjectFolder')}</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    }
                  />
                  {projectsCollapsed ? null : regularProjects.length > 0 ? (
                    regularProjects.map((project) => renderProjectGroup(project))
                  ) : (
                    <p className="px-6 py-1.5 text-[14px] text-muted-foreground/45">
                      {t('nav.noProjects')}
                    </p>
                  )}
                  <SessionSectionHeader
                    label={t('nav.sessions')}
                    collapsed={chatsCollapsed}
                    onToggle={() => {
                      setChatsCollapsed((value) => !value)
                    }}
                    actions={
                      <>
                        <DropdownMenu open={sortMenuOpen} onOpenChange={setSortMenuOpen}>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                'flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-sidebar-hover hover:text-foreground',
                                sortMenuOpen && 'bg-sidebar-hover text-foreground'
                              )}
                              aria-label={t('nav.organizeChats')}
                              title={t('nav.organizeChats')}
                            >
                              <ListFilter className="size-3" strokeWidth={1.75} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="bottom" className="w-44">
                            <DropdownMenuLabel>{t('nav.sortBy')}</DropdownMenuLabel>
                            {(['updated', 'created'] as const).map((value) => (
                              <DropdownMenuItem
                                key={value}
                                selected={sessionIndexSortKey === value}
                                onSelect={() => {
                                  void loadSessionIndex(value)
                                }}
                                className="justify-between text-foreground/90"
                              >
                                <span>
                                  {t(value === 'updated' ? 'nav.sortUpdated' : 'nav.sortCreated')}
                                </span>
                                <DropdownMenuItemCheck visible={sessionIndexSortKey === value} />
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <button
                          type="button"
                          onClick={startNewSession}
                          className="-mr-2 flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-sidebar-hover hover:text-foreground"
                          aria-label={t('nav.newSession')}
                          title={t('nav.newSession')}
                        >
                          <SquarePen className="size-3" strokeWidth={1.75} />
                        </button>
                      </>
                    }
                  />
                  {chatsCollapsed ? null : nonProjectChatSessionIndex.length > 0 ? (
                    nonProjectChatSessionIndex.map((entry) => renderSessionItem(entry))
                  ) : sessionIndexLoaded ? (
                    <p className="select-none px-6 py-1.5 text-[14px] text-muted-foreground/45">
                      {t('nav.noSessions')}
                    </p>
                  ) : null}
                </>
              )}
            </div>
            <div
              className={cn(
                'pointer-events-none absolute inset-x-0 bottom-0 z-10 h-4 bg-linear-to-t from-sidebar to-transparent opacity-0 transition-opacity duration-150',
                showBottomFade && 'opacity-100'
              )}
              aria-hidden="true"
            />
          </div>
        </SidebarGroup>
      </SidebarContent>

      {sessionMenu ? (
        <SessionContextMenu
          ref={sessionMenuRef}
          entry={sessionMenu.entry}
          unread={unreadSessionIdSet.has(sessionMenu.entry.sessionId)}
          className="fixed z-100 w-[218px]"
          style={{ left: sessionMenu.x, top: sessionMenu.y }}
          onClose={closeSessionMenu}
          onTogglePinned={(entry) => {
            void toggleSessionPinned(entry.sessionId, !entry.pinned).catch(console.error)
          }}
          onRename={startRenamingSession}
          onToggleUnread={(entry) => {
            if (unreadSessionIdSet.has(entry.sessionId)) {
              clearSessionUnread(entry.sessionId)
              clearSideChatUnreadForParent(entry.sessionId)
            } else {
              markSessionUnread(entry.sessionId)
            }
          }}
          onArchive={(entry) => {
            setConfirmRemoveSessionId(entry.sessionId)
          }}
        />
      ) : null}

      {projectContextMenu ? (
        <ProjectContextMenu
          ref={projectContextMenuRef}
          project={projectContextMenu.project}
          className="fixed z-100 w-56"
          style={{ left: projectContextMenu.x, top: projectContextMenu.y }}
          onClose={closeProjectContextMenu}
          onTogglePinned={toggleProjectPinned}
          onOpenFinder={openProjectInFinder}
          onRename={startRenamingProject}
          onRemove={removeProjectFromSidebar}
        />
      ) : null}

      <SessionSidebarFooter
        collapsed={collapsed}
        settingsLanguage={settingsLanguage}
        accountMenuOpen={accountMenuOpen}
        settingsActive={location.pathname.startsWith('/settings')}
        onAccountMenuOpenChange={setAccountMenuOpen}
        onOpenSettings={(_source) => {
          closeAccountMenu()
          navigate('/settings')
        }}
        onSelectLanguage={(value) => void selectLanguage(value)}
      />
    </Sidebar>
  )
}

export const SessionSidebar = memo(SessionSidebarBase)
SessionSidebar.displayName = 'SessionSidebar'
