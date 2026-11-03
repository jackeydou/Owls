import type { ToolGroupItem } from '@renderer/components/chat/chat-render-items'
import {
  MARKDOWN_LINK_TOOLTIP_CLASS_NAME,
  MARKDOWN_LINK_TOOLTIP_MAX_WIDTH,
  MarkdownLocalFileLink
} from '@renderer/components/chat/MarkdownRenderer'
import {
  type ActivityDiffStats as ActivityDiffStatsValue,
  type ActivityFileDetail,
  activityLine,
  commandStatusLabel,
  commandTextFromToolName,
  getActivityDiffStats,
  getActivityFileDetail,
  getCommandOutput,
  getCommandText,
  getTerminalStdinInputPreview,
  getTerminalTransportDetail,
  iconForTool,
  isCommandWidget,
  isImageGenerationWidget,
  isInlineToolWidget,
  isTerminalTransportWidget,
  summarizeToolActivities,
  toolActionVerb
} from '@renderer/components/chat/tool-activity-utils'
import type { ToolWidgetState } from '@renderer/components/tool-widgets/types'
import { RawJsonViewer } from '@renderer/components/ui/raw-json-viewer'
import {
  AnchoredTooltip,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { WidgetRenderer } from '@renderer/components/WidgetRenderer'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { useArtifactsStore } from '@renderer/stores/artifacts-store'
import type { ChatMessage } from '@renderer/stores/session-store'
import { AlertCircle, Bookmark, BookmarkCheck, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Fragment, useCallback, useEffect, useState } from 'react'

function SaveArtifactButton({
  sessionId,
  messageId,
  widget
}: {
  sessionId: string | null
  messageId: string
  widget: ToolWidgetState
}): React.JSX.Element | null {
  const { t } = useI18n()
  const artifacts = useArtifactsStore((state) => state.artifacts)
  const artifactsLoaded = useArtifactsStore((state) => state.loaded)
  const loadArtifacts = useArtifactsStore((state) => state.load)
  const deleteArtifact = useArtifactsStore((state) => state.deleteArtifact)
  const saveStreamingUiWidget = useArtifactsStore((state) => state.saveStreamingUiWidget)
  const [saving, setSaving] = useState(false)
  const isCompleteStreamingUi =
    widget.toolName === 'streamingUITool' &&
    widget.status === 'complete' &&
    typeof widget.args.html === 'string' &&
    widget.args.html.trim().length > 0
  const savedArtifact = artifacts.find(
    (artifact) =>
      artifact.sourceSessionId === sessionId && artifact.sourceToolCallId === widget.toolCallId
  )

  useEffect(() => {
    if (!sessionId || !isCompleteStreamingUi || artifactsLoaded) return
    void loadArtifacts()
  }, [artifactsLoaded, isCompleteStreamingUi, loadArtifacts, sessionId])

  if (!sessionId || !isCompleteStreamingUi) return null

  return (
    <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <Tooltip>
        <TooltipTrigger
          disabled={saving}
          aria-label={t(
            savedArtifact ? 'artifacts.removeFromArtifacts' : 'artifacts.saveToArtifacts'
          )}
          onClick={async (event) => {
            event.stopPropagation()
            setSaving(true)
            try {
              if (savedArtifact) {
                await deleteArtifact(savedArtifact.id)
              } else {
                await saveStreamingUiWidget({ sessionId, messageId, widget })
              }
            } catch (e) {
              console.error('Failed to save artifact', e)
            } finally {
              setSaving(false)
            }
          }}
          className="flex size-8 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition hover:bg-card hover:text-foreground disabled:opacity-60"
        >
          {savedArtifact ? (
            <BookmarkCheck className="size-3.5 text-accent" strokeWidth={1.9} />
          ) : (
            <Bookmark className="size-3.5" strokeWidth={1.9} />
          )}
        </TooltipTrigger>
        <TooltipContent side="left">
          {t(savedArtifact ? 'artifacts.removeFromArtifacts' : 'artifacts.saveToArtifacts')}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function ActivityFileLink({ file }: { file: ActivityFileDetail }): React.JSX.Element {
  const [tooltipAnchor, setTooltipAnchor] = useState<HTMLAnchorElement | null>(null)

  const showTooltip = useCallback((anchor: HTMLAnchorElement) => {
    const rect = anchor.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    setTooltipAnchor(anchor)
  }, [])

  const closeTooltip = useCallback(() => setTooltipAnchor(null), [])

  useEffect(() => {
    if (!tooltipAnchor) return

    window.addEventListener('scroll', closeTooltip, true)
    window.addEventListener('resize', closeTooltip)
    return () => {
      window.removeEventListener('scroll', closeTooltip, true)
      window.removeEventListener('resize', closeTooltip)
    }
  }, [closeTooltip, tooltipAnchor])

  return (
    <span className="markdown-body inline-flex min-w-0 align-baseline">
      <MarkdownLocalFileLink
        href={file.path}
        localPath={file.path}
        action="open"
        className="truncate"
        onMouseEnter={(event) => showTooltip(event.currentTarget)}
        onMouseLeave={(event) => {
          const relatedTarget = event.relatedTarget as Node | null
          if (relatedTarget && event.currentTarget.contains(relatedTarget)) return
          closeTooltip()
        }}
        onFocus={(event) => showTooltip(event.currentTarget)}
        onBlur={closeTooltip}
      >
        {file.name}
      </MarkdownLocalFileLink>
      {tooltipAnchor ? (
        <AnchoredTooltip
          open
          reference={tooltipAnchor}
          placement="top-start"
          maxWidth={MARKDOWN_LINK_TOOLTIP_MAX_WIDTH}
          className={MARKDOWN_LINK_TOOLTIP_CLASS_NAME}
        >
          {file.path}
        </AnchoredTooltip>
      ) : null}
    </span>
  )
}

function ActivityDiffStats({
  stats
}: {
  stats: ActivityDiffStatsValue | null
}): React.JSX.Element | null {
  if (!stats || (stats.additions <= 0 && stats.deletions <= 0)) return null

  return (
    <span className="inline-flex shrink-0 items-baseline gap-1">
      {stats.additions > 0 ? <span className="text-success">+{stats.additions}</span> : null}
      {stats.deletions > 0 ? <span className="text-destructive">-{stats.deletions}</span> : null}
    </span>
  )
}

function ActivityToolLine({ widget }: { widget: ToolWidgetState }): React.JSX.Element {
  const isRunning = widget.status === 'streaming' || widget.status === 'running'
  const verb = toolActionVerb(widget)
  const label = isRunning ? verb.present : verb.past
  const file = getActivityFileDetail(widget)

  if (file) {
    return (
      <span
        className={cn(
          'inline-flex max-w-full min-w-0 items-baseline gap-1.5 text-muted-foreground/90',
          isRunning && 'pichu-activity-shimmer'
        )}
      >
        <span className="shrink-0">{label}</span>
        <ActivityFileLink file={file} />
        <ActivityDiffStats stats={getActivityDiffStats(widget)} />
      </span>
    )
  }

  return (
    <span
      className={cn(
        'min-w-0 truncate text-muted-foreground/90',
        isRunning && 'pichu-activity-shimmer'
      )}
    >
      {activityLine(widget, isRunning ? 'present' : 'past')}
    </span>
  )
}

function CommandActivityItem({
  message,
  widget,
  debugMode,
  showHeader = true
}: {
  message: ChatMessage
  widget: ToolWidgetState
  debugMode: boolean
  showHeader?: boolean
}): React.JSX.Element {
  const reduceMotion = useReducedMotion()
  const command = getCommandText(widget) ?? commandTextFromToolName(widget.toolName)
  const output = getCommandOutput(widget)
  const statusLabel = commandStatusLabel(widget)
  const isRunning = widget.status === 'streaming' || widget.status === 'running'
  const isError = widget.status === 'error' || widget.isError
  const statusSymbol = isError ? '×' : isRunning ? null : '✓'
  const [expanded, setExpanded] = useState(false)

  const shellDetails = (
    <div className="rounded-lg bg-card-muted px-2.5 py-1.5 text-[13px] text-foreground/80 ring-1 ring-border-light">
      <div className="mb-2 text-muted-foreground">Shell</div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.45] text-foreground">
        <code>{`$ ${command}${output ? `\n\n${output}` : ''}`}</code>
      </pre>
      <div
        className={cn(
          'mt-2 flex items-center justify-end gap-1.5 text-[13px] text-muted-foreground',
          isRunning && 'pichu-activity-shimmer'
        )}
      >
        {statusSymbol ? <span aria-hidden="true">{statusSymbol}</span> : null}
        {statusLabel}
      </div>
    </div>
  )

  if (!showHeader) {
    return (
      <div
        data-message-id={message.id}
        data-tool-call-id={message.toolCallId ?? undefined}
        className="py-0.5"
      >
        {shellDetails}
        {debugMode && <RawJsonViewer data={{ message, widgetState: widget }} />}
      </div>
    )
  }

  return (
    <div
      data-message-id={message.id}
      data-tool-call-id={message.toolCallId ?? undefined}
      className="py-0.5"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 text-left transition-colors hover:text-foreground"
        aria-expanded={expanded}
      >
        {isError ? <AlertCircle className="size-3.5 shrink-0" strokeWidth={1.8} /> : null}
        <span
          className={cn(
            'min-w-0 truncate text-muted-foreground/90 transition-colors group-hover:text-foreground group-focus-visible:text-foreground',
            isRunning && 'pichu-activity-shimmer'
          )}
        >
          {activityLine(widget, isRunning ? 'present' : 'past')}
        </span>
        <ChevronRight
          className={cn(
            'size-4 shrink-0 text-muted-foreground/60 transition',
            expanded && 'rotate-90'
          )}
          strokeWidth={1.8}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-1">{shellDetails}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {debugMode && <RawJsonViewer data={{ message, widgetState: widget }} />}
    </div>
  )
}

function terminalTransportStatusLabel(widget: ToolWidgetState): string {
  const details = getTerminalTransportDetail(widget)
  if (widget.status === 'running' || widget.status === 'streaming') return 'Running'
  if (widget.status === 'error' || widget.isError) return 'Failed'
  if (details?.terminalStatus === 'terminated') {
    return details.signalCode ? `Terminated ${details.signalCode}` : 'Terminated'
  }
  if (typeof details?.exitCode === 'number') return `Exited ${details.exitCode}`
  if (details?.signalCode) return `Ended ${details.signalCode}`
  if (details?.sessionId) return 'Still running'
  return 'Read'
}

function TerminalOutputBlock({
  label,
  value,
  empty
}: {
  label: string
  value: string | null
  empty: string
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 text-muted-foreground">{label}</div>
      {value ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.45] text-foreground">
          <code>{value}</code>
        </pre>
      ) : (
        <div className="text-muted-foreground/75">{empty}</div>
      )}
    </div>
  )
}

