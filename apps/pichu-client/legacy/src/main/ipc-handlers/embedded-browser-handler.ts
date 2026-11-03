import {
  webContents as electronWebContents,
  type IpcMainInvokeEvent,
  ipcMain,
  type Rectangle,
  type WebContents,
  type WebFrameMain
} from 'electron'

import {
  BROWSER_ANNOTATION_HOST_COMMAND_CHANNEL,
  BROWSER_ANNOTATION_RUNTIME_EVENT_CHANNEL,
  BROWSER_ANNOTATION_SCREENSHOT_CROP_PADDING_PX,
  type BrowserAnnotationCommitted,
  type BrowserAnnotationDraft,
  type BrowserAnnotationHostCommand,
  type BrowserAnnotationLabels,
  type BrowserAnnotationMode,
  type BrowserAnnotationSubmission,
  browserAnnotationCompactScreenshotRect,
  browserAnnotationUrlsMatch,
  parseBrowserAnnotationCommitted,
  parseBrowserAnnotationDraft,
  parseBrowserAnnotationSubmission
} from '../../shared/browser-annotation.js'
import { normalizeWebTargetUrl } from '../../shared/web-targets.js'
import { getBrowserManager } from '../browser-use/browser-manager.js'

const EMBEDDED_BROWSER_EVENT_CHANNEL = 'embedded-browser:event'
const EMBEDDED_BROWSER_DRAFT_SESSION_KEY = '__draft__'
const DEFAULT_READY_TIMEOUT_MS = 5000
const DEFAULT_MAIN_FRAME_READY_TIMEOUT_MS = 8000
const DEFAULT_CURSOR_COMMAND_TIMEOUT_MS = 5000
const SUSPEND_MEDIA_SCRIPT = `
  for (const media of document.querySelectorAll('audio, video')) {
    media.pause()
  }
`

type EmbeddedBrowserRendererEvent =
  | { type: 'open-url'; url: string; sessionKey: string; visible: boolean }
  | { type: 'open-blank'; sessionKey: string }
  | { type: 'close'; sessionKey: string }
  | { type: 'state'; sessionKey: string; status: EmbeddedBrowserStatus }
  | {
      type: 'annotation-draft-created'
      sessionKey: string
      annotation: BrowserAnnotationDraft
    }
  | {
      type: 'annotation-draft-cleared'
      sessionKey: string
      annotationId?: string
    }
  | {
      type: 'annotation-submitted'
      sessionKey: string
      annotation: {
        annotationId: string
        label: number
        comment: string
        anchor: NonNullable<ReturnType<typeof parseBrowserAnnotationSubmission>>['anchor']
        pastedImages?: NonNullable<
          ReturnType<typeof parseBrowserAnnotationSubmission>
        >['pastedImages']
        screenshot?: {
          data: ArrayBuffer
          width: number
          height: number
          annotationViewportRect?: Rectangle
          cropViewportRect?: Rectangle
          cropPaddingPx?: number
          markerViewportPoint?: { x: number; y: number }
        }
      }
    }
  | EmbeddedBrowserCursorCommand

export type EmbeddedBrowserStatus = {
  open: boolean
  attached: boolean
  webContentsId: number | null
  url: string | null
  title: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  annotationMode: BrowserAnnotationMode
  annotationCount: number
}

