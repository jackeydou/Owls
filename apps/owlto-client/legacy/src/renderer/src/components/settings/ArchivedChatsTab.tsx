import type { ProjectEntry, SessionIndexEntry } from '@renderer/../../preload/index.d'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemCheck,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { useProjectsStore } from '@renderer/stores/projects-store'
import {
  ChevronDown,
  Folder,
  FolderOpen,
  ListFilter,
  Loader2,
  MoreHorizontal,
  Search,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SettingsButton, SettingsCard, SettingsTextInput } from './settings-ui'

type ArchivedSortKey = 'updated' | 'created' | 'alphabetical'
type ProjectDisplayMode = 'project' | 'none'

type ArchivedSessionGroup = {
  key: string
  project: ProjectEntry | null
  sessions: SessionIndexEntry[]
}

function formatArchivedDate(value: string | null | undefined, language: string): string {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

function timestamp(value: string | null | undefined): number {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return 0
  return date.getTime()
}

function normalizedPath(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function isPathInsideProject(cwd: string, projectPath: string): boolean {
  const normalizedCwd = normalizedPath(cwd)
  const normalizedProjectPath = normalizedPath(projectPath)
  if (!normalizedProjectPath) return false
  return (
    normalizedCwd === normalizedProjectPath || normalizedCwd.startsWith(`${normalizedProjectPath}/`)
  )
}

function findSessionProject(
  session: SessionIndexEntry,
  projectsByPathLength: ProjectEntry[]
): ProjectEntry | null {
  return (
    projectsByPathLength.find((project) => isPathInsideProject(session.cwd, project.path)) ?? null
  )
}

function compareArchivedSessions(
  left: SessionIndexEntry,
  right: SessionIndexEntry,
  sortKey: ArchivedSortKey
): number {
  if (sortKey === 'alphabetical') {
    return (
      (left.title || left.sessionId).localeCompare(right.title || right.sessionId) ||
      timestamp(right.archivedAt ?? right.updatedAt) - timestamp(left.archivedAt ?? left.updatedAt)
    )
  }

  const leftTime =
    sortKey === 'created' ? timestamp(left.createdAt) : timestamp(left.archivedAt ?? left.updatedAt)
  const rightTime =
    sortKey === 'created'
      ? timestamp(right.createdAt)
      : timestamp(right.archivedAt ?? right.updatedAt)
  return (
    rightTime - leftTime ||
    (left.title || left.sessionId).localeCompare(right.title || right.sessionId)
  )
}

export function ArchivedChatsTab(): React.JSX.Element {
  const { language, t } = useI18n()
  const projects = useProjectsStore((state) => state.projects)
  const projectsLoaded = useProjectsStore((state) => state.loaded)
  const loadProjects = useProjectsStore((state) => state.load)
  const [sessions, setSessions] = useState<SessionIndexEntry[]>([])
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<ArchivedSortKey>('updated')
  const [projectDisplay, setProjectDisplay] = useState<ProjectDisplayMode>('project')
  const [loading, setLoading] = useState(true)
  const [busySessionId, setBusySessionId] = useState<string | null>(null)
  const [busyProjectKey, setBusyProjectKey] = useState<string | null>(null)
  const [busyAll, setBusyAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const actionBusy = busyAll || busyProjectKey !== null
  const groupingProjects = projectDisplay === 'project'
  const listLoading = loading || (groupingProjects && !projectsLoaded)

  const loadArchivedSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSessions(await window.api.agent.archivedSessionIndex())
    } catch (nextError) {
      console.error(nextError)
      setError(t('archivedChats.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadArchivedSessions()
  }, [loadArchivedSessions])

  useEffect(() => {
    if (!projectsLoaded) void loadProjects()
  }, [loadProjects, projectsLoaded])

  const projectsByPathLength = useMemo(
    () =>
      [...projects].sort(
        (left, right) => normalizedPath(right.path).length - normalizedPath(left.path).length
      ),
    [projects]
  )

  const visibleSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return sessions
      .map((session) => ({
        session,
        project: findSessionProject(session, projectsByPathLength)
      }))
      .filter(({ session, project }) => {
        if (!normalizedQuery) return true
        return (
          session.title.toLocaleLowerCase().includes(normalizedQuery) ||
          session.cwd.toLocaleLowerCase().includes(normalizedQuery) ||
          session.sessionId.toLocaleLowerCase().includes(normalizedQuery) ||
          project?.name.toLocaleLowerCase().includes(normalizedQuery) ||
          project?.path.toLocaleLowerCase().includes(normalizedQuery)
        )
      })
      .sort((left, right) => compareArchivedSessions(left.session, right.session, sortKey))
  }, [projectsByPathLength, query, sessions, sortKey])

  const groupedSessions = useMemo(() => {
    const groups = new Map<string, ArchivedSessionGroup>()
    for (const { session, project } of visibleSessions) {
      const key = project?.path ?? '__none__'
      const existing = groups.get(key)
      if (existing) {
        existing.sessions.push(session)
        continue
      }
      groups.set(key, { key, project, sessions: [session] })
    }
    return Array.from(groups.values())
  }, [visibleSessions])

  const formatChatCount = useCallback(
    (count: number) =>
      t(count === 1 ? 'archivedChats.countOne' : 'archivedChats.countMany', { count }),
    [t]
  )

  const sortLabel = t(
    sortKey === 'updated'
      ? 'archivedChats.sortUpdated'
      : sortKey === 'created'
        ? 'archivedChats.sortCreated'
        : 'archivedChats.sortAlphabetical'
  )

  const unarchiveSession = useCallback(
    async (sessionId: string) => {
      setBusySessionId(sessionId)
      setError(null)
      try {
        await window.api.agent.sessionIndexUnarchive(sessionId)
        await loadArchivedSessions()
      } catch (nextError) {
        console.error(nextError)
        setError(t('archivedChats.error'))
      } finally {
        setBusySessionId(null)
      }
    },
    [loadArchivedSessions, t]
  )

  const deleteArchivedSession = useCallback(
    async (sessionId: string) => {
      if (!window.confirm(t('archivedChats.deleteConfirm'))) return
      setBusySessionId(sessionId)
      setError(null)
      try {
        await window.api.agent.archivedSessionDelete(sessionId)
        await loadArchivedSessions()
      } catch (nextError) {
        console.error(nextError)
        setError(t('archivedChats.error'))
      } finally {
        setBusySessionId(null)
      }
    },
    [loadArchivedSessions, t]
  )

  const openWorkingDirectory = useCallback(
    async (cwd: string) => {
      const trimmed = cwd.trim()
      if (!trimmed) return
      setError(null)
      try {
        await window.api.attachments.reveal(trimmed)
      } catch (nextError) {
        console.error(nextError)
        setError(t('archivedChats.error'))
      }
    },
    [t]
  )

  const deleteAllArchivedSessions = useCallback(async () => {
    if (sessions.length === 0 || !window.confirm(t('archivedChats.deleteAllConfirm'))) return
    setBusyAll(true)
    setError(null)
    try {
      await window.api.agent.archivedSessionsDeleteAll()
      await loadArchivedSessions()
    } catch (nextError) {
      console.error(nextError)
      setError(t('archivedChats.error'))
    } finally {
      setBusyAll(false)
    }
  }, [loadArchivedSessions, sessions.length, t])

  const deleteArchivedSessionsInGroup = useCallback(
    async (groupKey: string, groupSessions: SessionIndexEntry[]) => {
      if (groupSessions.length === 0 || !window.confirm(t('archivedChats.deleteGroupConfirm'))) {
        return
      }
      setBusyProjectKey(groupKey)
      setError(null)
      try {
        await Promise.all(
          groupSessions.map((session) => window.api.agent.archivedSessionDelete(session.sessionId))
        )
        await loadArchivedSessions()
      } catch (nextError) {
        console.error(nextError)
        setError(t('archivedChats.error'))
      } finally {
        setBusyProjectKey(null)
      }
    },
    [loadArchivedSessions, t]
  )

  const renderArchivedSessionRow = (session: SessionIndexEntry): React.JSX.Element => {
    const busy = busySessionId === session.sessionId
    return (
      <div
        key={session.sessionId}
        className="group flex min-h-[82px] items-center justify-between gap-4 border-b border-border/55 px-3.5 py-3 transition hover:bg-foreground/3 last:border-b-0"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-5 text-foreground">
            {session.title || session.sessionId}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] leading-5 text-muted-foreground">
            {formatArchivedDate(session.archivedAt ?? session.updatedAt, language)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <SettingsButton
                variant="secondary"
                className="w-9 px-0"
                disabled={actionBusy || !session.cwd.trim()}
                aria-label={t('archivedChats.openWorkingDirectory')}
                onClick={(event) => {
                  event.currentTarget.blur()
                  void openWorkingDirectory(session.cwd)
                }}
              >
                <FolderOpen className="size-3.5" strokeWidth={1.8} />
              </SettingsButton>
            </TooltipTrigger>
            <TooltipContent side="top">{t('archivedChats.openWorkingDirectory')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <SettingsButton
                variant="danger"
                className="w-9 px-0"
                disabled={busy || actionBusy}
                aria-label={t('archivedChats.delete')}
                onClick={(event) => {
                  event.currentTarget.blur()
                  void deleteArchivedSession(session.sessionId)
                }}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
                ) : (
                  <Trash2 className="size-3.5" strokeWidth={1.8} />
                )}
              </SettingsButton>
            </TooltipTrigger>
            <TooltipContent side="top">{t('archivedChats.delete')}</TooltipContent>
          </Tooltip>
          <SettingsButton
            variant="secondary"
            disabled={busy || actionBusy}
            onClick={(event) => {
              event.currentTarget.blur()
              void unarchiveSession(session.sessionId)
            }}
          >
            {t('archivedChats.unarchive')}
          </SettingsButton>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[20px] font-semibold leading-none text-foreground">
          {t('archivedChats.title')}
        </h2>
        <SettingsButton
          variant="danger"
          disabled={actionBusy || sessions.length === 0}
          onClick={() => void deleteAllArchivedSessions()}
        >
          {busyAll ? <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} /> : null}
          <Trash2 className={cn('size-3.5', busyAll && 'hidden')} strokeWidth={1.8} />
          {t('archivedChats.deleteAll')}
        </SettingsButton>
      </div>

      <SettingsCard className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border/55 p-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.8}
              />
              <SettingsTextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('archivedChats.search')}
                aria-label={t('archivedChats.search')}
                className="w-full border-0 bg-foreground/5 pl-9 hover:bg-foreground/7"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-[34px] w-[148px] shrink-0 items-center justify-between rounded-lg bg-foreground/5 px-3 text-[13px] font-normal text-foreground transition hover:bg-foreground/7 focus:outline-none focus:ring-2 focus:ring-foreground/10"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ListFilter className="size-3.5 shrink-0" strokeWidth={1.8} />
                    <span className="truncate">{sortLabel}</span>
                  </span>
                  <ChevronDown
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.8}
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" className="w-44">
                <DropdownMenuLabel>{t('archivedChats.sortBy')}</DropdownMenuLabel>
                {(['updated', 'created', 'alphabetical'] as const).map((value) => (
                  <DropdownMenuItem
                    key={value}
                    selected={sortKey === value}
                    onSelect={() => setSortKey(value)}
                    className="justify-between text-foreground/90"
                  >
                    <span>
                      {t(
                        value === 'updated'
                          ? 'archivedChats.sortUpdated'
                          : value === 'created'
                            ? 'archivedChats.sortCreated'
                            : 'archivedChats.sortAlphabetical'
                      )}
                    </span>
                    <DropdownMenuItemCheck visible={sortKey === value} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-[34px] w-[148px] shrink-0 items-center justify-between rounded-lg bg-foreground/5 px-3 text-[13px] font-normal text-foreground transition hover:bg-foreground/7 focus:outline-none focus:ring-2 focus:ring-foreground/10"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Folder className="size-3.5 shrink-0" strokeWidth={1.8} />
                    <span className="truncate">
                      {projectDisplay === 'project'
                        ? t('archivedChats.project')
                        : t('archivedChats.noProject')}
                    </span>
                  </span>
                  <ChevronDown
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.8}
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" className="w-40">
                {(['project', 'none'] as const).map((value) => (
                  <DropdownMenuItem
                    key={value}
                    selected={projectDisplay === value}
                    onSelect={() => setProjectDisplay(value)}
                    className="justify-between text-foreground/90"
                  >
                    <span>
                      {value === 'project'
                        ? t('archivedChats.project')
                        : t('archivedChats.noProject')}
                    </span>
                    <DropdownMenuItemCheck visible={projectDisplay === value} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {error ? (
          <div className="shrink-0 border-b border-border/55 px-3.5 py-2 text-[13px] text-destructive">
            {error}
          </div>
        ) : null}

        {listLoading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
            {t('archivedChats.loading')}
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-muted-foreground">
            {t('archivedChats.empty')}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {groupingProjects ? (
              groupedSessions.map((group, index) => (
                <div key={group.key}>
                  <div
                    className={cn(
                      'flex min-h-11 items-center justify-between gap-4 border-b border-border/55 px-3.5 py-2 text-muted-foreground',
                      index > 0 && 'border-t'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2 text-[13px] leading-5">
                      <Folder className="size-3.5 shrink-0" strokeWidth={1.8} />
                      <span className="truncate">
                        {group.project?.name ?? t('archivedChats.noProject')}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-[13px] leading-5">
                      <span>{formatChatCount(group.sessions.length)}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={actionBusy}
                            aria-label={
                              group.project
                                ? t('archivedChats.deleteAllInProject')
                                : t('archivedChats.deleteAllInGroup')
                            }
                          >
                            {busyProjectKey === group.key ? (
                              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
                            ) : (
                              <MoreHorizontal className="size-3.5" strokeWidth={1.8} />
                            )}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="bottom" className="w-[220px]">
                          <DropdownMenuItem
                            danger
                            onSelect={() =>
                              void deleteArchivedSessionsInGroup(group.key, group.sessions)
                            }
                            className="gap-3 text-[13px]"
                          >
                            <Trash2 className="size-3.5 shrink-0" strokeWidth={1.8} />
                            <span>
                              {group.project
                                ? t('archivedChats.deleteAllInProject')
                                : t('archivedChats.deleteAllInGroup')}
                            </span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {group.sessions.map((session) => renderArchivedSessionRow(session))}
                </div>
              ))
            ) : (
              <>
                <div className="border-b border-border/55 px-3.5 py-2 text-[12px] text-muted-foreground">
                  {formatChatCount(visibleSessions.length)}
                </div>
                {visibleSessions.map(({ session }) => renderArchivedSessionRow(session))}
              </>
            )}
          </div>
        )}
      </SettingsCard>
    </div>
  )
}