function TerminalTransportActivityItem({
  message,
  widget,
  debugMode
}: {
  message: ChatMessage
  widget: ToolWidgetState
  debugMode: boolean
}): React.JSX.Element {
  const reduceMotion = useReducedMotion()
  const [expanded, setExpanded] = useState(false)
  const details = getTerminalTransportDetail(widget)
  const statusLabel = terminalTransportStatusLabel(widget)
  const isRunning = widget.status === 'streaming' || widget.status === 'running'
  const isError = widget.status === 'error' || widget.isError
  const commandStillRunning = !isError && statusLabel === 'Still running'
  const statusSymbol = isError ? '×' : isRunning || commandStillRunning ? null : '✓'
  const stdinInput = getTerminalStdinInputPreview(widget)

  const detailRows: Array<[string, string]> = []
  detailRows.push(['Status', statusLabel])
  if (stdinInput) detailRows.push(['Input', stdinInput])
  if (details?.sessionId) detailRows.push(['Session', details.sessionId])
  if (typeof details?.exitCode === 'number')
    detailRows.push(['Exit code', String(details.exitCode)])
  if (details?.signalCode) detailRows.push(['Signal', details.signalCode])
  if (details?.terminalStatus && details.terminalStatus !== 'running') {
    detailRows.push(['Process', details.terminalStatus])
  }
  if (typeof details?.wallTimeMs === 'number') {
    detailRows.push(['Waited', `${(details.wallTimeMs / 1000).toFixed(2)}s`])
  }
  if (typeof details?.originalTokenCount === 'number') {
    detailRows.push(['Tokens', String(details.originalTokenCount)])
  }

  const hasSplitOutput = Boolean(details?.stdout || details?.stderr)

  return (
    <div
      data-message-id={message.id}
      data-tool-call-id={message.toolCallId ?? undefined}
      className="py-0.5"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 text-left transition-colors hover:text-foreground"
        aria-expanded={expanded}
      >
        {isError ? <AlertCircle className="size-3.5 shrink-0" strokeWidth={1.8} /> : null}
        <span
          className={cn(
            'min-w-0 truncate text-muted-foreground/90 transition-colors group-hover:text-foreground group-focus-visible:text-foreground',
            isRunning && 'pichu-activity-shimmer'
          )}
        >
          {activityLine(widget, isRunning ? 'present' : 'past')}
        </span>
        <ChevronRight
          className={cn(
            'size-4 shrink-0 text-muted-foreground/60 transition',
            expanded && 'rotate-90'
          )}
          strokeWidth={1.8}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-1 rounded-lg bg-card-muted px-2.5 py-1.5 text-[13px] text-foreground/80 ring-1 ring-border-light">
              <div className="mb-2 flex min-w-0 items-center justify-between gap-3 text-muted-foreground">
                <span>Command output</span>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5',
                    isRunning && 'pichu-activity-shimmer'
                  )}
                >
                  {statusSymbol ? <span aria-hidden="true">{statusSymbol}</span> : null}
                  {statusLabel}
                </span>
              </div>
              {detailRows.length > 0 ? (
                <dl className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted-foreground">
                  {detailRows.map(([label, value]) => (
                    <Fragment key={label}>
                      <dt>{label}</dt>
                      <dd className="truncate text-foreground/80">{value}</dd>
                    </Fragment>
                  ))}
                </dl>
              ) : null}
              {hasSplitOutput ? (
                <div className="space-y-2">
                  <TerminalOutputBlock
                    label="Stdout"
                    value={details?.stdout ?? null}
                    empty="No stdout."
                  />
                  <TerminalOutputBlock
                    label="Stderr"
                    value={details?.stderr ?? null}
                    empty="No stderr."
                  />
                </div>
              ) : (
                <TerminalOutputBlock
                  label="Output"
                  value={details?.output ?? null}
                  empty="No new output."
                />
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {debugMode && <RawJsonViewer data={{ message, widgetState: widget }} />}
    </div>
  )
}

