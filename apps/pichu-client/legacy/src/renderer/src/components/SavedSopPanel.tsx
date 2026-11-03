import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  GitBranch,
  Loader2,
  RefreshCw,
  Route,
  XCircle
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SopDetail, SopIndexEntry, SopNode } from '../../../shared/sop'
import type { EmbeddedSopDetail } from '../stores/embedded-browser-store'

type LoadState = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string }

const STATUS_ICON = {
  pending: Clock,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle
} satisfies Record<SopNode['tracking']['status'], typeof Clock>

function sortSops(sops: SopIndexEntry[]): SopIndexEntry[] {
  return [...sops].sort((left, right) => right.updated_at.localeCompare(left.updated_at))
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function nodeStatusClassName(node: SopNode): string {
  if (node.tracking.is_delayed) {
    return 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  if (node.tracking.status === 'completed') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }
  if (node.tracking.status === 'failed' || node.tracking.status === 'cancelled') {
    return 'border-destructive/30 bg-destructive/10 text-destructive'
  }
  if (node.tracking.status === 'running') {
    return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'
  }
  return 'border-border/70 bg-background/80 text-muted-foreground'
}

function nodeKindLabel(t: ReturnType<typeof useI18n>['t']): string {
  return t('rightSidebar.sopNodeAgent')
}

function nodeStatusLabel(node: SopNode, t: ReturnType<typeof useI18n>['t']): string {
  if (node.tracking.is_delayed) return t('rightSidebar.sopNodeDelayed')
  return t(`rightSidebar.sopStatus.${node.tracking.status}` as const)
}

export function SavedSopPanel({
  onOpenSop
}: {
  onOpenSop: (detail: EmbeddedSopDetail) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [loadState, setLoadState] = useState<LoadState>({ state: 'loading' })
  const [sops, setSops] = useState<SopIndexEntry[]>([])

  const loadSops = useCallback(async (): Promise<void> => {
    setLoadState({ state: 'loading' })
    try {
      setSops(sortSops(await window.api.sop.list()))
      setLoadState({ state: 'ready' })
    } catch (error) {
      setLoadState({
        state: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }, [])

  useEffect(() => {
    void loadSops()
  }, [loadSops])

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="flex h-10 shrink-0 items-center justify-end border-b border-border/60 px-3">
        <button
          type="button"
          onClick={() => void loadSops()}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-card-muted hover:text-foreground"
          aria-label={t('rightSidebar.refreshSops')}
        >
          <RefreshCw
            className={cn('size-4', loadState.state === 'loading' && 'animate-spin')}
            strokeWidth={1.8}
          />
        </button>
      </div>

      {loadState.state === 'loading' && sops.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('rightSidebar.loadingSops')}
        </div>
      ) : loadState.state === 'error' ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="max-w-md rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-[12px] text-destructive">
            {loadState.message}
          </div>
        </div>
      ) : sops.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
          <div className="flex max-w-xs flex-col items-center text-center">
            <Route className="mb-4 size-7 text-muted-foreground" strokeWidth={1.7} />
            <p className="text-[14px] font-semibold text-foreground">
              {t('rightSidebar.noSavedSops')}
            </p>
            <p className="mt-2 text-[12px] font-medium leading-5 text-muted-foreground">
              {t('rightSidebar.emptySavedSops')}
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-card px-3 py-3">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {sops.map((sop) => (
              <button
                key={sop.sop_id}
                type="button"
                onClick={() => onOpenSop({ sopId: sop.sop_id, title: sop.name })}
                className="group relative overflow-hidden rounded-2xl border border-border/65 bg-linear-to-br from-card via-card to-card-muted/45 p-3 text-left shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition hover:-translate-y-0.5 hover:border-foreground/15 hover:bg-card-elevated hover:shadow-[0_18px_45px_rgb(0_0_0/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:shadow-black/20 dark:hover:shadow-black/25"
                aria-label={t('rightSidebar.openSopDetail', { name: sop.name })}
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm transition group-hover:scale-105">
                    <Route className="size-5" strokeWidth={1.85} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold text-foreground">
                          {sop.name}
                        </span>
                        <span className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                          {sop.description || t('rightSidebar.sopNoDescription')}
                        </span>
                      </span>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </span>
                    <span className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5">
                        {t('rightSidebar.sopVersion', { version: sop.version })}
                      </span>
                      <span className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5">
                        {t('rightSidebar.sopUpdated', { time: formatDateTime(sop.updated_at) })}
                      </span>
                    </span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

export function SavedSopDetailPanel({
  detail
}: {
  detail: EmbeddedSopDetail | null
}): React.JSX.Element {
  const { t } = useI18n()
  const [loadState, setLoadState] = useState<LoadState>({ state: 'loading' })
  const [sop, setSop] = useState<SopDetail | null>(null)
  const requestSeqRef = useRef(0)

  const loadDetail = useCallback(async (): Promise<void> => {
    if (!detail) return
    const requestSeq = requestSeqRef.current + 1
    requestSeqRef.current = requestSeq
    setLoadState({ state: 'loading' })
    try {
      const nextSop = await window.api.sop.get(detail.sopId)
      if (requestSeq !== requestSeqRef.current) return
      if (!nextSop) {
        throw new Error(t('rightSidebar.sopNotFound'))
      }
      setSop(nextSop)
      setLoadState({ state: 'ready' })
    } catch (error) {
      if (requestSeq !== requestSeqRef.current) return
      setLoadState({
        state: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }, [detail, t])

  useEffect(() => {
    setSop(null)
    if (!detail) return
    void loadDetail()
  }, [detail, loadDetail])

  const edgesByTarget = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const edge of sop?.graph.edges ?? []) {
      map.set(edge.to.node_id, [...(map.get(edge.to.node_id) ?? []), edge.from.node_id])
    }
    return map
  }, [sop])

  const delayedCount = sop?.graph.nodes.filter((node) => node.tracking.is_delayed).length ?? 0

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center bg-card px-6 text-center text-[12px] text-muted-foreground">
        {t('rightSidebar.selectSopPreview')}
      </div>
    )
  }

  if (loadState.state === 'loading' && !sop) {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-card text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {t('rightSidebar.loadingSopDetail')}
      </div>
    )
  }

  if (loadState.state === 'error') {
    return (
      <div className="flex h-full items-center justify-center bg-card px-6">
        <div className="max-w-md rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-[12px] text-destructive">
          {loadState.message}
        </div>
      </div>
    )
  }

  const graph = sop?.graph

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="shrink-0 border-b border-border/60 bg-linear-to-br from-card via-card to-card-muted/60 px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <Route className="size-3.5" strokeWidth={1.8} />
              {t('rightSidebar.sopDetail')}
            </p>
            <h2 className="mt-2 text-[22px] font-semibold leading-7 text-foreground">
              {graph?.name ?? detail.title}
            </h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-5 text-muted-foreground">
              {graph?.description || t('rightSidebar.sopNoDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDetail()}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground transition hover:bg-card-muted hover:text-foreground"
            aria-label={t('rightSidebar.refreshSopDetail')}
          >
            <RefreshCw className={cn('size-4', loadState.state === 'loading' && 'animate-spin')} />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5">
            {t('rightSidebar.sopNodeCount', { count: graph?.nodes.length ?? 0 })}
          </span>
          {delayedCount > 0 ? (
            <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
              {t('rightSidebar.sopDelayedCount', { count: delayedCount })}
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <div className="relative mx-auto w-full max-w-xl">
            {graph?.nodes.map((node, index) => (
              <SopGraphRow
                key={node.id}
                node={node}
                isFirst={index === 0}
                isLast={index === graph.nodes.length - 1}
                upstreamNodeIds={edgesByTarget.get(node.id) ?? []}
              />
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}

function SopGraphRow({
  node,
  isFirst,
  isLast,
  upstreamNodeIds
}: {
  node: SopNode
  isFirst: boolean
  isLast: boolean
  upstreamNodeIds: string[]
}): React.JSX.Element {
  return (
    <div className="relative flex justify-center pb-12 last:pb-0">
      <svg
        className="pointer-events-none absolute inset-y-0 left-1/2 h-full w-16 -translate-x-1/2 overflow-visible text-border-strong"
        aria-hidden="true"
      >
        {!isFirst ? (
          <line
            x1="32"
            y1="0"
            x2="32"
            y2="18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : null}
        {!isLast ? (
          <line
            x1="32"
            y1="82"
            x2="32"
            y2="100%"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : null}
      </svg>
      <SopWorkflowNode node={node} upstreamNodeIds={upstreamNodeIds} />
    </div>
  )
}

function SopWorkflowNode({
  node,
  upstreamNodeIds
}: {
  node: SopNode
  upstreamNodeIds: string[]
}): React.JSX.Element {
  const { t } = useI18n()
  const StatusIcon = STATUS_ICON[node.tracking.status]

  return (
    <article className="relative z-10 w-full max-w-[360px] rounded-2xl border border-border/80 bg-card px-3 py-2.5 shadow-[0_10px_28px_rgb(0_0_0/0.08)] ring-1 ring-border-light dark:shadow-black/25">
      <span className="-top-1.5 -translate-x-1/2 absolute left-1/2 size-3 rounded-full border-2 border-card bg-muted-foreground/35 shadow-sm" />
      <span className="-bottom-1.5 -translate-x-1/2 absolute left-1/2 size-3 rounded-full border-2 border-card bg-muted-foreground/35 shadow-sm" />

      <div className="flex min-w-0 items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background shadow-sm">
          <Bot className="size-[18px]" strokeWidth={1.8} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {nodeKindLabel(t)}
              </p>
              <h3 className="mt-0.5 truncate text-[13px] font-semibold text-foreground">
                {node.title}
              </h3>
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                nodeStatusClassName(node)
              )}
            >
              <StatusIcon
                className={cn('size-2.5', node.tracking.status === 'running' && 'animate-spin')}
                strokeWidth={1.8}
              />
              {nodeStatusLabel(node, t)}
            </span>
          </div>

          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {node.description || t('rightSidebar.sopNodeNoDescription')}
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-background/80 px-1.5 py-0.5">
              <CalendarClock className="size-2.5" strokeWidth={1.8} />
              {t('rightSidebar.sopDdl', { time: formatDateTime(node.ddl) })}
            </span>
            <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-background/80 px-1.5 py-0.5">
              <Bot className="size-2.5" strokeWidth={1.8} />
              <span className="max-w-32 truncate">{node.agent_id}</span>
            </span>
            {upstreamNodeIds.length > 0 ? (
              <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-background/80 px-1.5 py-0.5">
                <GitBranch className="size-2.5" strokeWidth={1.8} />
                <span className="max-w-32 truncate">
                  {t('rightSidebar.sopDependsOn', { ids: upstreamNodeIds.join(', ') })}
                </span>
              </span>
            ) : null}
          </div>

          {node.tracking.is_delayed ? (
            <div className="mt-2 flex gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/8 px-2 py-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" strokeWidth={1.8} />
              <span>{node.tracking.delay_reason || t('rightSidebar.sopDelayReasonUnknown')}</span>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
