import { pluginIconUrl } from '@renderer/lib/plugin-assets'
import { usePluginStore } from '@renderer/stores/plugin-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { ChevronDown, FileText, ImageIcon, Maximize2, Monitor, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ToolWidgetComponentProps } from './types'

type ImageBlock = { type: 'image'; data?: string; path?: string; mimeType: string }
type TextBlock = { type: 'text'; text: string }
type ContentBlock = ImageBlock | TextBlock | { type: string; [key: string]: unknown }

type Bounds = { x: number; y: number; width: number; height: number }

type Geometry = {
  region?: 'window-frame' | 'display-full'
  coordinateSpace?: string
  unit?: string
  originY?: string
  displayId?: number
  displayBounds?: Bounds
  displayScaleFactor?: number
  windowBounds?: Bounds
  nativePixelSize?: { width: number; height: number }
  thumbnailScale?: number
}

type AxNode = {
  id?: number
  focused?: boolean
  frame?: { x: number; y: number; width: number; height: number }
}

type AxTree = {
  snapshotId?: string
  nodeCount?: number
  focusedElementId?: number | null
  focusedRef?: string | null
  truncated?: boolean
  text?: string
  nodes?: AxNode[]
}

type ScreenshotDetails = {
  path?: string
  width?: number
  height?: number
  source?: { id?: string; name?: string; cgWindowId?: number }
  geometry?: Geometry
}

type ScreenshotEnvelopeDetails = {
  screenshot?: ScreenshotDetails
  axTree?: AxTree | null
}

type CaptureDetails = ScreenshotDetails & {
  axTree?: AxTree | null
}

type ScreenshotResult = {
  content?: ContentBlock[]
  details?: ScreenshotEnvelopeDetails | CaptureDetails
}

function isScreenshotEnvelopeDetails(
  details: ScreenshotEnvelopeDetails | CaptureDetails | undefined
): details is ScreenshotEnvelopeDetails {
  return Boolean(details && 'screenshot' in details)
}

function isImageBlock(block: ContentBlock | undefined): block is ImageBlock {
  return (
    !!block &&
    block.type === 'image' &&
    (typeof (block as ImageBlock).data === 'string' ||
      typeof (block as ImageBlock).path === 'string') &&
    typeof (block as ImageBlock).mimeType === 'string'
  )
}

function extractImage(result: unknown): ImageBlock | null {
  if (!result || typeof result !== 'object') return null
  const r = result as ScreenshotResult
  const found = r.content?.find(isImageBlock)
  if (found) return found
  const details = r.details
  const screenshot: ScreenshotDetails | undefined = isScreenshotEnvelopeDetails(details)
    ? details.screenshot
    : details
  return typeof screenshot?.path === 'string'
    ? { type: 'image', path: screenshot.path, mimeType: 'image/png' }
    : null
}

function extractMeta(result: unknown): {
  width?: number
  height?: number
  sourceName?: string
  sourceId?: string
  geometry?: Geometry
  axTree?: AxTree | null
} {
  if (!result || typeof result !== 'object') return {}
  const r = result as ScreenshotResult
  const details = r.details
  const screenshot: ScreenshotDetails | undefined = isScreenshotEnvelopeDetails(details)
    ? details.screenshot
    : details
  return {
    width: screenshot?.width,
    height: screenshot?.height,
    sourceName: screenshot?.source?.name,
    sourceId: screenshot?.source?.id,
    geometry: screenshot?.geometry,
    axTree: details?.axTree ?? null
  }
}

function fmtBounds(b: Bounds | undefined): string | null {
  if (!b) return null
  const round = (n: number) => Math.round(n * 10) / 10
  return `(${round(b.x)}, ${round(b.y)})  ${round(b.width)} × ${round(b.height)}`
}

function imageUrl(image: ImageBlock): string {
  if (image.data) return `data:${image.mimeType};base64,${image.data}`
  if (image.path) return `pichu-screenshot://local/${encodeURIComponent(image.path)}`
  return ''
}