export function ToolActivityGroup({
  sessionId,
  items,
  debugMode,
  busy
}: {
  sessionId: string | null
  items: ToolGroupItem[]
  debugMode: boolean
  busy: boolean
}): React.JSX.Element {
  const reduceMotion = useReducedMotion()
  const streamingUiItems = items.filter((item) => item.widget.toolName === 'streamingUITool')
  const inlineItems = items.filter((item) => isInlineToolWidget(item.widget))
  const activityItems = items.filter(
    (item) => item.widget.toolName !== 'streamingUITool' && !isInlineToolWidget(item.widget)
  )
  const activityWidgets = activityItems.map((item) => item.widget)
  const firstActivityItem = activityItems[0]
  const singleCommandOnly =
    activityItems.length === 1 && firstActivityItem
      ? isCommandWidget(firstActivityItem.widget)
      : false
  const hasRunningTool = activityWidgets.some(
    (widget) => widget.status === 'streaming' || widget.status === 'running'
  )
  const [expanded, setExpanded] = useState(false)
  const SummaryIcon = iconForTool(activityWidgets[activityWidgets.length - 1]?.toolName ?? 'tool')
  const summary = summarizeToolActivities(activityWidgets, busy)
  const hasActivityItems = activityItems.length > 0

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto w-full max-w-[var(--pichu-chat-content-max-width)] py-1"
    >
      {hasActivityItems ? (
        <div className="max-w-full px-1">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="group grid max-w-full grid-cols-[0.75rem_minmax(0,1fr)_1rem] items-center gap-2 rounded-md py-0.5 text-left text-[14px] leading-[1.15] text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={expanded}
          >
            <SummaryIcon className="size-3 shrink-0 text-muted-foreground/75" strokeWidth={1.8} />
            <span
              className={cn(
                'min-w-0 truncate text-muted-foreground/90 transition-colors group-hover:text-foreground group-focus-visible:text-foreground',
                hasRunningTool && 'pichu-activity-shimmer'
              )}
            >
              {summary}
            </span>
            <ChevronRight
              className={cn(
                'size-4 shrink-0 text-muted-foreground/60 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100',
                expanded && 'rotate-90 opacity-100'
              )}
              strokeWidth={1.8}
            />
          </button>
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {hasActivityItems && expanded ? (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 max-w-full px-1 pl-6 text-[14px] leading-[1.45] text-muted-foreground/80">
              {activityItems.map(({ message, widget }) => {
                if (isCommandWidget(widget)) {
                  return (
                    <CommandActivityItem
                      key={message.id}
                      message={message}
                      widget={widget}
                      debugMode={debugMode}
                      showHeader={!singleCommandOnly}
                    />
                  )
                }
                if (isTerminalTransportWidget(widget)) {
                  return (
                    <TerminalTransportActivityItem
                      key={message.id}
                      message={message}
                      widget={widget}
                      debugMode={debugMode}
                    />
                  )
                }
                if (isImageGenerationWidget(widget)) {
                  return (
                    <div
                      key={message.id}
                      data-message-id={message.id}
                      data-tool-call-id={message.toolCallId ?? undefined}
                      className="py-0.5"
                    >
                      <WidgetRenderer widget={widget} />
                      {debugMode && <RawJsonViewer data={{ message, widgetState: widget }} />}
                    </div>
                  )
                }
                return (
                  <div
                    key={message.id}
                    data-message-id={message.id}
                    data-tool-call-id={message.toolCallId ?? undefined}
                    className="py-0.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {widget.status === 'error' ? (
                        <AlertCircle
                          className="size-3.5 shrink-0 text-destructive"
                          strokeWidth={1.8}
                        />
                      ) : null}
                      <ActivityToolLine widget={widget} />
                    </div>
                    {debugMode && <RawJsonViewer data={{ message, widgetState: widget }} />}
                  </div>
                )
              })}
            </div>
          </motion.div>
        ) : debugMode && hasActivityItems ? (
          <div className="px-1">
            <RawJsonViewer
              data={activityItems.map(({ message, widget }) => ({ message, widgetState: widget }))}
            />
          </div>
        ) : null}
      </AnimatePresence>

      {streamingUiItems.length > 0 ? (
        <div className={cn('space-y-3', hasActivityItems && 'mt-3')}>
          {streamingUiItems.map(({ message, widget }) => (
            <div
              key={message.id}
              data-message-id={message.id}
              data-tool-call-id={widget.toolCallId}
              className="group relative"
            >
              <SaveArtifactButton sessionId={sessionId} messageId={message.id} widget={widget} />
              <WidgetRenderer widget={widget} />
            </div>
          ))}
        </div>
      ) : null}

      {inlineItems.length > 0 ? (
        <div
          className={cn('space-y-3', (hasActivityItems || streamingUiItems.length > 0) && 'mt-3')}
        >
          {inlineItems.map(({ message, widget }) => (
            <div
              key={message.id}
              data-message-id={message.id}
              data-tool-call-id={widget.toolCallId}
              className="group relative"
            >
              <WidgetRenderer widget={widget} />
              {debugMode && <RawJsonViewer data={{ message, widgetState: widget }} />}
            </div>
          ))}
        </div>
      ) : null}
    </motion.div>
  )
}
