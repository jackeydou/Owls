import {
  AlertCircle,
  Braces,
  ChevronDown,
  FileJson,
  FolderOpen,
  GitCompareArrows,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  TerminalSquare,
  TextSearch
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  formatBytes,
  formatDuration,
  type NormalizedEvent,
  type PromptBlock,
  profileParseCodexSession,
  type SessionFile,
  type SessionView
} from './parser'
import './styles.css'

const samplePath =
  '/Users/example/.codex/sessions/2026/05/07/rollout-2026-05-07T13-16-02-example.jsonl'
export const latestPichuSessionPath = 'pichu://latest'
const initialVisibleEvents = 320
const visibleEventBatchSize = 320

const categories = [
  'all',
  'meta',
  'message',
  'reasoning',
  'tool_call',
  'tool_output',
  'web',
  'token',
  'event'
] as const

type CategoryFilter = (typeof categories)[number]
type DetailMode = 'event' | 'prompt' | 'raw' | 'compare'
type SourceFilter = 'all' | 'codex' | 'pichu' | 'trajectory'
type CompareSide = 'left' | 'right'
type CompareSlot = {
  event: NormalizedEvent
  sessionPath: string
  sessionTitle: string
  sessionSource: string
  sessionModel: string
}
type CompareSlots = Record<CompareSide, CompareSlot | null>

function loadStoredPath() {
  return window.localStorage.getItem('session-inspector:path') || samplePath
}

function isLegacyLatestPichuPath(value: string): boolean {
  return (
    value.endsWith('/.pichu/pichu.db') ||
    value.endsWith('\\.pichu\\pichu.db') ||
    value.endsWith('pichu.db')
  )
}

function isLatestPichuPath(value: string): boolean {
  return value === latestPichuSessionPath || isLegacyLatestPichuPath(value)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function loadStoredSidebarWidth() {
  const stored = Number(window.localStorage.getItem('session-inspector:sidebar-width'))
  return Number.isFinite(stored) ? clamp(stored, 220, 520) : 304
}

function loadStoredSidebarCollapsed(defaultCollapsed = false) {
  const stored = window.localStorage.getItem('session-inspector:sidebar-collapsed')
  return stored === null ? defaultCollapsed : stored === 'true'
}

function roundTimingMap(timings: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(timings).map(([key, value]) => [key, Number(value.toFixed(1))])
  )
}

function logLoadProfile(
  label: string,
  profile: ReturnType<typeof profileParseCodexSession>,
  timings: Record<string, number>
) {
  const stateStart = performance.now()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const payload = {
        label,
        counts: profile.counts,
        timings: {
          ...roundTimingMap(timings),
          ...roundTimingMap(profile.timings),
          commitApproxMs: Number((performance.now() - stateStart).toFixed(1))
        }
      }
      console.info(`[session-inspector] load profile ${JSON.stringify(payload)}`)
    })
  })
}

export type SessionText = {
  body: string
  title: string
}

export type SessionListResult = {
  root?: string
  sessions: SessionFile[]
}

export type SessionInspectorDataSource = {
  listSessions: (input?: {
    includeOptional?: boolean
    limit?: number
  }) => Promise<SessionListResult>
  readSessionText: (path: string) => Promise<SessionText>
}

export type InspectorAppProps = {
  dataSource: SessionInspectorDataSource
  defaultSidebarCollapsed?: boolean
  initialPath?: string
}

function shortPath(value: string) {
  if (value.startsWith('pichu://')) return value
  return value.split(/[\\/]/).filter(Boolean).slice(-3).join('/')
}

function sessionSourceFor(path: string, view: SessionView | null) {
  const source = (view?.meta.source || '').toLowerCase()
  const originator = (view?.meta.originator || '').toLowerCase()
  if (
    path.includes('/.pichu/model-trajectories/') ||
    source === 'trajectory' ||
    originator.includes('trajectory')
  )
    return 'trajectory'
  if (path.startsWith('pichu://') || source === 'pichu' || originator.includes('pichu'))
    return 'pichu'
  return 'codex'
}