type EmbeddedBrowserViewBoundsInput = {
  sessionKey: string
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export type EmbeddedBrowserSnapshot = {
  url: string
  title: string
  text: string
  elements: Array<{
    index: number
    tagName: string
    role: string | null
    type: string | null
    text: string
    selector: string
    href: string | null
    value: string | null
    placeholder: string | null
    name: string | null
  }>
}

type EmbeddedBrowserCursorPoint = { x: number; y: number }

type EmbeddedBrowserCursorCommand = {
  type: 'cursor-command'
  commandId: string
  sessionKey: string
  action: 'move' | 'move-click' | 'hide'
  point?: EmbeddedBrowserCursorPoint
}

type EmbeddedBrowserCursorCommandCompletion = {
  commandId: string
  ok: boolean
  error?: string
}

type EmbeddedBrowserOpenOptions = {
  sessionKey?: string
  waitUntilLoaded?: boolean
  visible?: boolean
}

type EmbeddedBrowserAnnotationModeInput = {
  sessionKey?: string | null
  mode: BrowserAnnotationMode
  labels: BrowserAnnotationLabels
}

type EmbeddedBrowserSyncAnnotationsInput = {
  sessionKey?: string | null
  comments: BrowserAnnotationCommitted[]
}

type EmbeddedBrowserSelectAnnotationInput = {
  sessionKey?: string | null
  annotationId: string
}

type EmbeddedBrowserSubmitAnnotationDraftInput = {
  sessionKey?: string | null
  annotationId: string
  comment: string
}

type EmbeddedBrowserCancelAnnotationDraftInput = {
  sessionKey?: string | null
  annotationId?: string | null
}

const MAX_EMBEDDED_BROWSER_SESSION_KEY_LENGTH = 128

let getRendererWebContents: () => WebContents | null = () => null
let activeSessionKey = EMBEDDED_BROWSER_DRAFT_SESSION_KEY
const attachedWebContentsIdsBySessionKey = new Map<string, number>()
const lastRequestedUrlBySessionKey = new Map<string, string>()
const loadingBySessionKey = new Map<string, boolean>()
const annotationModeBySessionKey = new Map<string, BrowserAnnotationMode>()
const annotationLabelsBySessionKey = new Map<string, BrowserAnnotationLabels>()
const annotationCountBySessionKey = new Map<string, number>()
const annotationEpochBySessionKey = new Map<string, number>()
const annotationCommentsBySessionKey = new Map<string, BrowserAnnotationCommitted[]>()
const annotationDraftBySessionKey = new Map<string, BrowserAnnotationDraft>()
const managedStateEventBindings = new WeakSet<WebContents>()
const cursorCommandWaiters = new Map<
  string,
  {
    resolve: () => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
>()

const readyWaiters = new Set<{
  sessionKey: string
  resolve: (webContents: WebContents) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseOptionalSessionKey(value: unknown, label = 'sessionKey'): string | null | undefined {
  if (value === undefined || value === null) return value
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${label}.`)
  }
  if (value.length === 0 || value.length > MAX_EMBEDDED_BROWSER_SESSION_KEY_LENGTH) {
    throw new Error(`Invalid ${label}.`)
  }
  return value
}

function isKnownSessionKey(sessionKey: string): boolean {
  return (
    sessionKey === activeSessionKey ||
    sessionKey === EMBEDDED_BROWSER_DRAFT_SESSION_KEY ||
    lastRequestedUrlBySessionKey.has(sessionKey) ||
    attachedWebContentsIdsBySessionKey.has(sessionKey) ||
    annotationModeBySessionKey.has(sessionKey) ||
    annotationLabelsBySessionKey.has(sessionKey) ||
    annotationCountBySessionKey.has(sessionKey) ||
    annotationEpochBySessionKey.has(sessionKey) ||
    annotationCommentsBySessionKey.has(sessionKey) ||
    annotationDraftBySessionKey.has(sessionKey) ||
    Boolean(getBrowserManager()?.getSession(sessionKey))
  )
}

function assertKnownSessionKey(
  sessionKeyInput: string | null | undefined,
  sessionKey: string
): void {
  if (sessionKeyInput == null) return
  if (!isKnownSessionKey(sessionKey)) {
    throw new Error('Unknown sessionKey.')
  }
}

function parseAnnotationLabels(value: unknown): BrowserAnnotationLabels | null {
  if (!isRecord(value)) return null
  const { placeholder, add, cancel, hint } = value
  if (
    typeof placeholder !== 'string' ||
    typeof add !== 'string' ||
    typeof cancel !== 'string' ||
    typeof hint !== 'string'
  ) {
    return null
  }
  return { placeholder, add, cancel, hint }
}

function parseAnnotationModeInput(value: unknown): EmbeddedBrowserAnnotationModeInput {
  if (!isRecord(value)) {
    throw new Error('Invalid browser annotation mode request.')
  }
  if (value.mode !== 'browse' && value.mode !== 'comment') {
    throw new Error('Unsupported browser annotation mode.')
  }
  const labels = parseAnnotationLabels(value.labels)
  if (!labels) {
    throw new Error('Invalid browser annotation labels.')
  }
  const sessionKey = parseOptionalSessionKey(value.sessionKey)
  return { sessionKey, mode: value.mode, labels }
}

function parseSyncAnnotationsInput(value: unknown): EmbeddedBrowserSyncAnnotationsInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid browser annotation sync request.')
  }
  const sessionKey = parseOptionalSessionKey((value as { sessionKey?: unknown }).sessionKey)
  const rawComments = (value as { comments?: unknown }).comments
  if (!Array.isArray(rawComments)) {
    throw new Error('Invalid browser annotation sync comments.')
  }
  const comments = rawComments.map((comment) => {
    const parsed = parseBrowserAnnotationCommitted(comment)
    if (!parsed) throw new Error('Invalid browser annotation sync comment.')
    return parsed
  })
  return { sessionKey, comments }
}

function parseSelectAnnotationInput(value: unknown): EmbeddedBrowserSelectAnnotationInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid browser annotation select request.')
  }
  const sessionKey = parseOptionalSessionKey((value as { sessionKey?: unknown }).sessionKey)
  const annotationId =
    typeof (value as { annotationId?: unknown }).annotationId === 'string'
      ? (value as { annotationId: string }).annotationId.trim()
      : ''
  if (!annotationId) {
    throw new Error('Invalid browser annotation select request.')
  }
  return { sessionKey, annotationId }
}

function parseSubmitAnnotationDraftInput(
  value: unknown
): EmbeddedBrowserSubmitAnnotationDraftInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid browser annotation draft submit request.')
  }
  const sessionKey = parseOptionalSessionKey((value as { sessionKey?: unknown }).sessionKey)
  const annotationId =
    typeof (value as { annotationId?: unknown }).annotationId === 'string'
      ? (value as { annotationId: string }).annotationId.trim()
      : ''
  const comment =
    typeof (value as { comment?: unknown }).comment === 'string'
      ? (value as { comment: string }).comment.trim()
      : ''
  if (!annotationId || !comment) {
    throw new Error('Invalid browser annotation draft submit request.')
  }
  return { sessionKey, annotationId, comment }
}

function parseCancelAnnotationDraftInput(
  value: unknown
): EmbeddedBrowserCancelAnnotationDraftInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid browser annotation draft cancel request.')
  }
  const sessionKey = parseOptionalSessionKey((value as { sessionKey?: unknown }).sessionKey)
  const rawAnnotationId = (value as { annotationId?: unknown }).annotationId
  if (rawAnnotationId === undefined || rawAnnotationId === null) {
    return { sessionKey, annotationId: null }
  }
  const annotationId = typeof rawAnnotationId === 'string' ? rawAnnotationId.trim() : ''
  if (!annotationId) {
    throw new Error('Invalid browser annotation draft cancel request.')
  }
  return { sessionKey, annotationId }
}

function parseWebContentsId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Invalid webContentsId.')
  }
  return value
}

function parseAttachWebviewInput(value: unknown): {
  sessionKey: string | null | undefined
  webContentsId: number
} {
  if (!isRecord(value)) {
    throw new Error('Invalid attach-webview params.')
  }
  return {
    sessionKey: parseOptionalSessionKey(value.sessionKey),
    webContentsId: parseWebContentsId(value.webContentsId)
  }
}

function parseDetachWebviewInput(value: unknown): {
  sessionKey: string | null | undefined
  webContentsId: number
} {
  if (!isRecord(value)) {
    throw new Error('Invalid detach-webview params.')
  }
  return {
    sessionKey: parseOptionalSessionKey(value.sessionKey),
    webContentsId: parseWebContentsId(value.webContentsId)
  }
}

function parseUpdateSessionUrlInput(value: unknown): {
  sessionKey: string | null | undefined
  url: string
} {
  if (!isRecord(value)) {
    throw new Error('Invalid update-session-url params.')
  }
  if (typeof value.url !== 'string') {
    throw new Error('Invalid url.')
  }
  return {
    sessionKey: parseOptionalSessionKey(value.sessionKey),
    url: value.url
  }
}

function assertAttachableWebview(event: IpcMainInvokeEvent, wc: WebContents): void {
  const rendererWebContents = getRendererWebContents()
  if (!rendererWebContents || rendererWebContents.isDestroyed()) {
    throw new Error('Renderer is not available.')
  }
  if (event.sender.id !== rendererWebContents.id) {
    throw new Error('Refusing to attach webview from an unknown renderer.')
  }
  if (wc.getType() !== 'webview') {
    throw new Error('Refusing to attach non-webview contents.')
  }
  if (wc.hostWebContents?.id !== event.sender.id) {
    throw new Error('Refusing to attach webview owned by another renderer.')
  }
}

export function setEmbeddedBrowserWebContentsGetter(getter: () => WebContents | null): void {
  getRendererWebContents = getter
}

function attachedEmbeddedWebContents(sessionKey = activeSessionKey): WebContents | null {
  const activeWebContentsId = attachedWebContentsIdsBySessionKey.get(sessionKey) ?? null
  if (activeWebContentsId !== null) {
    const wc = electronWebContents.fromId(activeWebContentsId)
    if (!wc || wc.isDestroyed()) {
      attachedWebContentsIdsBySessionKey.delete(sessionKey)
    } else {
      return wc
    }
  }
  return null
}

function activeEmbeddedWebContents(sessionKey = activeSessionKey): WebContents | null {
  const attachedWebContents = attachedEmbeddedWebContents(sessionKey)
  if (attachedWebContents) {
    return attachedWebContents
  }
  return null
}

function statusForSession(sessionKey: string): EmbeddedBrowserStatus {
  const wc = activeEmbeddedWebContents(sessionKey)
  const activeWebContentsId = attachedWebContentsIdsBySessionKey.get(sessionKey) ?? null
  const lastRequestedUrl = lastRequestedUrlBySessionKey.get(sessionKey) ?? null
  const webContentsUrl = wc?.getURL() || null
  const url =
    webContentsUrl === 'about:blank' && lastRequestedUrl && lastRequestedUrl !== 'about:blank'
      ? lastRequestedUrl
      : (webContentsUrl ?? lastRequestedUrl)
  return {
    open: Boolean(wc || lastRequestedUrl),
    attached: Boolean(wc),
    webContentsId: activeWebContentsId,
    url,
    title: wc?.getTitle() || null,
    loading: loadingBySessionKey.get(sessionKey) ?? wc?.isLoading() ?? false,
    canGoBack: wc?.navigationHistory.canGoBack() ?? false,
    canGoForward: wc?.navigationHistory.canGoForward() ?? false,
    annotationMode: annotationModeBySessionKey.get(sessionKey) ?? 'browse',
    annotationCount: annotationCountBySessionKey.get(sessionKey) ?? 0
  }
}

function normalizeEmbeddedBrowserUrl(value: string): string {
  const url = normalizeWebTargetUrl(value)
  if (!url) {
    throw new Error('URL is required.')
  }
  return url
}

function sendRendererEvent(event: EmbeddedBrowserRendererEvent): void {
  const wc = getRendererWebContents()
  if (!wc || wc.isDestroyed()) {
    throw new Error('Renderer is not available.')
  }
  wc.send(EMBEDDED_BROWSER_EVENT_CHANNEL, event)
}

export function navigateRendererApp(path: string): void {
  const wc = getRendererWebContents()
  if (!wc || wc.isDestroyed()) return
  wc.send('app:navigate', { path })
}

function sendEmbeddedBrowserState(sessionKey = activeSessionKey): void {
  try {
    sendRendererEvent({ type: 'state', sessionKey, status: statusForSession(sessionKey) })
  } catch {
    // State notifications are best-effort during startup and shutdown.
  }
}

function canSendAnnotationCommand(sessionKey: string): boolean {
  const wc = activeEmbeddedWebContents(sessionKey)
  return Boolean(wc && !wc.isDestroyed() && !wc.mainFrame.isDestroyed())
}

function sendAnnotationCommand(sessionKey: string, command: BrowserAnnotationHostCommand): boolean {
  const wc = activeEmbeddedWebContents(sessionKey)
  if (!wc || wc.isDestroyed()) return false
  if (wc.mainFrame.isDestroyed()) return false
  wc.mainFrame.send(BROWSER_ANNOTATION_HOST_COMMAND_CHANNEL, command)
  return true
}

function syncAnnotationComments(sessionKey: string): void {
  sendAnnotationCommand(sessionKey, {
    type: 'sync-comments',
    comments: annotationCommentsBySessionKey.get(sessionKey) ?? []
  })
}

function advanceAnnotationEpoch(sessionKey: string): number {
  const epoch = (annotationEpochBySessionKey.get(sessionKey) ?? 0) + 1
  annotationEpochBySessionKey.set(sessionKey, epoch)
  return epoch
}

function setEmbeddedBrowserAnnotationMode(params: {
  sessionKey?: string | null
  mode: BrowserAnnotationMode
  labels: BrowserAnnotationLabels
}): EmbeddedBrowserStatus {
  const sessionKey = embeddedBrowserSessionKey(params.sessionKey)
  assertKnownSessionKey(params.sessionKey, sessionKey)
  if (params.mode === 'comment' && !canSendAnnotationCommand(sessionKey)) {
    throw new Error('Embedded browser page is not attached. Reopen the Browser tab and retry.')
  }
  advanceAnnotationEpoch(sessionKey)
  annotationModeBySessionKey.set(sessionKey, params.mode)
  annotationLabelsBySessionKey.set(sessionKey, params.labels)
  if (params.mode === 'browse') {
    annotationCountBySessionKey.delete(sessionKey)
    annotationCommentsBySessionKey.delete(sessionKey)
    annotationDraftBySessionKey.delete(sessionKey)
    sendRendererEvent({ type: 'annotation-draft-cleared', sessionKey })
  }
  sendAnnotationCommand(sessionKey, {
    type: 'set-mode',
    mode: params.mode,
    labels: params.labels
  })
  if (params.mode === 'comment') {
    syncAnnotationComments(sessionKey)
  }
  sendEmbeddedBrowserState(sessionKey)
  return statusForSession(sessionKey)
}

function discardEmbeddedBrowserAnnotations(sessionKeyInput?: string | null): EmbeddedBrowserStatus {
  const sessionKey = embeddedBrowserSessionKey(sessionKeyInput)
  assertKnownSessionKey(sessionKeyInput, sessionKey)
  annotationCountBySessionKey.delete(sessionKey)
  annotationCommentsBySessionKey.delete(sessionKey)
  annotationDraftBySessionKey.delete(sessionKey)
  advanceAnnotationEpoch(sessionKey)
  annotationModeBySessionKey.set(sessionKey, 'browse')
  sendAnnotationCommand(sessionKey, { type: 'discard' })
  sendRendererEvent({ type: 'annotation-draft-cleared', sessionKey })
  sendEmbeddedBrowserState(sessionKey)
  return statusForSession(sessionKey)
}

function resetEmbeddedBrowserAnnotationInteraction(sessionKeyInput?: string | null): void {
  const sessionKey = embeddedBrowserSessionKey(sessionKeyInput)
  const hadAnnotationState =
    annotationModeBySessionKey.has(sessionKey) ||
    annotationLabelsBySessionKey.has(sessionKey) ||
    annotationCountBySessionKey.has(sessionKey) ||
    annotationCommentsBySessionKey.has(sessionKey) ||
    annotationDraftBySessionKey.has(sessionKey)
  if (!hadAnnotationState) return

  annotationModeBySessionKey.delete(sessionKey)
  annotationLabelsBySessionKey.delete(sessionKey)
  annotationCountBySessionKey.delete(sessionKey)
  annotationCommentsBySessionKey.delete(sessionKey)
  annotationDraftBySessionKey.delete(sessionKey)
  advanceAnnotationEpoch(sessionKey)
  sendAnnotationCommand(sessionKey, { type: 'discard' })
  sendRendererEvent({ type: 'annotation-draft-cleared', sessionKey })
  sendEmbeddedBrowserState(sessionKey)
}

function syncEmbeddedBrowserAnnotations(
  input: EmbeddedBrowserSyncAnnotationsInput
): EmbeddedBrowserStatus {
  const sessionKey = embeddedBrowserSessionKey(input.sessionKey)
  assertKnownSessionKey(input.sessionKey, sessionKey)
  const comments = [...input.comments].sort(
    (a, b) => a.label - b.label || a.annotationId.localeCompare(b.annotationId)
  )
  annotationCommentsBySessionKey.set(sessionKey, comments)
  annotationCountBySessionKey.set(
    sessionKey,
    comments.reduce((maxLabel, comment) => Math.max(maxLabel, comment.label), 0)
  )
  if (annotationModeBySessionKey.get(sessionKey) === 'comment') {
    syncAnnotationComments(sessionKey)
  }
  sendEmbeddedBrowserState(sessionKey)
  return statusForSession(sessionKey)
}

function selectEmbeddedBrowserAnnotation(
  input: EmbeddedBrowserSelectAnnotationInput
): EmbeddedBrowserStatus {
  const sessionKey = embeddedBrowserSessionKey(input.sessionKey)
  assertKnownSessionKey(input.sessionKey, sessionKey)
  if (annotationModeBySessionKey.get(sessionKey) === 'comment') {
    syncAnnotationComments(sessionKey)
    sendAnnotationCommand(sessionKey, {
      type: 'select',
      annotationId: input.annotationId
    })
  }
  return statusForSession(sessionKey)
}

function webContentsSessionKey(wc: WebContents): string | null {
  return (
    getBrowserManager()?.getSessionKeyForWebContentsId(wc.id) ??
    Array.from(attachedWebContentsIdsBySessionKey.entries()).find(([, id]) => id === wc.id)?.[0] ??
    null
  )
}

async function captureAnnotationScreenshot(
  sessionKey: string,
  annotationViewportRect?: Rectangle,
  viewportSize?: { width: number; height: number },
  markerViewportPoint?: { x: number; y: number }
): Promise<
  | {
      data: ArrayBuffer
      width: number
      height: number
      annotationViewportRect?: Rectangle
      cropViewportRect?: Rectangle
      cropPaddingPx?: number
      markerViewportPoint?: { x: number; y: number }
    }
  | undefined
> {
  const wc = activeEmbeddedWebContents(sessionKey)
  if (!wc || wc.isDestroyed()) return undefined
  try {
    const cropViewportRect = browserAnnotationCompactScreenshotRect(
      annotationViewportRect,
      viewportSize
    )
    const image = await wc.capturePage(cropViewportRect, { stayHidden: true })
    const size = image.getSize()
    const png = image.toPNG()
    const data = new ArrayBuffer(png.byteLength)
    new Uint8Array(data).set(png)
    return {
      data,
      width: size.width,
      height: size.height,
      annotationViewportRect,
      cropViewportRect,
      cropPaddingPx: cropViewportRect ? BROWSER_ANNOTATION_SCREENSHOT_CROP_PADDING_PX : undefined,
      markerViewportPoint
    }
  } catch {
    return undefined
  }
}

async function commitBrowserAnnotationSubmission(
  sessionKey: string,
  submission: BrowserAnnotationSubmission
): Promise<boolean> {
  if (annotationModeBySessionKey.get(sessionKey) !== 'comment') return false

  const epoch = annotationEpochBySessionKey.get(sessionKey) ?? 0
  const pageUrl = submission.anchor.pageUrl
  const screenshot = await captureAnnotationScreenshot(
    sessionKey,
    submission.anchor.viewportRect,
    submission.anchor.viewportSize,
    submission.anchor.viewportPoint
  )
  if (annotationModeBySessionKey.get(sessionKey) !== 'comment') return false
  if ((annotationEpochBySessionKey.get(sessionKey) ?? 0) !== epoch) return false
  const wc = activeEmbeddedWebContents(sessionKey)
  if (!wc || wc.isDestroyed() || !browserAnnotationUrlsMatch(pageUrl, wc.getURL())) return false

  const label = (annotationCountBySessionKey.get(sessionKey) ?? 0) + 1
  annotationCountBySessionKey.set(sessionKey, label)
  const committedAnnotation: BrowserAnnotationCommitted = {
    ...submission,
    label
  }
  annotationCommentsBySessionKey.set(sessionKey, [
    ...(annotationCommentsBySessionKey.get(sessionKey) ?? []).filter(
      (annotation) => annotation.annotationId !== submission.annotationId
    ),
    committedAnnotation
  ])
  annotationDraftBySessionKey.delete(sessionKey)
  sendAnnotationCommand(sessionKey, {
    type: 'commit',
    annotationId: submission.annotationId,
    label,
    comment: submission.comment
  })
  sendRendererEvent({
    type: 'annotation-draft-cleared',
    sessionKey,
    annotationId: submission.annotationId
  })
  sendRendererEvent({
    type: 'annotation-submitted',
    sessionKey,
    annotation: {
      annotationId: submission.annotationId,
      label,
      comment: submission.comment,
      anchor: submission.anchor,
      pastedImages: submission.pastedImages,
      screenshot
    }
  })
  sendEmbeddedBrowserState(sessionKey)
  return true
}

async function submitEmbeddedBrowserAnnotationDraft(
  input: EmbeddedBrowserSubmitAnnotationDraftInput
): Promise<EmbeddedBrowserStatus> {
  const sessionKey = embeddedBrowserSessionKey(input.sessionKey)
  assertKnownSessionKey(input.sessionKey, sessionKey)
  const draft = annotationDraftBySessionKey.get(sessionKey)
  if (!draft || draft.annotationId !== input.annotationId) {
    throw new Error('Browser annotation draft was not found.')
  }

  const submitted = await commitBrowserAnnotationSubmission(sessionKey, {
    annotationId: draft.annotationId,
    comment: input.comment,
    anchor: draft.anchor
  })
  if (!submitted) {
    throw new Error('Browser annotation draft could not be submitted because the page changed.')
  }
  return statusForSession(sessionKey)
}

function cancelEmbeddedBrowserAnnotationDraft(
  input: EmbeddedBrowserCancelAnnotationDraftInput
): EmbeddedBrowserStatus {
  const sessionKey = embeddedBrowserSessionKey(input.sessionKey)
  assertKnownSessionKey(input.sessionKey, sessionKey)
  const draft = annotationDraftBySessionKey.get(sessionKey)
  if (!draft || (input.annotationId && draft.annotationId !== input.annotationId)) {
    return statusForSession(sessionKey)
  }

  annotationDraftBySessionKey.delete(sessionKey)
  sendAnnotationCommand(sessionKey, { type: 'cancel-draft' })
  sendRendererEvent({
    type: 'annotation-draft-cleared',
    sessionKey,
    annotationId: draft.annotationId
  })
  sendEmbeddedBrowserState(sessionKey)
  return statusForSession(sessionKey)
}

async function handleBrowserAnnotationRuntimeEvent(
  sender: WebContents,
  value: unknown
): Promise<void> {
  const sessionKey = webContentsSessionKey(sender)
  if (!sessionKey) return
  if (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type?: unknown }).type === 'ready'
  ) {
    const mode = annotationModeBySessionKey.get(sessionKey)
    const labels = annotationLabelsBySessionKey.get(sessionKey)
    if (mode && labels) {
      sendAnnotationCommand(sessionKey, { type: 'set-mode', mode, labels })
      if (mode === 'comment') {
        syncAnnotationComments(sessionKey)
      }
    }
    return
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type?: unknown }).type === 'exit-comment-mode'
  ) {
    discardEmbeddedBrowserAnnotations(sessionKey)
    return
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type?: unknown }).type === 'draft-created'
  ) {
    if (annotationModeBySessionKey.get(sessionKey) !== 'comment') return
    const draft = parseBrowserAnnotationDraft((value as { annotation?: unknown }).annotation)
    if (!draft) return
    annotationDraftBySessionKey.set(sessionKey, draft)
    sendRendererEvent({ type: 'annotation-draft-created', sessionKey, annotation: draft })
    sendEmbeddedBrowserState(sessionKey)
    return
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type?: unknown }).type === 'cancel-draft'
  ) {
    const draft = annotationDraftBySessionKey.get(sessionKey)
    annotationDraftBySessionKey.delete(sessionKey)
    sendRendererEvent({
      type: 'annotation-draft-cleared',
      sessionKey,
      annotationId: draft?.annotationId
    })
    sendEmbeddedBrowserState(sessionKey)
    return
  }

  const submission =
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type?: unknown }).type === 'submit'
      ? parseBrowserAnnotationSubmission((value as { annotation?: unknown }).annotation)
      : null
  if (!submission) return
  await commitBrowserAnnotationSubmission(sessionKey, submission)
}

function resumeEmbeddedBrowserWebContents(wc: WebContents): void {
  if (wc.isDestroyed()) return
  wc.setAudioMuted(false)
  wc.setBackgroundThrottling(false)
}

function frameChildren(frame: WebFrameMain): WebFrameMain[] {
  const children = (frame as WebFrameMain & { frames?: unknown }).frames
  return Array.isArray(children)
    ? children.filter((child): child is WebFrameMain => typeof child === 'object' && child !== null)
    : []
}

function frameSubtree(frame: WebFrameMain): WebFrameMain[] {
  const framesInSubtree = (frame as WebFrameMain & { framesInSubtree?: unknown }).framesInSubtree
  if (Array.isArray(framesInSubtree)) {
    return framesInSubtree.filter(
      (child): child is WebFrameMain => typeof child === 'object' && child !== null
    )
  }

  return [frame, ...frameChildren(frame).flatMap((child) => frameSubtree(child))]
}

function pauseMediaInFrame(frame: WebFrameMain): void {
  try {
    if (frame.isDestroyed() || frame.detached) return
    void frame.executeJavaScript(SUSPEND_MEDIA_SCRIPT, true).catch(() => {
      // The page may be navigating or already gone while the sidebar is closing.
    })
  } catch {
    // Frame state can change while navigation is replacing the frame tree.
  }
}

function suspendEmbeddedBrowserWebContents(wc: WebContents): void {
  if (wc.isDestroyed()) return
  wc.setAudioMuted(true)
  wc.setBackgroundThrottling(true)
  for (const frame of frameSubtree(wc.mainFrame)) {
    pauseMediaInFrame(frame)
  }
}

export async function runWithEmbeddedBrowserWebContentsResumed<T>(
  sessionKey: string,
  action: () => Promise<T>
): Promise<T> {
  const wc = activeEmbeddedWebContents(sessionKey)
  const shouldRestoreSuspension =
    Boolean(wc && !wc.isDestroyed()) && !getBrowserManager()?.isSessionDisplayed(sessionKey)
  if (wc && shouldRestoreSuspension) {
    resumeEmbeddedBrowserWebContents(wc)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  try {
    return await action()
  } finally {
    if (wc && shouldRestoreSuspension && !wc.isDestroyed()) {
      suspendEmbeddedBrowserWebContents(wc)
    }
  }
}

function makeCommandId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

async function requestEmbeddedBrowserCursorCommand(
  command: Omit<EmbeddedBrowserCursorCommand, 'type' | 'commandId'>
): Promise<void> {
  const commandId = makeCommandId()

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cursorCommandWaiters.delete(commandId)
      reject(new Error('Timed out waiting for embedded browser cursor animation.'))
    }, DEFAULT_CURSOR_COMMAND_TIMEOUT_MS)

    cursorCommandWaiters.set(commandId, { resolve, reject, timer })

    try {
      sendRendererEvent({
        type: 'cursor-command',
        commandId,
        ...command
      })
    } catch (error) {
      clearTimeout(timer)
      cursorCommandWaiters.delete(commandId)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export async function animateEmbeddedBrowserCursorClick(
  sessionKey: string,
  point: EmbeddedBrowserCursorPoint
): Promise<void> {
  await requestEmbeddedBrowserCursorCommand({
    sessionKey,
    action: 'move-click',
    point
  }).catch(() => undefined)
}

export async function animateEmbeddedBrowserCursorMove(
  sessionKey: string,
  point: EmbeddedBrowserCursorPoint
): Promise<void> {
  await requestEmbeddedBrowserCursorCommand({
    sessionKey,
    action: 'move',
    point
  }).catch(() => undefined)
}

export function endEmbeddedBrowserCursorSession(sessionKey: string): void {
  try {
    sendRendererEvent({
      type: 'cursor-command',
      commandId: makeCommandId(),
      sessionKey,
      action: 'hide'
    })
  } catch {
    // Best-effort during shutdown.
  }
}

function completeEmbeddedBrowserCursorCommand(
  completion: EmbeddedBrowserCursorCommandCompletion
): void {
  const waiter = cursorCommandWaiters.get(completion.commandId)
  if (!waiter) return
  clearTimeout(waiter.timer)
  cursorCommandWaiters.delete(completion.commandId)
  if (completion.ok) {
    waiter.resolve()
    return
  }
  waiter.reject(new Error(completion.error || 'Embedded browser cursor animation failed.'))
}

function resolveReadyWaiters(sessionKey: string, webContents: WebContents): void {
  for (const waiter of readyWaiters) {
    if (waiter.sessionKey !== sessionKey) continue
    clearTimeout(waiter.timer)
    waiter.resolve(webContents)
    readyWaiters.delete(waiter)
  }
}

function bindManagedWebContentsStateEvents(sessionKey: string, webContents: WebContents): void {
  if (managedStateEventBindings.has(webContents)) return
  managedStateEventBindings.add(webContents)
  const setLoading = (loading: boolean) => {
    loadingBySessionKey.set(sessionKey, loading)
    sendEmbeddedBrowserState(sessionKey)
  }
  const notify = () => {
    sendEmbeddedBrowserState(sessionKey)
  }
  const handleFrameFinish = (_event: Electron.Event, isMainFrame: boolean) => {
    if (isMainFrame) setLoading(false)
  }
  const handleFail = (
    _event: Electron.Event,
    _errorCode: number,
    _errorDescription: string,
    _validatedURL: string,
    isMainFrame: boolean
  ) => {
    if (isMainFrame) setLoading(false)
  }
  webContents.on('did-start-loading', () => setLoading(true))
  webContents.on('did-stop-loading', () => setLoading(false))
  webContents.on('did-finish-load', () => setLoading(false))
  webContents.on('did-frame-finish-load', handleFrameFinish)
  webContents.on('dom-ready', () => setLoading(false))
  webContents.on('did-navigate', notify)
  webContents.on('did-navigate-in-page', notify)
  webContents.on('page-title-updated', notify)
  webContents.on('did-fail-load', handleFail)
  webContents.once('destroyed', () => {
    loadingBySessionKey.delete(sessionKey)
    notify()
  })
}

function rejectReadyWaiters(error: Error, sessionKey?: string): void {
  for (const waiter of readyWaiters) {
    if (sessionKey && waiter.sessionKey !== sessionKey) continue
    clearTimeout(waiter.timer)
    waiter.reject(error)
    readyWaiters.delete(waiter)
  }
}

function requestSidebarBrowserVisible(sessionKey = activeSessionKey): void {
  const lastRequestedUrl = lastRequestedUrlBySessionKey.get(sessionKey)
  const currentUrl = activeEmbeddedWebContents(sessionKey)?.getURL() || null
  const visibleUrl =
    lastRequestedUrl && lastRequestedUrl !== 'about:blank'
      ? lastRequestedUrl
      : currentUrl && currentUrl !== 'about:blank'
        ? currentUrl
        : lastRequestedUrl
  if (visibleUrl) {
    lastRequestedUrlBySessionKey.set(sessionKey, visibleUrl)
    sendRendererEvent({ type: 'open-url', sessionKey, url: visibleUrl, visible: true })
    return
  }

  lastRequestedUrlBySessionKey.set(sessionKey, 'about:blank')
  sendRendererEvent({ type: 'open-blank', sessionKey })
}

function waitForEmbeddedBrowserDisplayed(sessionKey: string, timeoutMs = 1500): Promise<void> {
  const manager = getBrowserManager()
  if (!manager || manager.isSessionDisplayed(sessionKey)) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (manager.isSessionDisplayed(sessionKey) || Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer)
        resolve()
      }
    }, 50)
  })
}

async function waitForEmbeddedBrowserReady(
  options: { sessionKey?: string; timeoutMs?: number; ensureVisible?: boolean } = {}
): Promise<WebContents> {
  const sessionKey = options.sessionKey ?? activeSessionKey
  const ensureVisible = options.ensureVisible ?? false
  const current = ensureVisible
    ? attachedEmbeddedWebContents(sessionKey)
    : activeEmbeddedWebContents(sessionKey)
  if (current) {
    if (ensureVisible && !getBrowserManager()?.isSessionDisplayed(sessionKey)) {
      requestSidebarBrowserVisible(sessionKey)
      await waitForEmbeddedBrowserDisplayed(sessionKey)
    }
    return current
  }

  if (ensureVisible) {
    requestSidebarBrowserVisible(sessionKey)
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      sessionKey,
      resolve,
      reject,
      timer: setTimeout(() => {
        readyWaiters.delete(waiter)
        reject(new Error('Timed out waiting for the embedded browser to attach.'))
      }, options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
    }
    readyWaiters.add(waiter)
  })
}

function waitForMainFrameReady(
  webContents: WebContents,
  expectedUrl: string,
  timeoutMs = DEFAULT_MAIN_FRAME_READY_TIMEOUT_MS
): Promise<void> {
  if (!webContents.isLoading() && webContents.getURL()) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      webContents.removeListener('did-finish-load', handleFinish)
      webContents.removeListener('did-frame-finish-load', handleFrameFinish)
      webContents.removeListener('did-fail-load', handleFail)
      webContents.removeListener('dom-ready', handleReady)
      webContents.removeListener('destroyed', handleDestroyed)
    }

    const handleDone = () => {
      cleanup()
      resolve()
    }

    const handleReady = () => {
      handleDone()
    }

    const handleFinish = () => {
      handleDone()
    }

    const handleFrameFinish = (_event: Electron.Event, isMainFrame: boolean) => {
      if (isMainFrame) {
        handleDone()
      }
    }

    const handleFail = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean
    ) => {
      if (!isMainFrame || errorDescription === 'ERR_ABORTED') return
      cleanup()
      reject(
        new Error(
          `Embedded browser failed to load ${validatedURL || expectedUrl}: ${errorDescription} (${errorCode}).`
        )
      )
    }

    const handleDestroyed = () => {
      cleanup()
      reject(new Error('Embedded browser webContents was destroyed while loading.'))
    }

    webContents.once('did-finish-load', handleFinish)
    webContents.on('did-frame-finish-load', handleFrameFinish)
    webContents.on('did-fail-load', handleFail)
    webContents.once('dom-ready', handleReady)
    webContents.once('destroyed', handleDestroyed)
  })
}

function isCancelledEmbeddedBrowserNavigation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: unknown; errno?: unknown }).code
  const errno = (error as { code?: unknown; errno?: unknown }).errno

  return (
    message.includes('net::ERR_ABORTED') ||
    message.includes('ERR_ABORTED') ||
    code === 'ERR_ABORTED' ||
    errno === -3 ||
    /(?:^|[^\d])-3(?:[^\d]|$)/.test(message)
  )
}

async function navigateEmbeddedBrowserWebContents(
  sessionKey: string,
  webContents: WebContents,
  url: string
): Promise<void> {
  if (webContents.isDestroyed() || webContents.getURL() === url) return
  loadingBySessionKey.set(sessionKey, true)
  sendEmbeddedBrowserState(sessionKey)
  try {
    await webContents.loadURL(url)
  } catch (error) {
    if (!isCancelledEmbeddedBrowserNavigation(error)) {
      console.warn('[embedded-browser] failed to load URL:', url, error)
    }
    loadingBySessionKey.set(sessionKey, false)
  } finally {
    sendEmbeddedBrowserState(sessionKey)
  }
}

export function getEmbeddedBrowserStatus(): EmbeddedBrowserStatus {
  return statusForSession(activeSessionKey)
}

export function setActiveEmbeddedBrowserSession(sessionKey: string | null): EmbeddedBrowserStatus {
  activeSessionKey = embeddedBrowserSessionKey(sessionKey)
  return getEmbeddedBrowserStatus()
}

function embeddedBrowserSessionKey(sessionKey?: string | null): string {
  return sessionKey || EMBEDDED_BROWSER_DRAFT_SESSION_KEY
}

async function runEmbeddedBrowserOperation<T>(
  action: () => Promise<T>,
  sessionKey = activeSessionKey
): Promise<T> {
  const manager = getBrowserManager()
  if (!manager) {
    return action()
  }
  return manager.enqueueForSession(sessionKey, action)
}

export async function ensureEmbeddedBrowserVisible(
  sessionKey?: string
): Promise<EmbeddedBrowserStatus> {
  const resolvedSessionKey = embeddedBrowserSessionKey(sessionKey ?? activeSessionKey)
  await waitForEmbeddedBrowserReady({ sessionKey: resolvedSessionKey, ensureVisible: true })
  return statusForSession(resolvedSessionKey)
}

async function openEmbeddedBrowserUrlUnsafe(
  value: string,
  options: EmbeddedBrowserOpenOptions = {}
): Promise<EmbeddedBrowserStatus> {
  const sessionKey = embeddedBrowserSessionKey(options.sessionKey)
  const url = normalizeEmbeddedBrowserUrl(value)
  const visible = options.visible ?? true
  lastRequestedUrlBySessionKey.set(sessionKey, url)
  sendRendererEvent({ type: 'open-url', sessionKey, url, visible })
  const wc = await waitForEmbeddedBrowserReady({ sessionKey, ensureVisible: visible })
  resetEmbeddedBrowserAnnotationInteraction(sessionKey)
  const navigation = navigateEmbeddedBrowserWebContents(sessionKey, wc, url)
  if (options.waitUntilLoaded ?? true) {
    await navigation
    if (!wc.isDestroyed() && wc.isLoading()) {
      await waitForMainFrameReady(wc, url).catch((error) => {
        if (!isCancelledEmbeddedBrowserNavigation(error)) {
          console.warn('[embedded-browser] timed out or failed while waiting for load:', url, error)
        }
      })
    }
  } else {
    void navigation
  }
  return statusForSession(sessionKey)
}

export function openEmbeddedBrowserUrl(
  value: string,
  options: EmbeddedBrowserOpenOptions = {}
): Promise<EmbeddedBrowserStatus> {
  const sessionKey = embeddedBrowserSessionKey(options.sessionKey ?? activeSessionKey)
  return runEmbeddedBrowserOperation(
    () => openEmbeddedBrowserUrlUnsafe(value, { ...options, sessionKey }),
    sessionKey
  )
}

export function setEmbeddedBrowserViewBounds(
  params: EmbeddedBrowserViewBoundsInput
): EmbeddedBrowserStatus {
  const sessionKey = params.sessionKey || EMBEDDED_BROWSER_DRAFT_SESSION_KEY
  const bounds =
    params.visible && params.width >= 1 && params.height >= 1
      ? {
          x: Math.round(params.x),
          y: Math.round(params.y),
          width: Math.round(params.width),
          height: Math.round(params.height)
        }
      : null

  getBrowserManager()?.setSessionBounds(sessionKey, bounds)

  const wc = activeEmbeddedWebContents(sessionKey)
  if (wc) {
    if (bounds) {
      resumeEmbeddedBrowserWebContents(wc)
    } else {
      suspendEmbeddedBrowserWebContents(wc)
    }
  }

  const status = statusForSession(sessionKey)
  sendEmbeddedBrowserState(sessionKey)
  return status
}

function navigateManagedBrowser(
  sessionKey: string,
  action: (webContents: WebContents) => 'loading' | 'stopped' | undefined
): EmbeddedBrowserStatus {
  const wc =
    getBrowserManager()?.getSession(sessionKey)?.webContents ??
    activeEmbeddedWebContents(sessionKey)
  if (!wc) {
    throw new Error('Embedded browser is not available.')
  }
  const result = action(wc)
  if (result === 'loading') {
    loadingBySessionKey.set(sessionKey, true)
  } else if (result === 'stopped') {
    loadingBySessionKey.set(sessionKey, false)
  }
  const status = statusForSession(sessionKey)
  sendEmbeddedBrowserState(sessionKey)
  return status
}

function openEmbeddedBrowserDevTools(sessionKey: string): EmbeddedBrowserStatus {
  return navigateManagedBrowser(sessionKey, (wc) => {
    wc.openDevTools({ mode: 'detach' })
    return undefined
  })
}

async function executeEmbeddedBrowserScriptUnsafe<T = unknown>(code: string): Promise<T> {
  const wc = await waitForEmbeddedBrowserReady({ ensureVisible: true })
  return (await wc.executeJavaScript(code, true)) as T
}

export function executeEmbeddedBrowserScript<T = unknown>(code: string): Promise<T> {
  return runEmbeddedBrowserOperation(() => executeEmbeddedBrowserScriptUnsafe<T>(code))
}

export async function captureEmbeddedBrowserSnapshot(
  maxTextLength = 12_000
): Promise<EmbeddedBrowserSnapshot> {
  return runEmbeddedBrowserOperation(() =>
    executeEmbeddedBrowserScriptUnsafe<EmbeddedBrowserSnapshot>(`
    (() => {
      const maxTextLength = ${JSON.stringify(maxTextLength)}
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim()
      const escapeCss = (value) => {
        if (window.CSS && CSS.escape) return CSS.escape(value)
        return String(value).replace(/["\\\\]/g, '\\\\$&')
      }
      const selectorFor = (element) => {
        if (element.id) return '#' + escapeCss(element.id)
        const attrs = ['aria-label', 'name', 'placeholder', 'type']
        for (const attr of attrs) {
          const value = element.getAttribute(attr)
          if (value) return element.tagName.toLowerCase() + '[' + attr + '="' + escapeCss(value) + '"]'
        }
        const parts = []
        let current = element
        while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
          let part = current.tagName.toLowerCase()
          const parent = current.parentElement
          if (parent) {
            const sameTag = Array.from(parent.children).filter((child) => child.tagName === current.tagName)
            if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(current) + 1) + ')'
          }
          parts.unshift(part)
          current = parent
        }
        return parts.join(' > ')
      }
      const visible = (element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      }
      const elements = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]'))
        .filter(visible)
        .slice(0, 100)
        .map((element, index) => ({
          index,
          tagName: element.tagName.toLowerCase(),
          role: element.getAttribute('role'),
          type: element.getAttribute('type'),
          text: clean(element.innerText || element.textContent || element.getAttribute('aria-label') || element.getAttribute('value')).slice(0, 180),
          selector: selectorFor(element),
          href: element.href || null,
          value: 'value' in element ? clean(element.value).slice(0, 180) : null,
          placeholder: element.getAttribute('placeholder'),
          name: element.getAttribute('name')
        }))
      return {
        url: location.href,
        title: document.title,
        text: clean(document.body?.innerText).slice(0, maxTextLength),
        elements
      }
    })()
  `)
  )
}

export async function clickEmbeddedBrowser(params: {
  selector?: string
  text?: string
}): Promise<unknown> {
  return runEmbeddedBrowserOperation(async () => {
    const target = await executeEmbeddedBrowserScriptUnsafe<{
      x: number
      y: number
      tagName: string
      text: string
    }>(`
    (() => {
      const params = ${JSON.stringify(params)}
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim()
      const visible = (element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      }
      let element = params.selector ? document.querySelector(params.selector) : null
      if (!element && params.text) {
        const needle = clean(params.text).toLowerCase()
        element = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]'))
          .filter(visible)
          .find((candidate) => clean(candidate.innerText || candidate.textContent || candidate.getAttribute('aria-label') || candidate.getAttribute('value')).toLowerCase().includes(needle))
      }
      if (!element) throw new Error('No matching element found.')
      element.scrollIntoView({ block: 'center', inline: 'center' })
      element.focus?.()
      const rect = element.getBoundingClientRect()
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        tagName: element.tagName.toLowerCase(),
        text: clean(element.innerText || element.textContent || element.getAttribute('aria-label'))
      }
    })()
  `)

    await requestEmbeddedBrowserCursorCommand({
      sessionKey: activeSessionKey,
      action: 'move-click',
      point: { x: target.x, y: target.y }
    })

    return executeEmbeddedBrowserScriptUnsafe(`
    (() => {
      const params = ${JSON.stringify(params)}
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim()
      const visible = (element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      }
      let element = params.selector ? document.querySelector(params.selector) : null
      if (!element && params.text) {
        const needle = clean(params.text).toLowerCase()
        element = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]'))
          .filter(visible)
          .find((candidate) => clean(candidate.innerText || candidate.textContent || candidate.getAttribute('aria-label') || candidate.getAttribute('value')).toLowerCase().includes(needle))
      }
      if (!element) throw new Error('No matching element found.')
      element.scrollIntoView({ block: 'center', inline: 'center' })
      element.focus?.()
      element.click()
      return {
        clicked: true,
        tagName: element.tagName.toLowerCase(),
        text: clean(element.innerText || element.textContent || element.getAttribute('aria-label')),
        cursor: ${JSON.stringify(target)}
      }
    })()
  `)
  })
}

export async function fillEmbeddedBrowser(params: {
  selector?: string
  text?: string
  label?: string
  placeholder?: string
  name?: string
  value: string
  clear?: boolean
  submit?: boolean
}): Promise<unknown> {
  return runEmbeddedBrowserOperation(() =>
    executeEmbeddedBrowserScriptUnsafe(`
    (() => {
      const params = ${JSON.stringify(params)}
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim()
      const byLabel = (text) => {
        const needle = clean(text).toLowerCase()
        const label = Array.from(document.querySelectorAll('label')).find((item) => clean(item.innerText || item.textContent).toLowerCase().includes(needle))
        if (!label) return null
        if (label.htmlFor) return document.getElementById(label.htmlFor)
        return label.querySelector('input,textarea,[contenteditable="true"]')
      }
      let element = params.selector ? document.querySelector(params.selector) : null
      if (!element && params.label) element = byLabel(params.label)
      if (!element && params.placeholder) element = document.querySelector('input[placeholder*="' + CSS.escape(params.placeholder) + '"],textarea[placeholder*="' + CSS.escape(params.placeholder) + '"]')
      if (!element && params.name) element = document.querySelector('[name="' + CSS.escape(params.name) + '"]')
      if (!element && params.text) {
        const needle = clean(params.text).toLowerCase()
        element = Array.from(document.querySelectorAll('input,textarea,[contenteditable="true"]'))
          .find((candidate) => clean(candidate.getAttribute('aria-label') || candidate.getAttribute('placeholder') || candidate.getAttribute('name')).toLowerCase().includes(needle))
      }
      if (!element) throw new Error('No matching editable element found.')
      element.scrollIntoView({ block: 'center', inline: 'center' })
      element.focus?.()
      if (element.isContentEditable) {
        element.textContent = params.value
      } else if ('value' in element) {
        element.value = params.clear === false ? String(element.value ?? '') + params.value : params.value
      } else {
        throw new Error('Matched element is not editable.')
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: params.value }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      if (params.submit) {
        const form = element.closest('form')
        if (form) form.requestSubmit()
      }
      return { filled: true, tagName: element.tagName.toLowerCase(), valueLength: params.value.length }
    })()
  `)
  )
}

export async function typeEmbeddedBrowser(params: {
  selector?: string
  text: string
}): Promise<unknown> {
  return runEmbeddedBrowserOperation(() =>
    executeEmbeddedBrowserScriptUnsafe(`
    (() => {
      const params = ${JSON.stringify(params)}
      const element = params.selector ? document.querySelector(params.selector) : document.activeElement
      if (!element) throw new Error('No target element is focused or matched.')
      element.scrollIntoView?.({ block: 'center', inline: 'center' })
      element.focus?.()
      if (element.isContentEditable) {
        element.textContent = String(element.textContent ?? '') + params.text
      } else if ('value' in element) {
        element.value = String(element.value ?? '') + params.text
      } else {
        throw new Error('Target element is not editable.')
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: params.text }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return { typed: true, tagName: element.tagName.toLowerCase(), textLength: params.text.length }
    })()
  `)
  )
}

export async function pressEmbeddedBrowser(params: {
  key: string
  selector?: string
}): Promise<unknown> {
  return runEmbeddedBrowserOperation(() =>
    executeEmbeddedBrowserScriptUnsafe(`
    (() => {
      const params = ${JSON.stringify(params)}
      const element = params.selector ? document.querySelector(params.selector) : document.activeElement
      if (!element) throw new Error('No target element is focused or matched.')
      element.focus?.()
      const key = params.key
      const eventInit = { key, code: key, bubbles: true, cancelable: true }
      element.dispatchEvent(new KeyboardEvent('keydown', eventInit))
      if (key === 'Enter') {
        const form = element.closest?.('form')
        if (form) form.requestSubmit()
      } else if (key === 'Backspace' && 'value' in element) {
        element.value = String(element.value ?? '').slice(0, -1)
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
      }
      element.dispatchEvent(new KeyboardEvent('keyup', eventInit))
      return { pressed: true, key }
    })()
  `)
  )
}

export async function scrollEmbeddedBrowser(params: {
  x?: number
  y?: number
  times?: number
  stepPx?: number
  delayMs?: number
}): Promise<unknown> {
  return runEmbeddedBrowserOperation(() =>
    executeEmbeddedBrowserScriptUnsafe(`
    (async () => {
      const params = ${JSON.stringify(params)}
      const times = Math.max(1, Number(params.times ?? 1))
      const stepX = Number(params.x ?? 0)
      const stepY = Number(params.y ?? params.stepPx ?? 600)
      const delayMs = Math.max(0, Number(params.delayMs ?? 50))
      for (let i = 0; i < times; i += 1) {
        window.scrollBy({ left: stepX, top: stepY, behavior: 'instant' })
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
      return { scrolled: true, x: window.scrollX, y: window.scrollY }
    })()
  `)
  )
}

export async function waitEmbeddedBrowser(params: {
  ms?: number
  selector?: string
  text?: string
  timeoutMs?: number
}): Promise<unknown> {
  return runEmbeddedBrowserOperation(() =>
    executeEmbeddedBrowserScriptUnsafe(`
    (async () => {
      const params = ${JSON.stringify(params)}
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim()
      if (params.ms) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(params.ms))))
        return { waited: true, reason: 'timer' }
      }
      const deadline = Date.now() + Math.max(1, Number(params.timeoutMs ?? 5000))
      while (Date.now() <= deadline) {
        if (params.selector && document.querySelector(params.selector)) return { waited: true, reason: 'selector' }
        if (params.text && clean(document.body?.innerText).toLowerCase().includes(clean(params.text).toLowerCase())) return { waited: true, reason: 'text' }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('Timed out waiting for embedded browser condition.')
    })()
  `)
  )
}

export function registerEmbeddedBrowserIpc(): void {
  ipcMain.handle('embedded-browser:set-active-session', (_event, sessionKey: unknown) => {
    return setActiveEmbeddedBrowserSession(parseOptionalSessionKey(sessionKey) ?? null)
  })

  ipcMain.handle('embedded-browser:attach-webview', (event, params: unknown) => {
    const input = parseAttachWebviewInput(params)
    const sessionKey = embeddedBrowserSessionKey(input.sessionKey)
    assertKnownSessionKey(input.sessionKey, sessionKey)
    const webContentsId = input.webContentsId
    const wc = electronWebContents.fromId(webContentsId)
    if (!wc || wc.isDestroyed()) {
      throw new Error(`Embedded browser webContents ${webContentsId} was not found.`)
    }
    assertAttachableWebview(event, wc)
    attachedWebContentsIdsBySessionKey.set(sessionKey, webContentsId)
    getBrowserManager()?.registerSessionWebContents(sessionKey, wc)
    bindManagedWebContentsStateEvents(sessionKey, wc)
    const currentUrl = wc.getURL()
    const lastRequestedUrl = lastRequestedUrlBySessionKey.get(sessionKey)
    if (
      currentUrl &&
      (currentUrl !== 'about:blank' || !lastRequestedUrl || lastRequestedUrl === 'about:blank')
    ) {
      lastRequestedUrlBySessionKey.set(sessionKey, currentUrl)
    }
    resolveReadyWaiters(sessionKey, wc)
    wc.once('destroyed', () => {
      if (attachedWebContentsIdsBySessionKey.get(sessionKey) === webContentsId) {
        loadingBySessionKey.delete(sessionKey)
        attachedWebContentsIdsBySessionKey.delete(sessionKey)
        getBrowserManager()?.detachSessionWebContents(sessionKey, webContentsId)
        rejectReadyWaiters(new Error('Embedded browser webContents was destroyed.'), sessionKey)
      }
    })
    return getEmbeddedBrowserStatus()
  })

  ipcMain.handle('embedded-browser:detach-webview', (_event, params: unknown) => {
    const input = parseDetachWebviewInput(params)
    const sessionKey = embeddedBrowserSessionKey(input.sessionKey)
    if (attachedWebContentsIdsBySessionKey.get(sessionKey) === input.webContentsId) {
      endEmbeddedBrowserCursorSession(sessionKey)
      loadingBySessionKey.delete(sessionKey)
      attachedWebContentsIdsBySessionKey.delete(sessionKey)
      getBrowserManager()?.detachSessionWebContents(sessionKey, input.webContentsId)
    }
    return getEmbeddedBrowserStatus()
  })

  ipcMain.handle('embedded-browser:update-session-url', (_event, params: unknown) => {
    const input = parseUpdateSessionUrlInput(params)
    const sessionKey = embeddedBrowserSessionKey(input.sessionKey)
    const url = normalizeEmbeddedBrowserUrl(input.url)
    lastRequestedUrlBySessionKey.set(sessionKey, url)
    return getEmbeddedBrowserStatus()
  })

  ipcMain.handle(
    'embedded-browser:cursor-command-complete',
    (_event, completion: EmbeddedBrowserCursorCommandCompletion) => {
      completeEmbeddedBrowserCursorCommand(completion)
      return { ok: true }
    }
  )

  ipcMain.handle('embedded-browser:status', () => getEmbeddedBrowserStatus())
  ipcMain.handle(
    'embedded-browser:set-view-bounds',
    (_event, params: EmbeddedBrowserViewBoundsInput) => setEmbeddedBrowserViewBounds(params)
  )
  ipcMain.handle('embedded-browser:set-annotation-mode', (_event, params: unknown) => {
    return setEmbeddedBrowserAnnotationMode(parseAnnotationModeInput(params))
  })
  ipcMain.handle('embedded-browser:sync-annotations', (_event, params: unknown) => {
    return syncEmbeddedBrowserAnnotations(parseSyncAnnotationsInput(params))
  })
  ipcMain.handle('embedded-browser:select-annotation', (_event, params: unknown) => {
    return selectEmbeddedBrowserAnnotation(parseSelectAnnotationInput(params))
  })
  ipcMain.handle('embedded-browser:submit-annotation-draft', (_event, params: unknown) => {
    return submitEmbeddedBrowserAnnotationDraft(parseSubmitAnnotationDraftInput(params))
  })
  ipcMain.handle('embedded-browser:cancel-annotation-draft', (_event, params: unknown) => {
    return cancelEmbeddedBrowserAnnotationDraft(parseCancelAnnotationDraftInput(params))
  })
  ipcMain.handle('embedded-browser:discard-annotations', (_event, sessionKey: unknown) =>
    discardEmbeddedBrowserAnnotations(parseOptionalSessionKey(sessionKey))
  )
  ipcMain.on(BROWSER_ANNOTATION_RUNTIME_EVENT_CHANNEL, (event, value: unknown) => {
    void handleBrowserAnnotationRuntimeEvent(event.sender, value).catch(() => {
      // Runtime annotation events are user interaction hints; failures are reflected by no submit.
    })
  })
  ipcMain.handle(
    'embedded-browser:open',
    (_event, input: string | { sessionKey?: string; url: string }) => {
      if (typeof input === 'string') {
        return openEmbeddedBrowserUrl(input, { visible: true })
      }
      const sessionKey = embeddedBrowserSessionKey(
        parseOptionalSessionKey(input.sessionKey) ?? activeSessionKey
      )
      activeSessionKey = sessionKey
      return openEmbeddedBrowserUrl(input.url, { sessionKey, visible: true })
    }
  )
  ipcMain.handle('embedded-browser:go-back', (_event, sessionKey: string) =>
    navigateManagedBrowser(sessionKey || activeSessionKey, (wc) => {
      resetEmbeddedBrowserAnnotationInteraction(sessionKey || activeSessionKey)
      if (!wc.navigationHistory.canGoBack()) return
      wc.navigationHistory.goBack()
      return 'loading'
    })
  )
  ipcMain.handle('embedded-browser:go-forward', (_event, sessionKey: string) =>
    navigateManagedBrowser(sessionKey || activeSessionKey, (wc) => {
      resetEmbeddedBrowserAnnotationInteraction(sessionKey || activeSessionKey)
      if (!wc.navigationHistory.canGoForward()) return
      wc.navigationHistory.goForward()
      return 'loading'
    })
  )
  ipcMain.handle('embedded-browser:reload', (_event, sessionKey: string) =>
    navigateManagedBrowser(sessionKey || activeSessionKey, (wc) => {
      resetEmbeddedBrowserAnnotationInteraction(sessionKey || activeSessionKey)
      wc.reload()
      return 'loading'
    })
  )
  ipcMain.handle('embedded-browser:stop', (_event, sessionKey: string) =>
    navigateManagedBrowser(sessionKey || activeSessionKey, (wc) => {
      wc.stop()
      return 'stopped'
    })
  )
  ipcMain.handle('embedded-browser:open-devtools', (_event, sessionKey: string) =>
    openEmbeddedBrowserDevTools(sessionKey || activeSessionKey)
  )
}

export function closeEmbeddedBrowser(): void {
  closeEmbeddedBrowserSession(activeSessionKey)
}

export function hideEmbeddedBrowserForRendererReset(): void {
  for (const [sessionKey, webContentsId] of attachedWebContentsIdsBySessionKey) {
    endEmbeddedBrowserCursorSession(sessionKey)
    loadingBySessionKey.delete(sessionKey)
    getBrowserManager()?.detachSessionWebContents(sessionKey, webContentsId)
  }
  attachedWebContentsIdsBySessionKey.clear()
}

export function closeEmbeddedBrowserSession(sessionKey: string): void {
  endEmbeddedBrowserCursorSession(sessionKey)
  lastRequestedUrlBySessionKey.delete(sessionKey)
  loadingBySessionKey.delete(sessionKey)
  attachedWebContentsIdsBySessionKey.delete(sessionKey)
  annotationModeBySessionKey.delete(sessionKey)
  annotationLabelsBySessionKey.delete(sessionKey)
  annotationCountBySessionKey.delete(sessionKey)
  annotationEpochBySessionKey.delete(sessionKey)
  annotationCommentsBySessionKey.delete(sessionKey)
  annotationDraftBySessionKey.delete(sessionKey)
  getBrowserManager()?.destroySession(sessionKey)
  try {
    sendRendererEvent({ type: 'close', sessionKey })
  } catch {
    // Best-effort during shutdown.
  }
}

export function disposeEmbeddedBrowser(): void {
  rejectReadyWaiters(new Error('Embedded browser disposed.'))
  for (const [commandId, waiter] of cursorCommandWaiters) {
    clearTimeout(waiter.timer)
    waiter.reject(new Error('Embedded browser disposed.'))
    cursorCommandWaiters.delete(commandId)
  }
  attachedWebContentsIdsBySessionKey.clear()
  lastRequestedUrlBySessionKey.clear()
  loadingBySessionKey.clear()
  annotationModeBySessionKey.clear()
  annotationLabelsBySessionKey.clear()
  annotationCountBySessionKey.clear()
  annotationEpochBySessionKey.clear()
  annotationCommentsBySessionKey.clear()
  annotationDraftBySessionKey.clear()
}