function inferQueryLabel(args: Record<string, unknown>): string | null {
  const query = typeof args.query === 'string' ? args.query : null
  const sourceId = typeof args.sourceId === 'string' ? args.sourceId : null
  if (query) return `query: ${query}`
  if (sourceId) return `sourceId: ${sourceId}`
  if (typeof args.displayId === 'number') return `display: ${args.displayId}`
  return null
}

export function ScreenshotToolWidget({
  widget,
  isStreaming
}: ToolWidgetComponentProps): React.JSX.Element {
  const debugMode = useSettingsStore((state) => state.debugMode)
  const installedPlugins = usePluginStore((state) => state.installed)
  const installedPluginsLoaded = usePluginStore((state) => state.installedLoaded)
  const reloadInstalledPlugins = usePluginStore((state) => state.reloadInstalledPlugins)
  const [axTreeOpen, setAxTreeOpen] = useState(true)
  const [imageOpen, setImageOpen] = useState(true)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [failedComputerUseIconSrc, setFailedComputerUseIconSrc] = useState<string | null>(null)
  const computerUsePlugin = installedPlugins.find(
    (plugin) =>
      plugin.name === 'computer-use' ||
      plugin.id === 'computer-use' ||
      plugin.id.endsWith(':computer-use')
  )
  const rawComputerUseIconSrc = computerUsePlugin ? pluginIconUrl(computerUsePlugin) : undefined
  const computerUseIconSrc =
    rawComputerUseIconSrc && rawComputerUseIconSrc !== failedComputerUseIconSrc
      ? rawComputerUseIconSrc
      : undefined

  useEffect(() => {
    if (!lightboxOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxOpen])

  useEffect(() => {
    if (!installedPluginsLoaded) {
      void reloadInstalledPlugins().catch(() => {})
    }
  }, [installedPluginsLoaded, reloadInstalledPlugins])

  const image = extractImage(widget.result)
  const meta = extractMeta(widget.result)
  const queryLabel = inferQueryLabel(widget.args)
  const isDesktop = widget.toolName === 'captureDesktop'
  const Icon = isDesktop ? Monitor : ImageIcon
  const hasAxTree = Boolean(meta.axTree)
  const hasAxTreeText = typeof meta.axTree?.text === 'string' && meta.axTree.text.length > 0
  const hasAxTreeStats =
    typeof meta.axTree?.nodeCount === 'number' ||
    typeof meta.axTree?.focusedElementId === 'number' ||
    Boolean(meta.axTree?.truncated)

  // Loading state — the agent is still running this tool.
  if (isStreaming && !image) {
    return (
      <div className="my-1 flex items-center gap-2 rounded-md border border-border/60 bg-card-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
        <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/40" />
        <Icon className="size-3.5" strokeWidth={2} />
        <span className="font-medium text-foreground/80">
          {isDesktop ? 'Capturing desktop' : 'Capturing window'}
          {queryLabel ? ` — ${queryLabel}` : ''}
          ...
        </span>
      </div>
    )
  }

  // Error state — show the message inline.
  if (widget.isError) {
    const errorText =
      (typeof widget.result === 'string' && widget.result) ||
      (() => {
        const text = (widget.result as ScreenshotResult | undefined)?.content?.find(
          (c): c is TextBlock => c.type === 'text'
        )
        return text?.text ?? 'Screen capture failed.'
      })()
    return (
      <div className="my-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
        <div className="mb-1 flex items-center gap-1.5 font-medium">
          <Icon className="size-3.5" strokeWidth={2} />
          {widget.toolName} failed
        </div>
        <p className="text-destructive/90">{errorText}</p>
      </div>
    )
  }

  // No image (shouldn't normally happen on success, but be defensive).
  if (!image) {
    return (
      <div className="my-1 px-2 py-1 text-[12px] text-muted-foreground">
        {widget.toolName}: no image returned.
      </div>
    )
  }

  const url = imageUrl(image)
  const dimensions = meta.width && meta.height ? `${meta.width}×${meta.height}` : null
  const showDebugDetails = debugMode
  const showAxTree = debugMode && hasAxTree

  return (
    <>
      <div className="my-1 overflow-hidden rounded-lg border border-border/60 bg-card-muted/30">
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <button
            type="button"
            onClick={() => setImageOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1.5 text-left transition hover:text-foreground"
            aria-expanded={imageOpen}
            aria-label={imageOpen ? 'Collapse screenshot' : 'Expand screenshot'}
          >
            <ChevronDown
              className={`size-3 shrink-0 text-muted-foreground/60 transition-transform ${
                imageOpen ? '' : '-rotate-90'
              }`}
              strokeWidth={2}
            />
            <span className="relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm text-muted-foreground">
              <Icon className="size-3.5" strokeWidth={2} />
              {computerUseIconSrc ? (
                <img
                  key={computerUseIconSrc}
                  src={computerUseIconSrc}
                  alt="Computer Use icon"
                  className="absolute inset-0 size-full object-cover"
                  onError={() => setFailedComputerUseIconSrc(computerUseIconSrc)}
                />
              ) : null}
            </span>
            <span className="truncate font-medium text-foreground/80">
              Computer Use · {meta.sourceName ?? (isDesktop ? 'Desktop' : 'Window')}
            </span>
            {dimensions && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="tabular-nums">{dimensions}</span>
              </>
            )}
          </button>
          <div className="flex shrink-0 items-center gap-1 pr-2">
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-card-muted hover:text-foreground"
              title="Open full size"
            >
              <Maximize2 className="size-3" strokeWidth={2} />
              <span>Full</span>
            </button>
            {showDebugDetails ? (
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-card-muted hover:text-foreground"
              >
                <span>Details</span>
                <ChevronDown
                  className={`size-3 transition-transform ${detailsOpen ? '' : '-rotate-90'}`}
                  strokeWidth={2}
                />
              </button>
            ) : null}
          </div>
        </div>

        {showAxTree && (
          <div className="border-t border-border/60">
            <button
              type="button"
              onClick={() => setAxTreeOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-muted-foreground transition hover:text-foreground"
              aria-expanded={axTreeOpen}
              aria-label={axTreeOpen ? 'Collapse accessibility tree' : 'Expand accessibility tree'}
            >
              <ChevronDown
                className={`size-3 shrink-0 text-muted-foreground/60 transition-transform ${
                  axTreeOpen ? '' : '-rotate-90'
                }`}
                strokeWidth={2}
              />
              <FileText className="size-3.5 shrink-0" strokeWidth={2} />
              <span className="font-medium text-foreground/80">Accessibility tree</span>
              {hasAxTreeStats ? (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="tabular-nums">{meta.axTree?.nodeCount ?? 0} nodes</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="truncate">
                    focused{' '}
                    {meta.axTree?.focusedRef ?? meta.axTree?.focusedElementId ?? 'not found'}
                    {meta.axTree?.truncated ? ' · truncated' : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="truncate">text only</span>
                </>
              )}
            </button>

            {axTreeOpen && (
              <div className="space-y-3 border-t border-border/60 px-3 py-3">
                {hasAxTreeStats && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">Nodes:</span>{' '}
                      <span className="tabular-nums">
                        {meta.axTree?.nodeCount ?? 0}
                        {meta.axTree?.truncated ? ' (truncated)' : ''}
                      </span>
                    </div>
                    <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">Focused:</span>{' '}
                      <span className="tabular-nums">
                        {meta.axTree?.focusedRef ?? meta.axTree?.focusedElementId ?? 'Not found'}
                      </span>
                    </div>
                    <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">Window:</span>{' '}
                      {meta.sourceName ?? (isDesktop ? 'Desktop' : 'App window')}
                    </div>
                  </div>
                )}

                {hasAxTreeText ? (
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium text-foreground/80">
                      AX tree text
                      {meta.axTree?.snapshotId ? (
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          · snapshot {meta.axTree.snapshotId.slice(0, 8)}
                        </span>
                      ) : null}
                    </div>
                    <pre className="max-h-72 overflow-auto rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap">
                      {meta.axTree?.text}
                    </pre>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border/60 bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
                    Accessibility metadata is available, but no tree text was returned.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {imageOpen && (
          <div className={showAxTree ? 'border-t border-border/60' : ''}>
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="block w-full cursor-zoom-in bg-black/5 transition hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
              aria-label="View screenshot full size"
            >
              <img
                src={url}
                alt={meta.sourceName ?? 'Screenshot'}
                className="block max-h-[480px] w-full object-contain"
                loading="lazy"
                draggable={false}
              />
            </button>
          </div>
        )}

        {showDebugDetails && detailsOpen && (
          <div className="space-y-2 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            {Object.keys(widget.args).length > 0 && (
              <div>
                <div className="mb-0.5 font-medium text-foreground/70">Arguments</div>
                <pre className="max-h-32 overflow-auto rounded bg-card-muted px-2 py-1 leading-relaxed">
                  {JSON.stringify(widget.args, null, 2)}
                </pre>
              </div>
            )}
            {(meta.sourceName || meta.sourceId) && (
              <div>
                <span className="font-medium text-foreground/70">Source: </span>
                <span>
                  {meta.sourceName ?? '(unnamed)'}
                  {meta.sourceId ? ` · ${meta.sourceId}` : ''}
                </span>
              </div>
            )}
            {meta.axTree && (
              <div className="space-y-0.5">
                <div className="font-medium text-foreground/70">Accessibility</div>
                {hasAxTreeStats ? (
                  <>
                    <div>
                      <span className="text-muted-foreground/70">Nodes: </span>
                      <span>
                        {meta.axTree.nodeCount ?? 0}
                        {meta.axTree.truncated ? ' (truncated)' : ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground/70">Focused node: </span>
                      <span>
                        {meta.axTree.focusedRef ?? meta.axTree.focusedElementId ?? 'Not found'}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-muted-foreground/70">Text-only AX summary</div>
                )}
                {typeof meta.axTree.text === 'string' && meta.axTree.text && (
                  <pre className="max-h-48 overflow-auto rounded bg-card-muted px-2 py-1 leading-relaxed whitespace-pre-wrap">
                    {meta.axTree.text}
                  </pre>
                )}
              </div>
            )}
            {meta.geometry && (
              <div className="space-y-0.5">
                <div className="font-medium text-foreground/70">Geometry</div>
                <div>
                  <span className="text-muted-foreground/70">Region: </span>
                  <span>{meta.geometry.region ?? '—'}</span>
                  {meta.geometry.region === 'window-frame' && (
                    <span className="text-muted-foreground/60"> (includes title bar)</span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground/70">Coords: </span>
                  <span>
                    {meta.geometry.coordinateSpace ?? 'cg-global'} · origin{' '}
                    {meta.geometry.originY ?? 'top'} · unit {meta.geometry.unit ?? 'point'}
                  </span>
                </div>
                {meta.geometry.displayId !== undefined && (
                  <div>
                    <span className="text-muted-foreground/70">Display: </span>
                    <span className="tabular-nums">
                      #{meta.geometry.displayId}
                      {meta.geometry.displayScaleFactor !== undefined &&
                        ` @${meta.geometry.displayScaleFactor}x`}
                      {fmtBounds(meta.geometry.displayBounds) &&
                        ` · ${fmtBounds(meta.geometry.displayBounds)} pt`}
                    </span>
                  </div>
                )}
                {meta.geometry.windowBounds && (
                  <div>
                    <span className="text-muted-foreground/70">Window: </span>
                    <span className="tabular-nums">{fmtBounds(meta.geometry.windowBounds)} pt</span>
                  </div>
                )}
                {meta.geometry.nativePixelSize && (
                  <div>
                    <span className="text-muted-foreground/70">Native px: </span>
                    <span className="tabular-nums">
                      {meta.geometry.nativePixelSize.width} × {meta.geometry.nativePixelSize.height}
                      {meta.geometry.thumbnailScale !== undefined &&
                        ` · thumbnail scale ${meta.geometry.thumbnailScale.toFixed(3)}`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {lightboxOpen && (
        <button
          type="button"
          onClick={() => setLightboxOpen(false)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          aria-label="Close full-size screenshot"
        >
          <img
            src={url}
            alt={meta.sourceName ?? 'Screenshot'}
            className="max-h-full max-w-full rounded-md shadow-2xl"
            draggable={false}
          />
          <span className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-md bg-black/40 px-2 py-1 text-xs text-white/90">
            <X className="size-3.5" strokeWidth={2} /> Close (Esc)
          </span>
        </button>
      )}
    </>
  )
}