export function InspectorApp({
  dataSource,
  defaultSidebarCollapsed = false,
  initialPath = loadStoredPath()
}: InspectorAppProps) {
  const [path, setPath] = useState(initialPath)
  const [text, setText] = useState('')
  const [view, setView] = useState<SessionView | null>(null)
  const [sessions, setSessions] = useState<SessionFile[]>([])
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>('')
  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [detailMode, setDetailMode] = useState<DetailMode>('event')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(loadStoredSidebarWidth)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    loadStoredSidebarCollapsed(defaultSidebarCollapsed)
  )
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const [compareSlots, setCompareSlots] = useState<CompareSlots>({ left: null, right: null })
  const [visibleEventCount, setVisibleEventCount] = useState(initialVisibleEvents)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const initialLoadStartedRef = useRef(false)
  const listRequestIdRef = useRef(0)
  const loadRequestIdRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const requestId = ++listRequestIdRef.current
    let cancelled = false
    dataSource
      .listSessions({ limit: 160 })
      .then((result) => {
        if (!cancelled && mountedRef.current && requestId === listRequestIdRef.current) {
          setSessions(result.sessions)
        }
      })
      .catch((err) => {
        if (!cancelled && mountedRef.current && requestId === listRequestIdRef.current) {
          setError(err.message)
        }
      })
    return () => {
      cancelled = true
    }
  }, [dataSource])

  const loadPath = useCallback(
    async (nextPath = path) => {
      const requestId = ++loadRequestIdRef.current
      const isCurrentRequest = () => mountedRef.current && requestId === loadRequestIdRef.current
      setLoading(true)
      setError('')
      try {
        if (isLatestPichuPath(nextPath)) {
          const result = await dataSource.listSessions({ includeOptional: false, limit: 160 })
          const latestPichu = result.sessions.find(
            (session) => session.source === 'pichu' && session.sessionId
          )
          if (!isCurrentRequest()) return
          setSessions(result.sessions)
          if (!latestPichu?.sessionId) {
            setText('')
            setView(null)
            setSelectedId('')
            setSelectedPromptId('')
            setDetailMode('event')
            setVisibleEventCount(initialVisibleEvents)
            setPath(latestPichuSessionPath)
            window.localStorage.setItem('session-inspector:path', latestPichuSessionPath)
            return
          }
          nextPath = `pichu://${latestPichu.sessionId}`
        }
        const readStart = performance.now()
        const { body, title } = await dataSource.readSessionText(nextPath)
        const readEnd = performance.now()
        const profile = profileParseCodexSession(body, nextPath)
        const parsed = profile.view
        if (title && !parsed.meta.title) parsed.meta.title = title
        if (!isCurrentRequest()) return
        setText(body)
        setView(parsed)
        setPath(nextPath)
        setSelectedId(parsed.events[0]?.id || '')
        setSelectedPromptId(parsed.prompts[0]?.id || '')
        setDetailMode('event')
        setVisibleEventCount(initialVisibleEvents)
        window.localStorage.setItem('session-inspector:path', nextPath)
        logLoadProfile('path', profile, { readSessionTextMs: readEnd - readStart })
      } catch (err) {
        if (isCurrentRequest()) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (isCurrentRequest()) {
          setLoading(false)
        }
      }
    },
    [dataSource, path]
  )

  useEffect(() => {
    if (initialLoadStartedRef.current) return
    initialLoadStartedRef.current = true
    void loadPath(initialPath)
  }, [initialPath, loadPath])

  async function loadSession(session: SessionFile) {
    const nextPath =
      session.source === 'pichu' && session.sessionId
        ? `pichu://${session.sessionId}`
        : session.path
    await loadPath(nextPath)
  }

  async function handleLocalFile(file: File) {
    const requestId = ++loadRequestIdRef.current
    const isCurrentRequest = () => mountedRef.current && requestId === loadRequestIdRef.current
    setLoading(true)
    setError('')
    try {
      if (!file.name.match(/\.(jsonl|ndjson|txt)$/i)) {
        throw new Error('Drop a .jsonl session or model trajectory file')
      }
      const readStart = performance.now()
      const body = await file.text()
      const readEnd = performance.now()
      const profile = profileParseCodexSession(body, file.name)
      const parsed = profile.view
      if (!isCurrentRequest()) return
      setText(body)
      setView(parsed)
      setPath(file.name)
      setSelectedId(parsed.events[0]?.id || '')
      setSelectedPromptId(parsed.prompts[0]?.id || '')
      setDetailMode('event')
      setVisibleEventCount(initialVisibleEvents)
      logLoadProfile('file', profile, { fileTextMs: readEnd - readStart })
    } catch (err) {
      if (isCurrentRequest()) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (isCurrentRequest()) {
        setLoading(false)
      }
    }
  }

  function hasFiles(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes('Files')
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDragActive(true)
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setDragActive(false)
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepthRef.current = 0
    setDragActive(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void handleLocalFile(file)
  }

  function toggleSidebar() {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    window.localStorage.setItem('session-inspector:sidebar-collapsed', String(next))
  }

  function handleSidebarResizeStart(event: React.PointerEvent<HTMLButtonElement>) {
    if (sidebarCollapsed) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    setSidebarResizing(true)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = clamp(startWidth + moveEvent.clientX - startX, 220, 520)
      setSidebarWidth(nextWidth)
      window.localStorage.setItem('session-inspector:sidebar-width', String(nextWidth))
    }

    const handlePointerUp = () => {
      setSidebarResizing(false)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  function pinCompare(side: CompareSide, event: NormalizedEvent) {
    const sessionSource = sessionSourceFor(path, view)
    const sessionTitle = view?.meta.title || view?.meta.id || shortPath(path) || 'loaded session'
    const sessionModel = view?.meta.model_id || view?.context.model || view?.meta.model || 'unknown'

    setCompareSlots((current) => ({
      ...current,
      [side]: {
        event,
        sessionPath: view?.path || path,
        sessionTitle,
        sessionSource,
        sessionModel
      }
    }))
    setDetailMode('compare')
  }

  function clearCompare(side?: CompareSide) {
    if (!side) {
      setCompareSlots({ left: null, right: null })
      return
    }
    setCompareSlots((current) => ({ ...current, [side]: null }))
  }

  const filteredEvents = useMemo(() => {
    if (!view) return []
    const needle = query.trim().toLowerCase()

    return view.events.filter((event) => {
      const categoryMatches = category === 'all' || event.category === category
      if (!categoryMatches) return false
      if (!needle) return true
      return event.searchText.includes(needle) || event.content.toLowerCase().includes(needle)
    })
  }, [view, category, query])
  const visibleEvents = filteredEvents.slice(0, visibleEventCount)

  const selectedEvent =
    filteredEvents.find((event) => event.id === selectedId) ||
    view?.events.find((event) => event.id === selectedId) ||
    filteredEvents[0] ||
    null

  const selectedPrompt =
    view?.prompts.find((prompt) => prompt.id === selectedPromptId) || view?.prompts[0] || null
  const workspaceStyle = {
    '--sidebar-width': `${sidebarCollapsed ? 44 : sidebarWidth}px`
  } as React.CSSProperties

  useEffect(() => {
    if (filteredEvents.length && !filteredEvents.some((event) => event.id === selectedId)) {
      setSelectedId(filteredEvents[0].id)
    }
  }, [filteredEvents, selectedId])

  function handleTraceScroll(event: React.UIEvent<HTMLDivElement>) {
    const target = event.currentTarget
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    if (distanceToBottom > 900 || visibleEventCount >= filteredEvents.length) return
    setVisibleEventCount((current) =>
      Math.min(filteredEvents.length, current + visibleEventBatchSize)
    )
  }

  return (
    <div
      className="session-inspector-root app-shell"
      role="application"
      aria-label="Session Inspector"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragActive && (
        <div className="drop-overlay">
          <div>
            <FileJson size={28} />
            <strong>Drop Codex session JSONL</strong>
            <span>The file will be parsed locally in this browser.</span>
          </div>
        </div>
      )}
      <header className="top">
        <div className="path-field">
          <FileJson size={17} />
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void loadPath()
            }}
          />
          <button type="button" onClick={() => loadPath()} disabled={loading}>
            Load
          </button>
        </div>
        <div className="top-actions">
          <button
            type="button"
            className="icon-button"
            title="Reload session"
            onClick={() => loadPath()}
            disabled={loading}
          >
            <RefreshCw size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Open JSONL file"
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderOpen size={18} />
          </button>
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept=".jsonl,.ndjson,.txt"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleLocalFile(file)
            }}
          />
        </div>
      </header>

      {error && (
        <section className="source-bar">
          <div className="error">
            <AlertCircle size={16} />
            {error}
          </div>
        </section>
      )}

      <main
        className={`workspace ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${sidebarResizing ? 'resizing' : ''} ${detailMode === 'compare' ? 'compare-active' : ''}`}
        style={workspaceStyle}
      >
        <aside className={`left-rail ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            {!sidebarCollapsed && <span>Sessions</span>}
            <button
              type="button"
              className="sidebar-toggle"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={toggleSidebar}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          </div>
          {!sidebarCollapsed && (
            <>
              <SessionPicker
                sessions={sessions}
                activePath={path}
                onSelect={(session) => loadSession(session)}
              />
              {view && <Stats view={view} />}
              {view && (
                <PromptIndex
                  prompts={view.prompts}
                  selectedPromptId={selectedPromptId}
                  onSelect={(prompt) => {
                    setSelectedPromptId(prompt.id)
                    setDetailMode('prompt')
                  }}
                />
              )}
            </>
          )}
        </aside>
        <button
          type="button"
          className="sidebar-resizer"
          aria-label="Drag to resize sidebar"
          title="Drag to resize sidebar"
          onPointerDown={handleSidebarResizeStart}
        />

        <section className="trace-pane">
          <div className="trace-toolbar">
            <div className="search-box">
              <Search size={17} />
              <input
                placeholder="Search role, tool, call id, prompt text..."
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setVisibleEventCount(initialVisibleEvents)
                }}
              />
            </div>
            <select
              className="event-filter-select"
              aria-label="Event filter"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as CategoryFilter)
                setVisibleEventCount(initialVisibleEvents)
              }}
            >
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="trace-list" onScroll={handleTraceScroll}>
            {!view && <EmptyState loading={loading} />}
            {view && filteredEvents.length === 0 && (
              <div className="empty">No matching events.</div>
            )}
            {visibleEvents.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                active={selectedEvent?.id === event.id && detailMode !== 'prompt'}
                onClick={() => {
                  setSelectedId(event.id)
                  setDetailMode('event')
                }}
              />
            ))}
            {visibleEvents.length < filteredEvents.length && (
              <button
                type="button"
                className="load-more-events"
                onClick={() =>
                  setVisibleEventCount((current) =>
                    Math.min(filteredEvents.length, current + visibleEventBatchSize)
                  )
                }
              >
                Show{' '}
                {Math.min(
                  visibleEventBatchSize,
                  filteredEvents.length - visibleEvents.length
                ).toLocaleString()}{' '}
                more
              </button>
            )}
          </div>
        </section>

        <aside className="detail-pane">
          <div className="detail-tabs">
            <button
              type="button"
              className={detailMode === 'event' ? 'active' : ''}
              onClick={() => setDetailMode('event')}
            >
              <MessageSquareText size={16} />
              Event
            </button>
            <button
              type="button"
              className={detailMode === 'prompt' ? 'active' : ''}
              onClick={() => setDetailMode('prompt')}
            >
              <TextSearch size={16} />
              Prompt
            </button>
            <button
              type="button"
              className={detailMode === 'raw' ? 'active' : ''}
              onClick={() => setDetailMode('raw')}
            >
              <Braces size={16} />
              Raw
            </button>
            <button
              type="button"
              className={detailMode === 'compare' ? 'active' : ''}
              onClick={() => setDetailMode('compare')}
            >
              <GitCompareArrows size={16} />
              Compare
            </button>
          </div>
          {detailMode === 'event' && selectedEvent && (
            <EventDetail event={selectedEvent} onPinCompare={pinCompare} />
          )}
          {detailMode === 'prompt' && selectedPrompt && <PromptDetail prompt={selectedPrompt} />}
          {detailMode === 'raw' && <RawDetail event={selectedEvent} text={text} />}
          {detailMode === 'compare' && (
            <CompareDetail slots={compareSlots} onClear={clearCompare} />
          )}
        </aside>
      </main>
    </div>
  )
}

function SessionPicker({
  sessions,
  activePath,
  onSelect
}: {
  sessions: SessionFile[]
  activePath: string
  onSelect: (session: SessionFile) => void
}) {
  const [open, setOpen] = useState(true)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const filteredSessions = sessions.filter((session) => {
    if (sourceFilter === 'all') return true
    return (session.source || 'codex') === sourceFilter
  })
  const sourceCounts = sessions.reduce(
    (counts, session) => {
      counts[session.source || 'codex'] += 1
      return counts
    },
    { codex: 0, pichu: 0, trajectory: 0 } as Record<'codex' | 'pichu' | 'trajectory', number>
  )

  return (
    <section className="panel">
      <button type="button" className="panel-title" onClick={() => setOpen(!open)}>
        <span>Recent sessions</span>
        <ChevronDown className={open ? 'chevron open' : 'chevron'} size={16} />
      </button>
      {open && (
        <>
          <div className="source-filter">
            {(['all', 'codex', 'pichu', 'trajectory'] as const).map((source) => (
              <button
                type="button"
                key={source}
                className={sourceFilter === source ? 'active' : ''}
                onClick={() => setSourceFilter(source)}
              >
                <span>{source}</span>
                <small>{source === 'all' ? sessions.length : sourceCounts[source]}</small>
              </button>
            ))}
          </div>
          <div className="session-list">
            {filteredSessions.slice(0, 28).map((session) => (
              <button
                type="button"
                key={session.key || session.path}
                className={session.path === activePath ? 'session active' : 'session'}
                onClick={() => onSelect(session)}
                title={session.cwd || session.path}
              >
                <span>{session.name}</span>
                <small>
                  {session.source === 'pichu'
                    ? `${session.messageCount || 0} msgs`
                    : formatBytes(session.size)}
                </small>
                <em className={`source-pill ${session.source || 'codex'}`}>
                  {session.source || 'codex'}
                </em>
              </button>
            ))}
            {filteredSessions.length === 0 && (
              <div className="muted">
                No {sourceFilter === 'all' ? '' : sourceFilter} sessions found.
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function Stats({ view }: { view: SessionView }) {
  return (
    <section className="panel stats">
      <div className="panel-title static">Session</div>
      <div className="metric-grid">
        <Metric label="events" value={String(view.events.length)} />
        <Metric label="prompts" value={String(view.prompts.length)} />
        <Metric label="tools" value={String(view.stats.toolCalls)} />
        <Metric label="duration" value={formatDuration(view.stats.durationMs)} />
      </div>
      <dl className="meta-list">
        <div>
          <dt>model</dt>
          <dd>{view.meta.model_id || view.context.model || view.meta.model || 'unknown'}</dd>
        </div>
        <div>
          <dt>cwd</dt>
          <dd title={view.meta.cwd || view.context.cwd}>
            {view.meta.cwd || view.context.cwd || 'unknown'}
          </dd>
        </div>
        <div>
          <dt>tokens</dt>
          <dd>{view.stats.totalTokens ? view.stats.totalTokens.toLocaleString() : 'n/a'}</dd>
        </div>
      </dl>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function PromptIndex({
  prompts,
  selectedPromptId,
  onSelect
}: {
  prompts: PromptBlock[]
  selectedPromptId: string
  onSelect: (prompt: PromptBlock) => void
}) {
  return (
    <section className="panel prompts-panel">
      <div className="panel-title static">Prompt blocks</div>
      <div className="prompt-list">
        {prompts.map((prompt) => (
          <button
            type="button"
            key={prompt.id}
            className={prompt.id === selectedPromptId ? 'prompt-link active' : 'prompt-link'}
            onClick={() => onSelect(prompt)}
          >
            <span>{prompt.title}</span>
            <small>{prompt.text.length.toLocaleString()} chars</small>
          </button>
        ))}
      </div>
    </section>
  )
}

function EventRow({
  event,
  active,
  onClick
}: {
  event: NormalizedEvent
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`event-row ${active ? 'active' : ''} ${event.category}`}
      onClick={onClick}
    >
      <div className="event-line">
        <span className="line-no">{event.line}</span>
        <span className="badge">{event.category.replace('_', ' ')}</span>
        <strong>{event.title}</strong>
        <span className="time">{event.timeLabel}</span>
      </div>
      <p>{event.excerpt}</p>
      <div className="event-meta">
        {event.role && <span>role {event.role}</span>}
        {event.phase && <span>phase {event.phase}</span>}
        {event.visibility && event.visibility !== 'shared' && <span>{event.visibility}</span>}
        {event.model && <span>{event.model}</span>}
        {event.callId && <span>{event.callId}</span>}
        {event.sizeLabel && <span>{event.sizeLabel}</span>}
      </div>
    </button>
  )
}

function EventDetail({
  event,
  onPinCompare
}: {
  event: NormalizedEvent
  onPinCompare: (side: CompareSide, event: NormalizedEvent) => void
}) {
  return (
    <div className="detail-content">
      <div className={`detail-heading ${event.category}`}>
        <div className="detail-heading-row">
          <div>
            <span className="badge">{event.category.replace('_', ' ')}</span>
            <h2>{event.title}</h2>
            <p>
              {event.timeLabel} · line {event.line}
            </p>
          </div>
          <div className="compare-actions">
            <button type="button" onClick={() => onPinCompare('left', event)}>
              Set A
            </button>
            <button type="button" onClick={() => onPinCompare('right', event)}>
              Set B
            </button>
          </div>
        </div>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>type</dt>
          <dd>{event.type}</dd>
        </div>
        <div>
          <dt>payload</dt>
          <dd>{event.payloadType || 'n/a'}</dd>
        </div>
        <div>
          <dt>role</dt>
          <dd>{event.role || 'n/a'}</dd>
        </div>
        <div>
          <dt>visibility</dt>
          <dd>{event.visibility || 'shared'}</dd>
        </div>
        <div>
          <dt>model</dt>
          <dd>{event.model || 'n/a'}</dd>
        </div>
        <div>
          <dt>provider</dt>
          <dd>{event.modelProvider || 'n/a'}</dd>
        </div>
        <div>
          <dt>api</dt>
          <dd>{event.modelApi || 'n/a'}</dd>
        </div>
        <div>
          <dt>call id</dt>
          <dd>{event.callId || 'n/a'}</dd>
        </div>
      </dl>
      <pre className="text-block">{event.content || event.excerpt}</pre>
    </div>
  )
}

function CompareDetail({
  slots,
  onClear
}: {
  slots: CompareSlots
  onClear: (side?: CompareSide) => void
}) {
  const left = slots.left
  const right = slots.right

  return (
    <div className="detail-content compare-content">
      <div className="compare-header">
        <div>
          <span className="badge">compare</span>
          <h2>Event comparison</h2>
          <p>
            Pin one event as A and another as B. They can come from Codex or Owls, same session or
            different sessions.
          </p>
        </div>
        <button type="button" onClick={() => onClear()} disabled={!left && !right}>
          Clear
        </button>
      </div>

      <CompareSummary left={left} right={right} />

      <div className="compare-grid">
        <CompareColumn label="A" slot={left} onClear={() => onClear('left')} />
        <CompareColumn label="B" slot={right} onClear={() => onClear('right')} />
      </div>
    </div>
  )
}

function CompareSummary({ left, right }: { left: CompareSlot | null; right: CompareSlot | null }) {
  if (!left || !right) {
    return (
      <div className="compare-summary empty-compare">
        Select an event, use Set A or Set B, then load or select another session and pin the other
        side.
      </div>
    )
  }

  const rows = [
    ['source', left.sessionSource, right.sessionSource],
    ['model', left.sessionModel, right.sessionModel],
    ['category', left.event.category, right.event.category],
    ['event', left.event.title, right.event.title],
    ['payload', left.event.payloadType || 'n/a', right.event.payloadType || 'n/a'],
    ['role', left.event.role || 'n/a', right.event.role || 'n/a'],
    ['visibility', left.event.visibility || 'shared', right.event.visibility || 'shared'],
    ['event model', left.event.model || 'n/a', right.event.model || 'n/a'],
    ['call id', left.event.callId || 'n/a', right.event.callId || 'n/a'],
    ['chars', String(left.event.content.length), String(right.event.content.length)]
  ]

  return (
    <div className="compare-summary">
      {rows.map(([label, a, b]) => (
        <div key={label} className={a === b ? '' : 'changed'}>
          <span>{label}</span>
          <strong>{a === b ? 'same' : 'different'}</strong>
          <em title={a === b ? a : `${a} -> ${b}`}>{a === b ? a : `${a} -> ${b}`}</em>
        </div>
      ))}
    </div>
  )
}

function CompareColumn({
  label,
  slot,
  onClear
}: {
  label: 'A' | 'B'
  slot: CompareSlot | null
  onClear: () => void
}) {
  if (!slot) {
    return (
      <section className="compare-column empty-slot">
        <strong>{label}</strong>
        <p>No event pinned.</p>
      </section>
    )
  }

  return (
    <section className="compare-column">
      <div className="compare-column-head">
        <div>
          <strong>{label}</strong>
          <span className={`source-pill ${slot.sessionSource}`}>{slot.sessionSource}</span>
        </div>
        <button type="button" onClick={onClear}>
          Clear
        </button>
      </div>
      <h3>{slot.event.title}</h3>
      <p title={slot.sessionPath}>{slot.sessionTitle}</p>
      <dl className="compare-meta">
        <div>
          <dt>line</dt>
          <dd>{slot.event.line}</dd>
        </div>
        <div>
          <dt>time</dt>
          <dd>{slot.event.timeLabel}</dd>
        </div>
        <div>
          <dt>type</dt>
          <dd>{slot.event.payloadType || slot.event.type}</dd>
        </div>
        <div>
          <dt>size</dt>
          <dd>{slot.event.sizeLabel || '0 chars'}</dd>
        </div>
      </dl>
      <pre className="compare-text">{slot.event.content || slot.event.excerpt}</pre>
    </section>
  )
}

function PromptDetail({ prompt }: { prompt: PromptBlock }) {
  return (
    <div className="detail-content">
      <div className="detail-heading prompt-heading">
        <span className="badge">prompt</span>
        <h2>{prompt.title}</h2>
        <p>
          {prompt.source} · line {prompt.line} · {prompt.text.length.toLocaleString()} chars
        </p>
      </div>
      <pre className="text-block prompt-text">{prompt.text}</pre>
    </div>
  )
}

function RawDetail({ event, text }: { event: NormalizedEvent | null; text: string }) {
  const raw = event ? JSON.stringify(event.raw, null, 2) : text.slice(0, 20000)
  return (
    <div className="detail-content">
      <div className="detail-heading raw-heading">
        <span className="badge">raw</span>
        <h2>{event ? `Line ${event.line}` : 'Loaded JSONL'}</h2>
        <p>Unmodified source data</p>
      </div>
      <pre className="text-block raw-text">{raw}</pre>
    </div>
  )
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="empty-state">
      <TerminalSquare size={30} />
      <strong>{loading ? 'Loading session...' : 'Load a JSONL session.'}</strong>
      <span>Use Codex sessions, Owls sessions, model trajectories, or drag a JSONL here.</span>
    </div>
  )
}
