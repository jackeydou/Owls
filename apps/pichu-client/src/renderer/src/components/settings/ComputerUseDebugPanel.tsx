import type {
  ComputerUseAppStateResult,
  ComputerUseAppTarget,
  ComputerUseCapturedWindow,
  ComputerUseDebugInventory,
  ComputerUseModifier,
  ComputerUseWindowTarget
} from '@renderer/../../preload/index.d'
import { cn } from '@renderer/lib/utils'
import {
  Check,
  Copy,
  Keyboard,
  MousePointerClick,
  RefreshCw,
  ScanSearch,
  Sparkles
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { SettingsButton, SettingsRow } from './settings-ui'

const MODIFIER_OPTIONS: ComputerUseModifier[] = [
  'shift',
  'control',
  'option',
  'command',
  'function'
]

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function parsePerCharDelay(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isAppStateResult(value: unknown): value is ComputerUseAppStateResult {
  if (!value || typeof value !== 'object') return false
  return (
    'text' in value &&
    typeof value.text === 'string' &&
    'elements' in value &&
    Array.isArray(value.elements) &&
    'snapshotId' in value &&
    typeof value.snapshotId === 'string'
  )
}

export function ComputerUseDebugPanel(): React.JSX.Element {
  const { t } = useI18n()
  const [inventory, setInventory] = useState<ComputerUseDebugInventory | null>(null)
  const [selectedAppId, setSelectedAppId] = useState('')
  const [selectedWindowId, setSelectedWindowId] = useState('')
  const [capture, setCapture] = useState<ComputerUseCapturedWindow | null>(null)
  const [selectedCapturePoint, setSelectedCapturePoint] = useState<{ x: number; y: number } | null>(
    null
  )
  const [lastResult, setLastResult] = useState<unknown>(null)
  const [lastResultAction, setLastResultAction] = useState<string | null>(null)
  const [typeText, setTypeText] = useState('Owls computer use test')
  const [perCharDelayMs, setPerCharDelayMs] = useState('0')
  const [keyValue, setKeyValue] = useState('tab')
  const [keyModifiers, setKeyModifiers] = useState<ComputerUseModifier[]>([])
  const [clickRef, setClickRef] = useState('')
  const [loadingInventory, setLoadingInventory] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionLog, setActionLog] = useState<string[]>([])
  const [copiedAxTree, setCopiedAxTree] = useState(false)

  const pushActionLog = (message: string): void => {
    const timestamp = new Date().toLocaleTimeString()
    setActionLog((current) => [`[${timestamp}] ${message}`, ...current].slice(0, 16))
  }

  const selectedApp = useMemo<ComputerUseAppTarget | null>(() => {
    return inventory?.apps.find((app) => app.id === selectedAppId) ?? null
  }, [inventory, selectedAppId])

  const selectedWindow = useMemo<ComputerUseWindowTarget | null>(() => {
    if (!selectedApp) return null
    return (
      selectedApp.windows.find((window) => String(window.windowId) === selectedWindowId) ?? null
    )
  }, [selectedApp, selectedWindowId])

  useEffect(() => {
    if (!inventory || inventory.apps.length === 0) return
    const nextApp =
      inventory.apps.find((app) => app.id === selectedAppId) ??
      inventory.apps.find((app) => app.windows.length > 0) ??
      inventory.apps[0]
    if (nextApp.id !== selectedAppId) {
      setSelectedAppId(nextApp.id)
    }
    const nextWindow =
      nextApp.windows.find((window) => String(window.windowId) === selectedWindowId) ??
      nextApp.windows[0]
    if (nextWindow && String(nextWindow.windowId) !== selectedWindowId) {
      setSelectedWindowId(String(nextWindow.windowId))
      setCapture(null)
      setSelectedCapturePoint(null)
      setClickRef('')
    }
  }, [inventory, selectedAppId, selectedWindowId])

  const loadTargets = async (): Promise<void> => {
    setLoadingInventory(true)
    setError(null)
    pushActionLog('Loading open apps and windows')
    try {
      const nextInventory = await window.api.computerUseDebug.listTargets()
      setInventory(nextInventory)
      setLastResult(nextInventory)
      setLastResultAction('load-targets')
      pushActionLog(
        `Loaded ${nextInventory.apps.length} apps and ${nextInventory.apps.reduce((sum, app) => sum + app.windows.length, 0)} windows`
      )
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
      pushActionLog(
        `Load failed: ${nextError instanceof Error ? nextError.message : String(nextError)}`
      )
    } finally {
      setLoadingInventory(false)
    }
  }

  const handleCapturePointSelect = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (!capture) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const relativeX = (event.clientX - rect.left) / rect.width
    const relativeY = (event.clientY - rect.top) / rect.height
    const x = Math.min(capture.width - 1, Math.max(0, Math.round(relativeX * capture.width)))
    const y = Math.min(capture.height - 1, Math.max(0, Math.round(relativeY * capture.height)))
    setSelectedCapturePoint({ x, y })
    pushActionLog(`Selected captured pixel (${x}, ${y})`)
  }

  const runAction = async (
    action: string,
    fn: () => Promise<unknown>,
    options?: { clearCapture?: boolean }
  ): Promise<void> => {
    setBusyAction(action)
    setError(null)
    pushActionLog(
      `Running ${action}${selectedWindow ? ` on ${selectedWindow.ownerName} / ${selectedWindow.windowId}` : ''}`
    )
    if (options?.clearCapture) {
      setCapture(null)
    }
    try {
      const result = await fn()
      setLastResult(result)
      setLastResultAction(action)
      pushActionLog(`Finished ${action}`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
      pushActionLog(
        `${action} failed: ${nextError instanceof Error ? nextError.message : String(nextError)}`
      )
    } finally {
      setBusyAction(null)
    }
  }

  const hasTargets = Boolean(inventory && inventory.apps.length > 0 && selectedWindow)
  const appStateResult = isAppStateResult(lastResult) ? lastResult : null
  const genericResult = appStateResult ? null : lastResult

  const readAppState = (): Promise<ComputerUseAppStateResult> =>
    window.api.computerUseDebug.appState({
      windowId: selectedWindow?.windowId ?? 0,
      sourceId: selectedWindow?.sourceId ?? null
    })

  const copyAccessibilityTreeResult = async (): Promise<void> => {
    if (!appStateResult) return
    try {
      await navigator.clipboard.writeText(appStateResult.text)
      setCopiedAxTree(true)
      pushActionLog('Copied app state result')
      window.setTimeout(() => setCopiedAxTree(false), 1600)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
      pushActionLog(
        `Copy failed: ${nextError instanceof Error ? nextError.message : String(nextError)}`
      )
    }
  }

  useEffect(() => {
    if (!appStateResult) return
    if (appStateResult.focusedElementRef) {
      setClickRef(appStateResult.focusedElementRef)
    }
  }, [appStateResult])

  return (
    <>
      <SettingsRow
        label={t('advanced.computerUseLab.label')}
        description={t('advanced.computerUseLab.description')}
      >
        <SettingsButton disabled={loadingInventory} onClick={() => void loadTargets()}>
          <RefreshCw
            className={cn('size-3.5', loadingInventory && 'animate-spin')}
            strokeWidth={1.8}
          />
          {loadingInventory
            ? t('advanced.computerUseLab.loadingApps')
            : t('advanced.computerUseLab.openApps')}
        </SettingsButton>
      </SettingsRow>

      {inventory ? (
        <div className="space-y-4 border-t border-border/55 px-3.5 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border/60 bg-foreground/3 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Apps</p>
              <p className="mt-1 text-[18px] font-semibold text-foreground">
                {inventory.apps.length}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-foreground/3 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Windows</p>
              <p className="mt-1 text-[18px] font-semibold text-foreground">
                {inventory.apps.reduce((sum, app) => sum + app.windows.length, 0)}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-foreground/3 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Displays</p>
              <p className="mt-1 text-[18px] font-semibold text-foreground">
                {inventory.displays.length}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[12px] font-medium text-foreground">App</span>
              <select
                value={selectedAppId}
                onChange={(event) => {
                  const appId = event.target.value
                  setSelectedAppId(appId)
                  const nextApp = inventory.apps.find((app) => app.id === appId)
                  setCapture(null)
                  setSelectedCapturePoint(null)
                  setClickRef('')
                  setSelectedWindowId(
                    nextApp?.windows[0] ? String(nextApp.windows[0].windowId) : ''
                  )
                }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition focus:border-border-strong focus:ring-1 focus:ring-border-strong"
              >
                {inventory.apps.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.ownerName} (pid {app.ownerPid}, {app.windows.length} window
                    {app.windows.length === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[12px] font-medium text-foreground">Window</span>
              <select
                value={selectedWindowId}
                onChange={(event) => {
                  setCapture(null)
                  setSelectedCapturePoint(null)
                  setClickRef('')
                  setSelectedWindowId(event.target.value)
                }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition focus:border-border-strong focus:ring-1 focus:ring-border-strong"
                disabled={!selectedApp || selectedApp.windows.length === 0}
              >
                {selectedApp?.windows.map((window) => (
                  <option key={window.windowId} value={String(window.windowId)}>
                    {window.title || window.sourceName || `Window ${window.windowId}`}
                  </option>
                )) ?? <option value="">No window</option>}
              </select>
            </label>
          </div>

          {selectedWindow ? (
            <div className="rounded-md border border-border/60 bg-foreground/3 p-3 text-[12px] text-muted-foreground">
              <div className="grid gap-1 sm:grid-cols-2">
                <p>
                  <span className="font-medium text-foreground">App:</span>{' '}
                  {selectedWindow.ownerName} (pid {selectedWindow.ownerPid})
                </p>
                <p>
                  <span className="font-medium text-foreground">Window ID:</span>{' '}
                  {selectedWindow.windowId}
                </p>
                <p>
                  <span className="font-medium text-foreground">Title:</span>{' '}
                  {selectedWindow.title || '(untitled)'}
                </p>
                <p>
                  <span className="font-medium text-foreground">Display:</span>{' '}
                  {selectedWindow.displayLabel || selectedWindow.displayId || 'Unknown'}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-medium text-foreground">Bounds:</span>{' '}
                  {Math.round(selectedWindow.bounds.x)},{Math.round(selectedWindow.bounds.y)}{' '}
                  {Math.round(selectedWindow.bounds.width)}x
                  {Math.round(selectedWindow.bounds.height)}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-medium text-foreground">Capture source:</span>{' '}
                  {selectedWindow.sourceId ?? 'Unavailable'}
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={!hasTargets || busyAction !== null}
              onClick={() =>
                void runAction('animate-overlay', () =>
                  window.api.computerUseDebug.animateOverlay({
                    windowId: selectedWindow?.windowId ?? 0,
                    pointCount: 4
                  })
                )
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-foreground/4 disabled:opacity-30"
            >
              <Sparkles className="size-3.5" strokeWidth={1.8} />
              {busyAction === 'animate-overlay' ? 'Animating...' : 'Animate overlay'}
            </button>
            <button
              type="button"
              disabled={!hasTargets || busyAction !== null}
              onClick={() =>
                void runAction('drag', () =>
                  window.api.computerUseDebug.drag({ windowId: selectedWindow?.windowId ?? 0 })
                )
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-foreground/4 disabled:opacity-30"
            >
              <MousePointerClick className="size-3.5" strokeWidth={1.8} />
              {busyAction === 'drag' ? 'Dragging...' : 'Run computerDrag'}
            </button>
          </div>

          <div className="space-y-2 rounded-md border border-border/60 bg-foreground/3 p-3">
            <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
              <Keyboard className="size-3.5" strokeWidth={1.8} />
              Keyboard tools
            </div>
            <textarea
              value={typeText}
              onChange={(event) => setTypeText(event.target.value)}
              className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-border-strong focus:ring-1 focus:ring-border-strong"
              placeholder="Text to send with computerType"
            />
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
              <input
                type="text"
                value={keyValue}
                onChange={(event) => setKeyValue(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-border-strong focus:ring-1 focus:ring-border-strong"
                placeholder="tab"
                autoComplete="off"
                spellCheck={false}
              />
              <input
                type="text"
                value={perCharDelayMs}
                onChange={(event) => setPerCharDelayMs(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-border-strong focus:ring-1 focus:ring-border-strong"
                placeholder="0"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                disabled={!hasTargets || busyAction !== null || !typeText.trim()}
                onClick={() =>
                  void runAction('type', () =>
                    window.api.computerUseDebug.type({
                      windowId: selectedWindow?.windowId ?? 0,
                      text: typeText,
                      perCharDelayMs: parsePerCharDelay(perCharDelayMs)
                    })
                  )
                }
                className="rounded-md bg-foreground px-3 py-2 text-[13px] font-medium text-background transition hover:opacity-90 disabled:opacity-30"
              >
                {busyAction === 'type' ? 'Typing...' : 'Type text'}
              </button>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Left input: key for <code className="font-mono">computerPressKey</code>. Middle input:
              per-char delay for <code className="font-mono">computerType</code>.
            </p>
            <div className="flex flex-wrap gap-2">
              {MODIFIER_OPTIONS.map((modifier) => {
                const active = keyModifiers.includes(modifier)
                return (
                  <button
                    key={modifier}
                    type="button"
                    onClick={() =>
                      setKeyModifiers((current) =>
                        current.includes(modifier)
                          ? current.filter((entry) => entry !== modifier)
                          : [...current, modifier]
                      )
                    }
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[12px] transition',
                      active
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {modifier}
                  </button>
                )
              })}
              <button
                type="button"
                disabled={!hasTargets || busyAction !== null || !keyValue.trim()}
                onClick={() =>
                  void runAction('press-key', () =>
                    window.api.computerUseDebug.pressKey({
                      windowId: selectedWindow?.windowId ?? 0,
                      key: keyValue,
                      modifiers: keyModifiers
                    })
                  )
                }
                className="rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-foreground transition hover:bg-foreground/4 disabled:opacity-30"
              >
                {busyAction === 'press-key' ? 'Sending key...' : 'Press key'}
              </button>
            </div>
          </div>

          <div className="space-y-2 rounded-md border border-border/60 bg-foreground/3 p-3">
            <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
              <ScanSearch className="size-3.5" strokeWidth={1.8} />
              App state
            </div>
            <p className="text-[12px] text-muted-foreground">
              Captures the selected window and shows the same compact ref-based state used by the
              agent-facing Computer Use tools.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!hasTargets || busyAction !== null || !selectedWindow?.sourceId}
                onClick={() =>
                  void runAction('app-state', async () => {
                    const result = await readAppState()
                    setCapture(result.screenshot)
                    setSelectedCapturePoint(null)
                    return result
                  })
                }
                className="rounded-md bg-foreground px-3 py-2 text-[13px] font-medium text-background transition hover:opacity-90 disabled:opacity-30"
              >
                {busyAction === 'app-state' ? 'Reading state...' : 'Get app state'}
              </button>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Refs like <code className="font-mono">e62</code> map to app-state elements and can be
              used for <code className="font-mono">computerClick</code>. The click uses the semantic
              path first and falls back to a physical center click when needed.
            </p>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                type="text"
                value={clickRef}
                onChange={(event) => setClickRef(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-border-strong focus:ring-1 focus:ring-border-strong"
                placeholder="Element ref, e.g. e62"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                disabled={!hasTargets || busyAction !== null || !appStateResult || !clickRef.trim()}
                onClick={() =>
                  void runAction('click-ref', () =>
                    window.api.computerUseDebug.click({
                      snapshotId: appStateResult?.snapshotId,
                      ref: clickRef.trim()
                    })
                  )
                }
                className="rounded-md border border-border px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-foreground/4 disabled:opacity-30"
              >
                {busyAction === 'click-ref' ? 'Clicking ref...' : 'Click ref'}
              </button>
            </div>
            <p className="text-[12px] text-muted-foreground">
              This is the same ref path as the agent tool: pass a ref from the latest snapshot, then
              let the backend choose the semantic click path or physical fallback.
            </p>
            <div className="rounded-md border border-border/60 bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] font-medium text-foreground">App state result</p>
                {appStateResult ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12px] text-muted-foreground">
                      {appStateResult.ownerName || 'App'} · pid {appStateResult.pid} ·{' '}
                      {appStateResult.nodeCount} node{appStateResult.nodeCount === 1 ? '' : 's'}
                      {appStateResult.truncated ? ' · truncated' : ''}
                    </p>
                    <button
                      type="button"
                      onClick={() => void copyAccessibilityTreeResult()}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] font-medium text-foreground transition hover:bg-foreground/4"
                    >
                      {copiedAxTree ? (
                        <Check className="size-3" strokeWidth={1.8} />
                      ) : (
                        <Copy className="size-3" strokeWidth={1.8} />
                      )}
                      {copiedAxTree ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    Result from Get app state will appear here.
                  </p>
                )}
              </div>
              {appStateResult ? (
                <>
                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    <div className="rounded-md border border-border/60 bg-foreground/3 px-3 py-2 text-[12px] text-muted-foreground">
                      <span className="font-medium text-foreground">Snapshot:</span>{' '}
                      {appStateResult.snapshotId.slice(0, 8)}
                    </div>
                    <div className="rounded-md border border-border/60 bg-foreground/3 px-3 py-2 text-[12px] text-muted-foreground">
                      <span className="font-medium text-foreground">Focused ref:</span>{' '}
                      {appStateResult.focusedElementRef ?? 'Not found'}
                    </div>
                    <div className="rounded-md border border-border/60 bg-foreground/3 px-3 py-2 text-[12px] text-muted-foreground">
                      <span className="font-medium text-foreground">Target:</span> pid{' '}
                      {appStateResult.pid}
                    </div>
                    <div className="rounded-md border border-border/60 bg-foreground/3 px-3 py-2 text-[12px] text-muted-foreground">
                      <span className="font-medium text-foreground">Screenshot:</span>{' '}
                      {appStateResult.screenshot.width}x{appStateResult.screenshot.height}
                    </div>
                  </div>
                  <pre className="mt-3 max-h-112 overflow-auto rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
                    {appStateResult.text}
                  </pre>
                </>
              ) : null}
            </div>
          </div>

          {inventory.sourceError ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
              Screen-source metadata is only partially available right now: {inventory.sourceError}
            </p>
          ) : null}
        </div>
      ) : null}

      {actionLog.length > 0 ? (
        <div className="space-y-2 border-t border-border/55 px-3.5 py-4">
          <p className="text-[12px] font-medium text-foreground">Action log</p>
          <div className="max-h-40 overflow-auto rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
            {actionLog.map((entry) => (
              <div key={entry}>{entry}</div>
            ))}
          </div>
        </div>
      ) : null}

      {capture ? (
        <div className="space-y-2 border-t border-border/55 px-3.5 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-medium text-foreground">Last capture</p>
            <p className="text-[12px] text-muted-foreground">
              Click the image to select a PNG pixel for coordinate-based computerClick testing.
            </p>
          </div>
          <div className="rounded-md border border-border/60 bg-background p-3">
            <div className="relative inline-block max-w-full">
              <button
                type="button"
                onClick={handleCapturePointSelect}
                className="relative inline-block max-w-full cursor-crosshair rounded-md p-0"
              >
                <img
                  src={
                    capture.data
                      ? `data:${capture.mimeType};base64,${capture.data}`
                      : `pichu-screenshot://local/${encodeURIComponent(capture.path)}`
                  }
                  alt={capture.source.name}
                  className="block max-h-80 max-w-full rounded-md border border-border/60 bg-background"
                />
                {selectedCapturePoint ? (
                  <div
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                    style={{
                      left: `${(selectedCapturePoint.x / capture.width) * 100}%`,
                      top: `${(selectedCapturePoint.y / capture.height) * 100}%`
                    }}
                  >
                    <div className="size-2 rounded-full border border-white bg-red-500 shadow-sm" />
                    <div className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-red-500/90" />
                    <div className="absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 bg-red-500/90" />
                  </div>
                ) : null}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="rounded-md border border-border/60 bg-foreground/3 px-3 py-2 text-[12px] text-muted-foreground">
                {selectedCapturePoint ? (
                  <>
                    Selected pixel:{' '}
                    <span className="font-medium text-foreground">
                      {selectedCapturePoint.x}, {selectedCapturePoint.y}
                    </span>
                  </>
                ) : (
                  'No pixel selected yet.'
                )}
              </div>
              <button
                type="button"
                disabled={!selectedWindow || !selectedCapturePoint || busyAction !== null}
                onClick={() =>
                  void runAction('click-pixel', () =>
                    window.api.computerUseDebug.click({
                      windowId: selectedWindow?.windowId ?? 0,
                      position: {
                        space: 'screenshot-pixels',
                        px: selectedCapturePoint?.x ?? 0,
                        py: selectedCapturePoint?.y ?? 0,
                        geometry: capture.geometry
                      }
                    })
                  )
                }
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-foreground/4 disabled:opacity-30"
              >
                <MousePointerClick className="size-3.5" strokeWidth={1.8} />
                {busyAction === 'click-pixel' ? 'Clicking pixel...' : 'Click selected pixel'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lastResult &&
      typeof lastResult === 'object' &&
      lastResult !== null &&
      'probe' in lastResult &&
      lastResult.probe &&
      typeof lastResult.probe === 'object' &&
      'snapshot' in lastResult.probe &&
      lastResult.probe.snapshot &&
      typeof lastResult.probe.snapshot === 'object' &&
      'data' in lastResult.probe.snapshot &&
      typeof lastResult.probe.snapshot.data === 'string' &&
      'mimeType' in lastResult.probe.snapshot &&
      typeof lastResult.probe.snapshot.mimeType === 'string' ? (
        <div className="space-y-2 border-t border-border/55 px-3.5 py-4">
          <p className="text-[12px] font-medium text-foreground">Overlay probe snapshot</p>
          <img
            src={`data:${lastResult.probe.snapshot.mimeType};base64,${lastResult.probe.snapshot.data}`}
            alt="Overlay probe"
            className="max-h-80 w-full rounded-md border border-border/60 bg-background object-contain"
          />
        </div>
      ) : null}

      {genericResult ? (
        <div className="space-y-2 border-t border-border/55 px-3.5 py-4">
          <p className="text-[12px] font-medium text-foreground">
            Last result
            {lastResultAction ? (
              <span className="font-normal text-muted-foreground"> · {lastResultAction}</span>
            ) : null}
          </p>
          <pre className="max-h-72 overflow-auto rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
            {formatJson(genericResult)}
          </pre>
        </div>
      ) : null}

      {inventory ? (
        <details className="mx-3.5 mb-4 rounded-md border border-border/60 bg-background">
          <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-foreground">
            Raw inventory JSON
          </summary>
          <pre className="max-h-72 overflow-auto border-t border-border/60 px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
            {formatJson(inventory)}
          </pre>
        </details>
      ) : null}

      {error ? (
        <p
          className="border-t border-border/55 px-3.5 py-3 text-[13px] text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </>
  )
}
