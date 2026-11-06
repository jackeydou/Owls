import { Button } from '@renderer/components/ui/button'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildWorkerMap, isInPlay, type MapNode, type MapSide } from '../../../../shared/worker-map'
import { useCodexStore } from '../../codex/store'
import { isWaitingOnUser, isWorking, openRequests, projectHue } from '../activity'
import { RouterComposer } from '../RouterComposer'
import { useRouterStore } from '../store'
import { MapEdges } from './MapEdges'
import { MapNodeView } from './MapNode'
import { useWorkerProjects } from './projects'
import { useCamera } from './useCamera'
import { useMapMotion } from './useMapMotion'
import './map.css'

/** The detail panel's width, which the camera keeps nodes clear of. */
const PANEL_WIDTH = 480
const MINUTE = 60_000
/** Outlives the view so reopening the map never swaps a project's side. */
const rememberedSides = new Map<string, MapSide>()

const boxOf = (n: MapNode) => ({ x0: n.x, y0: n.y, x1: n.x + n.width, y1: n.y + n.height })
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE)
    return () => clearInterval(timer)
  }, [])
  return now
}
/** Moves focus to the nearest node in a direction, weighing straight lines over diagonals. */
function nearestNode(from: MapNode, nodes: MapNode[], dx: number, dy: number): MapNode | null {
  const cx = (n: MapNode) => n.x + n.width / 2
  const cy = (n: MapNode) => n.y + n.height / 2
  let best: MapNode | null = null
  let score = Number.POSITIVE_INFINITY
  for (const node of nodes) {
    const ax = cx(node) - cx(from)
    const ay = cy(node) - cy(from)
    const along = ax * dx + ay * dy
    if (node === from || along <= 0) continue
    const value = along + (Math.abs(ax * dy) + Math.abs(ay * dx)) * 2.5
    if (value < score) [best, score] = [node, value]
  }
  return best
}
export function MapView() {
  const { t } = useTranslation()
  const stage = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const zoomLabel = useRef<HTMLSpanElement>(null)
  const camera = useCamera(stage, world, zoomLabel)
  const projects = useWorkerProjects()
  const now = useMinuteClock()
  const projectId = useCodexStore((s) => s.routerProjectId)
  const showChat = useCodexStore((s) => s.showChat)
  const focusProject = useCodexStore((s) => s.focusProject)
  const panel = useRouterStore((s) => s.panel)
  const filter = useRouterStore((s) => s.mapFilter)
  const openDone = useRouterStore((s) => s.openDone)
  const collapsed = useRouterStore((s) => s.collapsed)
  const { showPanel, setMapFilter, toggleDone } = useRouterStore()
  const selectedWorker = panel?.kind === 'worker' ? panel.workerId : null
  const [hover, setHover] = useState<string | null>(null)
  // A joined string, so streaming never rebuilds the map; only a new or settled request does.
  const approvalSessions = useCodexStore((s) =>
    s.sessions
      .filter((x) => openRequests(x).some((r) => r.kind !== 'question'))
      .map((x) => x.id)
      .join(' ')
  )
  const map = useMemo(() => {
    const sessions = new Set(approvalSessions.split(' '))
    return buildWorkerMap({
      projects,
      approvals: new Set(
        projects.flatMap((p) => p.workers).flatMap((w) => (sessions.has(w.sessionId) ? [w.id] : []))
      ),
      filter,
      openDone,
      collapsed,
      sides: rememberedSides
    })
  }, [projects, approvalSessions, filter, openDone, collapsed])
  useEffect(() => {
    for (const [id, side] of map.sides) rememberedSides.set(id, side)
    camera.update({
      x0: Math.min(...map.nodes.map((n) => n.x)),
      y0: Math.min(...map.nodes.map((n) => n.y)),
      x1: Math.max(...map.nodes.map((n) => n.x + n.width)),
      y1: Math.max(...map.nodes.map((n) => n.y + n.height))
    })
  }, [map, camera])
  useMapMotion(map, projects, world)
  const byId = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map])
  const parents = useMemo(() => new Map(map.edges.map((e) => [e.to, e.from])), [map])
  const focused = hover ?? selectedWorker
  const lit = useMemo(() => {
    if (!focused || !byId.has(focused)) return null
    const on = new Set<string>()
    for (let id: string | undefined = focused; id; id = parents.get(id)) on.add(id)
    const down = (id: string) => {
      on.add(id)
      for (const edge of map.edges) if (edge.from === id) down(edge.to)
    }
    down(focused)
    return on
  }, [focused, byId, parents, map])
  const hueOf = useCallback(
    (node: MapNode) =>
      node.kind === 'root' ? 'var(--color-muted-foreground)' : projectHue(node.projectId),
    []
  )
  const select = useCallback(
    (node: MapNode) => {
      if (node.kind === 'root') {
        showPanel(null)
        camera.reset()
      } else if (node.kind === 'done') toggleDone(node.projectId)
      else if (node.kind === 'project') {
        focusProject(node.projectId)
        showPanel(null)
      } else if (node.kind === 'kept') {
        focusProject(node.projectId)
        showPanel({ kind: 'router' })
      } else {
        focusProject(node.projectId)
        showPanel({ kind: 'worker', workerId: node.id })
        camera.reveal(boxOf(node), PANEL_WIDTH)
      }
    },
    [camera, focusProject, showPanel, toggleDone]
  )
  const nextWaiting = useCallback(() => {
    const waiting = map.nodes.filter((n) => n.kind === 'worker' && isWaitingOnUser(n.worker))
    if (!waiting.length) return
    const index = waiting.findIndex((n) => n.id === selectedWorker)
    const next = waiting[(index + 1) % waiting.length]
    select(next)
    camera.focus(boxOf(next), PANEL_WIDTH)
  }, [camera, map, select, selectedWorker])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as Element
      if (target.closest?.('textarea, input, .router-panel') || event.metaKey || event.ctrlKey)
        return
      const active = (document.activeElement as HTMLElement | null)?.dataset?.node
      const step = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      }[event.key]
      if (step) {
        event.preventDefault()
        const from = byId.get(active ?? 'root')
        const best = from && nearestNode(from, map.nodes, step[0], step[1])
        if (!best) return
        stage.current
          ?.querySelector<HTMLElement>(`[data-node="${CSS.escape(best.id)}"]`)
          ?.focus({ preventScroll: true })
        setHover(best.id)
        camera.reveal(boxOf(best), 0)
      } else if (event.key === 'Enter') {
        const node = active ? byId.get(active) : undefined
        if (node?.kind === 'project') showChat(node.projectId)
        else if (node) select(node)
      } else if (event.key.toLowerCase() === 'f') camera.reset()
      else if (event.key.toLowerCase() === 'n') nextWaiting()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [byId, camera, map, nextWaiting, select, showChat])
  const nodeAt = (target: EventTarget) => {
    const id = (target as Element).closest<HTMLElement>('[data-node]')?.dataset.node
    return id ? byId.get(id) : undefined
  }
  const workers = projects.flatMap((p) => p.workers).filter((w) => w.status !== 'removed')
  const waiting = workers.filter(isWaitingOnUser).length
  const working = workers.filter(isWorking).length
  const moving = projects.filter((p) => p.workers.some(isInPlay)).length
  const inPlay = workers.filter(isInPlay).length
  const focusProjectData = projects.find((p) => p.id === projectId)
  const target = workers.find((w) => w.id === selectedWorker) ?? null
  const targetProject = target ? projects.find((p) => p.workers.includes(target)) : focusProjectData
  return (
    <main className="map-view">
      <div className="map-stage" ref={stage}>
        <div className="map-world" ref={world}>
          <MapEdges map={map} projects={projects} lit={lit} hueOf={hueOf} />
          <div className="map-signals" aria-hidden="true" />
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: the window listener above handles keys. */}
          <div
            className="map-nodes"
            role="tree"
            aria-label={t('map.title')}
            onClick={(event) => {
              if ((event.target as Element).closest('button')) return
              const node = nodeAt(event.target)
              if (node) select(node)
            }}
            onDoubleClick={(event) => {
              const node = nodeAt(event.target)
              if (node?.kind === 'project') showChat(node.projectId)
            }}
            onPointerOver={(event) => setHover(nodeAt(event.target)?.id ?? null)}
            onPointerLeave={() => setHover(null)}
          >
            {map.nodes.map((node) => (
              <MapNodeView
                key={node.id}
                node={node}
                project={
                  node.kind === 'project'
                    ? projects.find((p) => p.id === node.projectId)
                    : undefined
                }
                hue={hueOf(node)}
                selected={
                  node.kind === 'worker'
                    ? node.id === selectedWorker
                    : node.kind === 'project' && node.projectId === projectId && !selectedWorker
                }
                dim={Boolean(lit && !lit.has(node.id))}
                inPlay={inPlay}
                now={now}
              />
            ))}
          </div>
        </div>
      </div>
      <header className="map-hud">
        <div className="map-hud-title">
          <strong>{t('map.title')}</strong>
          <span>
            {t('map.summaryProjects', { count: moving })} ·{' '}
            {t('map.summaryWorkers', { count: working })}
          </span>
        </div>
        {waiting ? (
          <Button size="sm" variant="outline" className="map-waiting" onClick={nextWaiting}>
            {t('map.waiting', { count: waiting })}
            <kbd>N</kbd>
          </Button>
        ) : null}
        <span className="map-hud-space" />
        <fieldset className="map-filter" aria-label={t('map.filter')}>
          {(['active', 'all'] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => {
                setMapFilter(value)
                camera.reset()
              }}
            >
              {t(`map.filter.${value}`)}
            </button>
          ))}
        </fieldset>
        <Button size="sm" variant="outline" onClick={() => showChat()}>
          {t('map.back')}
          <kbd>⌘ J</kbd>
        </Button>
      </header>
      <div className="map-zoom">
        <button type="button" aria-label={t('map.zoomOut')} onClick={() => camera.zoomBy(0.8)}>
          −
        </button>
        <span ref={zoomLabel}>100%</span>
        <button type="button" aria-label={t('map.zoomIn')} onClick={() => camera.zoomBy(1.25)}>
          +
        </button>
        <button type="button" className="fit" onClick={() => camera.reset()}>
          {t('map.fit')}
        </button>
      </div>
      <div className="map-bar">
        <RouterComposer
          key={`${targetProject?.id ?? 'none'}:${target?.id ?? 'router'}`}
          projectId={targetProject?.id ?? null}
          router={targetProject?.router}
          target={target}
          onClearTarget={() => showPanel(null)}
        />
      </div>
      {workers.length ? null : <p className="map-empty">{t('map.empty')}</p>}
    </main>
  )
}
