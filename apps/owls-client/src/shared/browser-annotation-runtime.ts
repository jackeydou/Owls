import type {
  BrowserAnnotationAnchor,
  BrowserAnnotationCommitted,
  BrowserAnnotationHostCommand,
  BrowserAnnotationLabels,
  BrowserAnnotationPastedImage,
  BrowserAnnotationPoint,
  BrowserAnnotationRect,
  BrowserAnnotationRuntimeEvent
} from './browser-annotation.js'
import { browserAnnotationUrlsMatch } from './browser-annotation.js'

type BrowserAnnotationDraft = {
  annotationId?: string
  comment?: string
  anchor: BrowserAnnotationAnchor
  scrollOffset: BrowserAnnotationPoint
  cleanupPastedImages?: () => void
}

type BrowserAnnotationMarker = {
  id: string
  label: number
  comment: string
  anchor: BrowserAnnotationAnchor
  element: HTMLButtonElement
  scrollOffset: BrowserAnnotationPoint
}

type BrowserAnnotationHitTarget = {
  element: Element
  framePath?: string[]
  frameUrl?: string
}

type BrowserAnnotationPastedImageDraft = BrowserAnnotationPastedImage & {
  id: string
  previewUrl: string
}

type BrowserAnnotationRuntimeState = {
  mode: 'browse' | 'comment'
  labels: BrowserAnnotationLabels
  root: HTMLDivElement | null
  hoverBox: HTMLDivElement | null
  editor: HTMLFormElement | null
  markerPreview: HTMLDivElement | null
  selectedMarkerId: string | null
  draft: BrowserAnnotationDraft | null
  dragStart: BrowserAnnotationPoint | null
  markers: BrowserAnnotationMarker[]
}

export type BrowserAnnotationRuntimeController = {
  handleCommand: (command: BrowserAnnotationHostCommand) => void
  dispose: () => void
}

export type BrowserAnnotationRuntimeOptions = {
  postEvent: (event: BrowserAnnotationRuntimeEvent) => void
}

const DEFAULT_LABELS: BrowserAnnotationLabels = {
  placeholder: 'Add a comment...',
  add: 'Add',
  cancel: 'Cancel',
  hint: ''
}

function clean(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanMultiline(value: unknown): string {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function resetRuntimeElementStyle(element: HTMLElement): void {
  element.style.setProperty('all', 'initial')
  element.style.boxSizing = 'border-box'
  element.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
}

function createRuntimeIcon(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.display = 'block'
  svg.style.width = '18px'
  svg.style.height = '18px'
  const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  pathElement.setAttribute('d', path)
  svg.appendChild(pathElement)
  return svg
}

function viewportSize(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

function pointFromEvent(
  event: MouseEvent | PointerEvent,
  sourceWindow: Window = window
): BrowserAnnotationPoint {
  return pointFromWindow(sourceWindow, { x: event.clientX, y: event.clientY })
}

function currentScrollOffset(): BrowserAnnotationPoint {
  return { x: window.scrollX, y: window.scrollY }
}

function rectFromNumbers(rect: BrowserAnnotationRect): BrowserAnnotationRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
}

function rectsIntersect(a: BrowserAnnotationRect, b: DOMRect): boolean {
  return a.x < b.right && a.x + a.width > b.left && a.y < b.bottom && a.y + a.height > b.top
}

function selectorStringValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function selectorFor(element: Element): string | undefined {
  if (element.id) return `#${CSS.escape(element.id)}`
  const attrs = ['data-testid', 'aria-label', 'name', 'placeholder']
  for (const attr of attrs) {
    const value = element.getAttribute(attr)
    if (value) {
      return `${element.tagName.toLowerCase()}[${attr}=${selectorStringValue(value)}]`
    }
  }

  const parts: string[] = []
  let current: Element | null = element
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    let part = current.tagName.toLowerCase()
    const parent = current.parentElement
    if (parent) {
      const siblings = Array.from<Element>(parent.children).filter(
        (child) => child.tagName === current?.tagName
      )
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
    }
    parts.unshift(part)
    current = parent
  }
  return parts.join(' > ')
}

function targetPathFor(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
    parts.unshift(current.tagName.toLowerCase())
    current = current.parentElement
  }
  return parts.join(' > ')
}

function isFrameElement(element: Element | null | undefined): element is HTMLIFrameElement {
  return Boolean(
    element &&
      element.tagName.toLowerCase() === 'iframe' &&
      'contentWindow' in element &&
      'contentDocument' in element
  )
}

function frameWindowFor(element: HTMLIFrameElement): Window | null {
  try {
    return element.contentWindow
  } catch {
    return null
  }
}

function frameDocumentFor(element: HTMLIFrameElement): Document | null {
  try {
    return element.contentDocument
  } catch {
    return null
  }
}

function ownerWindowFor(element: Element): Window {
  return element.ownerDocument.defaultView ?? window
}

function frameOffsetFor(targetWindow: Window): BrowserAnnotationPoint {
  if (targetWindow === window) return { x: 0, y: 0 }
  const frameElement = targetWindow.frameElement
  if (!isFrameElement(frameElement)) return { x: 0, y: 0 }
  const parentWindow = frameElement.ownerDocument.defaultView ?? window
  const parentOffset = frameOffsetFor(parentWindow)
  const rect = frameElement.getBoundingClientRect()
  return {
    x: parentOffset.x + rect.left,
    y: parentOffset.y + rect.top
  }
}

function pointFromWindow(
  targetWindow: Window,
  point: BrowserAnnotationPoint
): BrowserAnnotationPoint {
  const offset = frameOffsetFor(targetWindow)
  return { x: point.x + offset.x, y: point.y + offset.y }
}

function viewportRectForElement(element: Element): BrowserAnnotationRect | null {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const offset = frameOffsetFor(ownerWindowFor(element))
  return rectFromNumbers({
    x: rect.left + offset.x,
    y: rect.top + offset.y,
    width: rect.width,
    height: rect.height
  })
}

function elementFromPointInDocument(
  targetDocument: Document,
  point: BrowserAnnotationPoint
): Element | null {
  let target = targetDocument.elementFromPoint(point.x, point.y)
  while (target?.shadowRoot) {
    const shadowTarget = target.shadowRoot.elementFromPoint(point.x, point.y)
    if (!(shadowTarget instanceof Element) || shadowTarget === target) break
    target = shadowTarget
  }
  return target
}

function frameUrlFor(targetWindow: Window, frameElement: HTMLIFrameElement): string | undefined {
  try {
    return targetWindow.location.href
  } catch {
    return frameElement.src || undefined
  }
}

function hitTargetAtPoint(
  point: BrowserAnnotationPoint,
  targetDocument: Document = document,
  framePath: string[] = []
): BrowserAnnotationHitTarget | null {
  const target = elementFromPointInDocument(targetDocument, point)
  if (!target) return null
  if (isFrameElement(target)) {
    const frameWindow = frameWindowFor(target)
    const frameDocument = frameDocumentFor(target)
    const frameSelector = selectorFor(target)
    if (frameWindow && frameDocument && frameSelector) {
      const rect = target.getBoundingClientRect()
      const nested = hitTargetAtPoint(
        { x: point.x - rect.left, y: point.y - rect.top },
        frameDocument,
        [...framePath, frameSelector]
      )
      if (nested) {
        return {
          ...nested,
          frameUrl: nested.frameUrl ?? frameUrlFor(frameWindow, target)
        }
      }
    }
  }
  const targetWindow = target.ownerDocument.defaultView
  const frameElement = targetWindow?.frameElement
  return {
    element: target,
    ...(framePath.length > 0 ? { framePath } : {}),
    ...(targetWindow && targetWindow !== window && isFrameElement(frameElement)
      ? { frameUrl: frameUrlFor(targetWindow, frameElement) }
      : {})
  }
}

function documentForFramePath(framePath?: string[]): Document | null {
  let currentDocument: Document | null = document
  for (const frameSelector of framePath ?? []) {
    let frame: Element | null = null
    try {
      frame = currentDocument.querySelector(frameSelector)
    } catch {
      return null
    }
    if (!isFrameElement(frame)) return null
    currentDocument = frameDocumentFor(frame)
    if (!currentDocument) return null
  }
  return currentDocument
}

function elementText(element: Element): string {
  return clean(
    element.textContent ||
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.getAttribute('name')
  )
}

function nearbyTextFor(element: Element): string {
  const candidates = [
    element,
    element.closest('section,article,main,form,li,tr,div'),
    document.body
  ]
  for (const candidate of candidates) {
    const text = clean(candidate?.textContent)
    if (text) return text.slice(0, 800)
  }
  return ''
}

function visibleTextNodeFilter(node: Node): number {
  const text = clean(node.textContent)
  if (!text) return NodeFilter.FILTER_REJECT
  const parent = node.parentElement
  if (!parent || parent.closest('script,style,noscript,textarea,input,select')) {
    return NodeFilter.FILTER_REJECT
  }
  const style = ownerWindowFor(parent).getComputedStyle(parent)
  if (style.display === 'none' || style.visibility === 'hidden') {
    return NodeFilter.FILTER_REJECT
  }
  return NodeFilter.FILTER_ACCEPT
}

function textInRegion(rect: BrowserAnnotationRect, targetDocument: Document = document): string {
  if (!targetDocument.body) return ''
  const chunks: string[] = []
  const walker = targetDocument.createTreeWalker(targetDocument.body, NodeFilter.SHOW_TEXT, {
    acceptNode: visibleTextNodeFilter
  })
  while (chunks.join(' ').length < 700) {
    const node = walker.nextNode()
    if (!node) break
    const range = document.createRange()
    range.selectNodeContents(node)
    const intersects = Array.from(range.getClientRects()).some((lineRect) =>
      rectsIntersect(rect, lineRect)
    )
    range.detach()
    if (intersects) {
      chunks.push(clean(node.textContent))
    }
  }
  return clean(chunks.join(' ')).slice(0, 500)
}

function googleDocsContext(targetDocument: Document): string | null {
  let url: URL
  try {
    url = new URL(location.href)
  } catch {
    return null
  }
  if (url.hostname !== 'docs.google.com') return null
  const segments = url.pathname.split('/').filter(Boolean)
  const documentIndex = segments.indexOf('document')
  const idIndex = documentIndex === -1 ? -1 : segments.indexOf('d', documentIndex + 1)
  const documentId = idIndex === -1 ? undefined : segments[idIndex + 1]
  if (!documentId) return null

  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  const tabId = clean(url.searchParams.get('tab') ?? hashParams.get('tab') ?? '')
  const selectedText = clean(targetDocument.getSelection?.()?.toString() ?? '').slice(0, 1000)
  const visibleText = clean(
    (targetDocument.body?.innerText ?? targetDocument.body?.textContent ?? '').slice(0, 2000)
  ).slice(0, 1200)
  return [
    `Google Docs documentId=${documentId}`,
    tabId ? `tab=${tabId}` : '',
    document.title ? `title=${document.title}` : '',
    selectedText ? `selectedText=${selectedText}` : '',
    visibleText ? `visibleText=${visibleText}` : ''
  ]
    .filter(Boolean)
    .join(' | ')
}

function documentContext(targetDocument: Document = document): string {
  const docsContext = googleDocsContext(targetDocument)
  if (docsContext) return docsContext
  return clean((targetDocument.body?.textContent ?? '').slice(0, 2000)).slice(0, 1200)
}

function isFixedPositioned(element: Element): boolean {
  const targetWindow = ownerWindowFor(element)
  let current: Element | null = element
  while (current && current !== current.ownerDocument.body) {
    const position = targetWindow.getComputedStyle(current).position
    if (position === 'fixed' || position === 'sticky') return true
    current = current.parentElement
  }
  return false
}

function scrollContainersFor(element: Element): BrowserAnnotationAnchor['scrollContainers'] {
  const containers: NonNullable<BrowserAnnotationAnchor['scrollContainers']> = []
  const targetWindow = ownerWindowFor(element)
  let current = element.parentElement
  while (current && current !== current.ownerDocument.body && containers.length < 4) {
    const style = targetWindow.getComputedStyle(current)
    const scrollsY =
      current.scrollHeight > current.clientHeight &&
      ['auto', 'scroll', 'overlay'].includes(style.overflowY)
    const scrollsX =
      current.scrollWidth > current.clientWidth &&
      ['auto', 'scroll', 'overlay'].includes(style.overflowX)
    if (scrollsX || scrollsY) {
      const selector = selectorFor(current)
      if (selector) {
        containers.push({
          selector,
          scrollLeft: current.scrollLeft,
          scrollTop: current.scrollTop
        })
      }
    }
    current = current.parentElement
  }
  return containers.length > 0 ? containers : undefined
}

function anchorForElement(
  hitTarget: BrowserAnnotationHitTarget,
  point: BrowserAnnotationPoint
): BrowserAnnotationAnchor {
  const element = hitTarget.element
  const rect = viewportRectForElement(element) ?? { x: point.x, y: point.y, width: 1, height: 1 }
  const text = elementText(element)
  return {
    kind: 'element',
    pageUrl: location.href,
    title: document.title || undefined,
    framePath: hitTarget.framePath,
    frameUrl: hitTarget.frameUrl,
    selector: selectorFor(element),
    targetPath: targetPathFor(element),
    targetRole: element.getAttribute('role') || undefined,
    targetName: element.getAttribute('aria-label') || element.getAttribute('name') || undefined,
    targetDescription: text.slice(0, 160) || element.tagName.toLowerCase(),
    targetImmediateText: text.slice(0, 500) || undefined,
    nearbyText: nearbyTextFor(element),
    documentContext: documentContext(element.ownerDocument),
    isFixed: isFixedPositioned(element) || undefined,
    scrollContainers: scrollContainersFor(element),
    viewportPoint: point,
    viewportRect: rect,
    viewportSize: viewportSize()
  }
}

function anchorForRegion(
  rect: BrowserAnnotationRect,
  point: BrowserAnnotationPoint
): BrowserAnnotationAnchor {
  const hitTarget = hitTargetAtPoint(point)
  const targetWindow = hitTarget?.element.ownerDocument.defaultView ?? window
  const frameOffset = frameOffsetFor(targetWindow)
  const localRect = {
    x: rect.x - frameOffset.x,
    y: rect.y - frameOffset.y,
    width: rect.width,
    height: rect.height
  }
  const targetDocument = hitTarget?.element.ownerDocument ?? document
  const selectedText = textInRegion(localRect, targetDocument)
  const pointText = clean(hitTarget?.element.textContent).slice(0, 500)
  return {
    kind: 'region',
    pageUrl: location.href,
    title: document.title || undefined,
    framePath: hitTarget?.framePath,
    frameUrl: hitTarget?.frameUrl,
    targetDescription: selectedText
      ? `Selected text: ${selectedText.slice(0, 140)}`
      : 'Selected page region',
    targetImmediateText: selectedText || undefined,
    nearbyText: selectedText || pointText,
    documentContext: documentContext(targetDocument),
    viewportPoint: point,
    viewportRect: rect,
    viewportSize: viewportSize()
  }
}

function anchorPointRatio(anchor: BrowserAnnotationAnchor): BrowserAnnotationPoint {
  const rect = anchor.viewportRect
  if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0.5, y: 0.5 }
  return {
    x: clamp((anchor.viewportPoint.x - rect.x) / rect.width, 0, 1),
    y: clamp((anchor.viewportPoint.y - rect.y) / rect.height, 0, 1)
  }
}

function fallbackMarkerPoint(
  anchor: BrowserAnnotationAnchor,
  scrollOffset: BrowserAnnotationPoint
): BrowserAnnotationPoint {
  return {
    x: anchor.viewportPoint.x + (anchor.isFixed ? 0 : scrollOffset.x - window.scrollX),
    y: anchor.viewportPoint.y + (anchor.isFixed ? 0 : scrollOffset.y - window.scrollY)
  }
}

function anchorElementName(element: Element): string | undefined {
  return element.getAttribute('aria-label') || element.getAttribute('name') || elementText(element)
}

function scoreAnchorElement(element: Element, anchor: BrowserAnnotationAnchor): number {
  let score = 0
  const name = anchorElementName(element)
  if (anchor.targetName && name === anchor.targetName) score += 1000
  if (anchor.nearbyText && nearbyTextFor(element) === anchor.nearbyText) score += 500
  if (anchor.targetPath && targetPathFor(element) === anchor.targetPath) score += 250
  const rect = viewportRectForElement(element)
  if (rect && anchor.viewportRect) {
    score -= Math.abs(rect.x - anchor.viewportRect.x)
    score -= Math.abs(rect.y - anchor.viewportRect.y)
  }
  return score
}

function findAnchorElement(anchor: BrowserAnnotationAnchor): Element | null {
  if (anchor.kind !== 'element' || !anchor.selector) return null
  const targetDocument = documentForFramePath(anchor.framePath)
  if (!targetDocument) return null
  let candidates: Element[]
  try {
    candidates = Array.from(targetDocument.querySelectorAll(anchor.selector))
  } catch {
    return null
  }
  const visibleCandidates = candidates.filter((candidate) => viewportRectForElement(candidate))
  if (visibleCandidates.length === 0) return null
  if (visibleCandidates.length === 1) return visibleCandidates[0] ?? null
  return visibleCandidates.reduce<Element | null>((best, candidate) => {
    if (!best) return candidate
    return scoreAnchorElement(candidate, anchor) > scoreAnchorElement(best, anchor)
      ? candidate
      : best
  }, null)
}

function markerPointFor(
  anchor: BrowserAnnotationAnchor,
  scrollOffset: BrowserAnnotationPoint
): BrowserAnnotationPoint {
  const target = findAnchorElement(anchor)
  if (target) {
    const rect = viewportRectForElement(target)
    if (rect) {
      const ratio = anchorPointRatio(anchor)
      return {
        x: rect.x + rect.width * ratio.x,
        y: rect.y + rect.height * ratio.y
      }
    }
  }
  return fallbackMarkerPoint(anchor, scrollOffset)
}

function rectForAnchor(
  anchor: BrowserAnnotationAnchor,
  scrollOffset: BrowserAnnotationPoint
): BrowserAnnotationRect | null {
  const target = findAnchorElement(anchor)
  const targetRect = target ? viewportRectForElement(target) : null
  if (targetRect) return targetRect

  if (!anchor.viewportRect) return null
  return {
    x: Math.round(anchor.viewportRect.x + (anchor.isFixed ? 0 : scrollOffset.x - window.scrollX)),
    y: Math.round(anchor.viewportRect.y + (anchor.isFixed ? 0 : scrollOffset.y - window.scrollY)),
    width: anchor.viewportRect.width,
    height: anchor.viewportRect.height
  }
}

export function installBrowserAnnotationRuntime(
  options: BrowserAnnotationRuntimeOptions
): BrowserAnnotationRuntimeController {
  const state: BrowserAnnotationRuntimeState = {
    mode: 'browse',
    labels: DEFAULT_LABELS,
    root: null,
    hoverBox: null,
    editor: null,
    markerPreview: null,
    selectedMarkerId: null,
    draft: null,
    dragStart: null,
    markers: []
  }

  function post(event: BrowserAnnotationRuntimeEvent): void {
    options.postEvent(event)
  }

  function ensureRoot(): HTMLDivElement {
    if (state.root?.isConnected) return state.root
    const host = document.documentElement ?? document.body
    if (!host) {
      throw new Error('Browser annotation root host is not available.')
    }
    document.getElementById('owls-browser-annotation-root')?.remove()
    const root = document.createElement('div')
    root.id = 'owls-browser-annotation-root'
    root.style.position = 'fixed'
    root.style.inset = '0'
    root.style.zIndex = '2147483647'
    root.style.pointerEvents = 'none'
    root.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    root.style.colorScheme = 'light dark'
    const style = document.createElement('style')
    style.textContent = `
      #owls-browser-annotation-root textarea[data-owls-browser-annotation-input]::placeholder {
        color: #b8b8bd !important;
        opacity: 1 !important;
      }
      #owls-browser-annotation-root textarea[data-owls-browser-annotation-input]::selection {
        background: rgba(10, 132, 255, 0.28) !important;
        color: #111111 !important;
      }
    `
    root.appendChild(style)
    host.appendChild(root)
    state.root = root
    return root
  }

  function clearRoot(): void {
    state.draft?.cleanupPastedImages?.()
    state.root?.remove()
    state.root = null
    state.hoverBox = null
    state.editor = null
    state.markerPreview = null
    state.selectedMarkerId = null
    state.draft = null
    state.dragStart = null
    state.markers = []
  }

  function positionMarker(marker: BrowserAnnotationMarker): void {
    const point = markerPointFor(marker.anchor, marker.scrollOffset)
    const size = 26
    const margin = size + 2
    const visible =
      point.x >= -margin &&
      point.x <= window.innerWidth + margin &&
      point.y >= -margin &&
      point.y <= window.innerHeight + margin
    marker.element.style.display = visible ? 'inline-flex' : 'none'
    if (!visible) return
    marker.element.style.left = `${clamp(point.x - size / 2, 4, window.innerWidth - size - 2)}px`
    marker.element.style.top = `${clamp(point.y - size / 2, 4, window.innerHeight - size - 2)}px`
    const selected = state.selectedMarkerId === marker.id
    marker.element.dataset.selected = String(selected)
    marker.element.style.transform = selected ? 'scale(1.12)' : 'scale(1)'
    marker.element.style.boxShadow = selected
      ? '0 0 0 3px rgba(10,132,255,0.22), 0 10px 28px rgba(10,132,255,0.48)'
      : '0 8px 22px rgba(10,132,255,0.38)'
  }

  function positionMarkers(): void {
    for (const marker of state.markers) {
      positionMarker(marker)
    }
  }

  function clearDraft(): void {
    state.draft?.cleanupPastedImages?.()
    state.hoverBox?.remove()
    state.editor?.remove()
    state.hoverBox = null
    state.editor = null
    state.draft = null
    state.dragStart = null
    post({ type: 'cancel-draft' })
  }

  function removeMarkerPreview(markerId?: string): void {
    if (markerId && state.selectedMarkerId === markerId) return
    state.markerPreview?.remove()
    state.markerPreview = null
  }

  function positionMarkerPreview(preview: HTMLDivElement, marker: BrowserAnnotationMarker): void {
    const point = markerPointFor(marker.anchor, marker.scrollOffset)
    const width = 280
    const left = clamp(point.x + 14, 8, window.innerWidth - width - 8)
    const top = clamp(point.y - 12, 8, window.innerHeight - 76)
    preview.style.left = `${left}px`
    preview.style.top = `${top}px`
    preview.style.width = `${width}px`
  }

  function renderMarkerPreview(marker: BrowserAnnotationMarker, selected: boolean): void {
    const root = ensureRoot()
    state.markerPreview?.remove()
    const preview = document.createElement('div')
    const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches
    preview.setAttribute('role', 'status')
    preview.setAttribute('data-owls-browser-annotation-preview', 'true')
    preview.style.position = 'fixed'
    preview.style.maxHeight = '120px'
    preview.style.overflow = 'hidden'
    preview.style.padding = '8px 10px'
    preview.style.borderRadius = '10px'
    preview.style.border = prefersDark
      ? '1px solid rgba(255,255,255,0.14)'
      : '1px solid rgba(0,0,0,0.1)'
    preview.style.background = prefersDark ? 'rgba(25,25,26,0.96)' : 'rgba(255,255,255,0.98)'
    preview.style.color = prefersDark ? '#f4f4f5' : '#18181b'
    preview.style.boxShadow = '0 14px 40px rgba(0,0,0,0.24)'
    preview.style.backdropFilter = 'blur(18px)'
    preview.style.pointerEvents = selected ? 'auto' : 'none'
    preview.style.fontSize = '12px'
    preview.style.lineHeight = '1.35'
    preview.textContent = marker.comment
    positionMarkerPreview(preview, marker)
    root.appendChild(preview)
    state.markerPreview = preview
  }

  function clearSelectionBox(): void {
    state.hoverBox?.remove()
    state.hoverBox = null
  }

  function drawSelectedMarkerBox(marker: BrowserAnnotationMarker): void {
    const rect = rectForAnchor(marker.anchor, marker.scrollOffset)
    if (!rect) {
      clearSelectionBox()
      return
    }
    drawBox(rect, false)
  }

  function revealMarkerAnchor(marker: BrowserAnnotationMarker): void {
    const target = findAnchorElement(marker.anchor)
    if (target) {
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' })
      return
    }
    if (!marker.anchor.viewportRect || marker.anchor.isFixed) return
    const currentRect = rectForAnchor(marker.anchor, marker.scrollOffset)
    if (!currentRect) return
    const targetX = Math.max(
      0,
      window.scrollX + currentRect.x + currentRect.width / 2 - window.innerWidth / 2
    )
    const targetY = Math.max(
      0,
      window.scrollY + currentRect.y + currentRect.height / 2 - window.innerHeight / 2
    )
    window.scrollTo({ left: targetX, top: targetY, behavior: 'auto' })
  }

  function refreshSelectedMarker(marker: BrowserAnnotationMarker): void {
    if (state.selectedMarkerId !== marker.id) return
    drawSelectedMarkerBox(marker)
    positionMarker(marker)
    if (state.markerPreview) {
      positionMarkerPreview(state.markerPreview, marker)
    }
  }

  function selectMarker(marker: BrowserAnnotationMarker | null): void {
    state.selectedMarkerId = marker?.id ?? null
    if (marker) {
      renderMarkerPreview(marker, true)
      revealMarkerAnchor(marker)
      refreshSelectedMarker(marker)
      requestAnimationFrame(() => refreshSelectedMarker(marker))
    } else {
      state.markerPreview?.remove()
      state.markerPreview = null
      clearSelectionBox()
    }
    positionMarkers()
  }

  function drawBox(rect: BrowserAnnotationRect, draft: boolean): void {
    const root = ensureRoot()
    const box = state.hoverBox || document.createElement('div')
    box.style.position = 'fixed'
    box.style.left = `${rect.x}px`
    box.style.top = `${rect.y}px`
    box.style.width = `${Math.max(1, rect.width)}px`
    box.style.height = `${Math.max(1, rect.height)}px`
    box.style.border = draft ? '2px solid #0a84ff' : '1.5px solid rgba(10, 132, 255, 0.85)'
    box.style.borderRadius = '6px'
    box.style.background = draft ? 'rgba(10, 132, 255, 0.08)' : 'rgba(10, 132, 255, 0.04)'
    box.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.75), 0 8px 30px rgba(10,132,255,0.18)'
    box.style.pointerEvents = 'none'
    if (!state.hoverBox) {
      root.appendChild(box)
      state.hoverBox = box
    }
  }

  function positionEditor(editor: HTMLFormElement, anchor: BrowserAnnotationAnchor): void {
    const width = Math.min(300, window.innerWidth - 16)
    editor.style.width = `${width}px`
    const height = Math.max(44, editor.getBoundingClientRect().height || 44)
    const point = anchor.viewportPoint
    const rightSideLeft = point.x + 18
    const leftSideLeft = point.x - width - 18
    const left =
      rightSideLeft + width <= window.innerWidth - 8
        ? rightSideLeft
        : leftSideLeft >= 8
          ? leftSideLeft
          : clamp(point.x - width / 2, 8, window.innerWidth - width - 8)
    const top = clamp(point.y - height / 2, 8, window.innerHeight - height - 8)
    editor.style.left = `${left}px`
    editor.style.top = `${top}px`
  }

  function renderEditor(anchor: BrowserAnnotationAnchor): void {
    state.draft?.cleanupPastedImages?.()
    const root = ensureRoot()
    state.editor?.remove()
    const editor = document.createElement('form')
    const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches
    resetRuntimeElementStyle(editor)
    editor.style.position = 'fixed'
    editor.style.display = 'flex'
    editor.style.alignItems = 'flex-start'
    editor.style.gap = '6px'
    editor.style.padding = '4px 6px 4px 10px'
    editor.style.borderRadius = '22px'
    editor.style.border = prefersDark
      ? '1px solid rgba(255,255,255,0.18)'
      : '1px solid rgba(17,24,39,0.08)'
    editor.style.background = prefersDark ? 'rgba(250,250,250,0.96)' : 'rgba(255,255,255,0.98)'
    editor.style.boxShadow = '0 10px 26px rgba(0,0,0,0.18)'
    editor.style.backdropFilter = 'blur(18px)'
    editor.style.pointerEvents = 'auto'
    editor.style.zIndex = '2147483647'

    const pastedImages: BrowserAnnotationPastedImageDraft[] = []
    const content = document.createElement('div')
    resetRuntimeElementStyle(content)
    content.style.display = 'flex'
    content.style.minWidth = '0'
    content.style.flex = '1'
    content.style.flexDirection = 'column'
    content.style.gap = '6px'
    content.style.justifyContent = 'flex-start'

    const previewList = document.createElement('div')
    resetRuntimeElementStyle(previewList)
    previewList.style.display = 'none'
    previewList.style.flexWrap = 'wrap'
    previewList.style.gap = '6px'
    previewList.style.padding = '0 0 2px'

    const input = document.createElement('textarea')
    resetRuntimeElementStyle(input)
    input.rows = 1
    input.setAttribute('data-owls-browser-annotation-input', 'true')
    input.placeholder = state.labels.placeholder
    input.style.minWidth = '0'
    input.style.flex = '1'
    input.style.height = '30px'
    input.style.minHeight = '30px'
    input.style.maxHeight = '93px'
    input.style.display = 'block'
    input.style.border = '0'
    input.style.outline = '0'
    input.style.background = 'transparent'
    input.style.color = '#111111'
    input.style.fontSize = '15px'
    input.style.lineHeight = '20px'
    input.style.padding = '5px 0'
    input.style.appearance = 'none'
    input.style.resize = 'none'
    input.style.overflowY = 'hidden'
    input.style.whiteSpace = 'pre-wrap'
    input.style.wordBreak = 'break-word'

    const submit = document.createElement('button')
    resetRuntimeElementStyle(submit)
    submit.type = 'submit'
    submit.setAttribute('aria-label', state.labels.add)
    submit.style.display = 'inline-flex'
    submit.style.alignItems = 'center'
    submit.style.justifyContent = 'center'
    submit.style.flex = '0 0 auto'
    submit.style.width = '32px'
    submit.style.height = '32px'
    submit.style.border = '0'
    submit.style.borderRadius = '999px'
    submit.style.setProperty('background-color', '#111111', 'important')
    submit.style.setProperty('color', '#ffffff', 'important')
    submit.style.opacity = '1'
    submit.style.padding = '0'
    submit.style.cursor = 'pointer'
    submit.style.appearance = 'none'
    submit.appendChild(createRuntimeIcon('M12 19V5m-7 7 7-7 7 7'))

    const cleanupPastedImages = () => {
      for (const image of pastedImages) {
        URL.revokeObjectURL(image.previewUrl)
      }
      pastedImages.length = 0
    }
    state.draft = {
      annotationId: state.draft?.annotationId,
      comment: state.draft?.comment,
      anchor: state.draft?.anchor ?? anchor,
      scrollOffset: state.draft?.scrollOffset ?? currentScrollOffset(),
      cleanupPastedImages
    }

    const renderPastedImages = () => {
      previewList.replaceChildren()
      previewList.style.display = pastedImages.length > 0 ? 'flex' : 'none'
      for (const image of pastedImages) {
        const item = document.createElement('div')
        resetRuntimeElementStyle(item)
        item.style.position = 'relative'
        item.style.width = '78px'
        item.style.height = '78px'
        item.style.overflow = 'hidden'
        item.style.borderRadius = '12px'
        item.style.border = '1px solid rgba(17,24,39,0.14)'
        item.style.background = '#f5f5f5'

        const thumbnail = document.createElement('img')
        resetRuntimeElementStyle(thumbnail)
        thumbnail.src = image.previewUrl
        thumbnail.alt = image.name || 'Pasted image'
        thumbnail.style.width = '100%'
        thumbnail.style.height = '100%'
        thumbnail.style.objectFit = 'cover'
        thumbnail.style.display = 'block'

        const remove = document.createElement('button')
        resetRuntimeElementStyle(remove)
        remove.type = 'button'
        remove.setAttribute('aria-label', 'Remove pasted image')
        remove.style.position = 'absolute'
        remove.style.top = '6px'
        remove.style.right = '6px'
        remove.style.display = 'inline-flex'
        remove.style.width = '22px'
        remove.style.height = '22px'
        remove.style.alignItems = 'center'
        remove.style.justifyContent = 'center'
        remove.style.border = '0'
        remove.style.borderRadius = '999px'
        remove.style.background = 'rgba(17,24,39,0.88)'
        remove.style.color = '#ffffff'
        remove.style.cursor = 'pointer'
        remove.style.padding = '0'
        remove.style.appearance = 'none'
        remove.appendChild(createRuntimeIcon('M18 6 6 18M6 6l12 12'))
        remove.onclick = () => {
          const index = pastedImages.findIndex((candidate) => candidate.id === image.id)
          if (index !== -1) {
            const [removed] = pastedImages.splice(index, 1)
            URL.revokeObjectURL(removed.previewUrl)
          }
          renderPastedImages()
          updateSubmitVisibility()
          resizeEditor()
          input.focus()
        }

        item.append(thumbnail, remove)
        previewList.appendChild(item)
      }
    }

    const resizeEditor = () => {
      input.style.height = '30px'
      const nextHeight = Math.min(input.scrollHeight, 93)
      input.style.height = `${Math.max(30, nextHeight)}px`
      input.style.overflowY = input.scrollHeight > 93 ? 'auto' : 'hidden'
      positionEditor(editor, anchor)
    }

    const updateSubmitVisibility = () => {
      const hasComment = Boolean(cleanMultiline(input.value)) || pastedImages.length > 0
      submit.disabled = false
      submit.setAttribute('aria-disabled', String(!hasComment))
      submit.style.setProperty('background-color', hasComment ? '#111111' : '#8e8e8e', 'important')
      submit.style.setProperty('color', '#ffffff', 'important')
      submit.style.opacity = '1'
      submit.style.cursor = hasComment ? 'pointer' : 'default'
    }

    input.onkeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        clearDraft()
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        editor.requestSubmit()
      }
    }
    input.oninput = () => {
      updateSubmitVisibility()
      resizeEditor()
    }
    input.onpaste = (event) => {
      const files = Array.from(event.clipboardData?.items ?? []).flatMap((item) => {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) return []
        const file = item.getAsFile()
        return file ? [file] : []
      })
      if (files.length === 0) return
      event.preventDefault()
      void Promise.all(
        files.map(async (file): Promise<BrowserAnnotationPastedImageDraft> => {
          const data = await file.arrayBuffer()
          return {
            id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
            name: file.name || undefined,
            mimeType: file.type || 'image/png',
            data,
            previewUrl: URL.createObjectURL(file)
          }
        })
      ).then((images) => {
        pastedImages.push(...images)
        renderPastedImages()
        updateSubmitVisibility()
        resizeEditor()
        input.focus()
      })
    }

    content.append(previewList, input)
    editor.append(content, submit)
    editor.onsubmit = (event) => {
      event.preventDefault()
      const comment = cleanMultiline(input.value) || (pastedImages.length > 0 ? 'Pasted image' : '')
      if (!comment) {
        input.focus()
        return
      }
      const annotationId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
      const draft = state.draft
      const currentAnchor = draft?.anchor ?? anchor
      const scrollOffset = draft?.scrollOffset ?? currentScrollOffset()
      state.draft = {
        annotationId,
        comment,
        anchor: currentAnchor,
        scrollOffset,
        cleanupPastedImages
      }
      state.editor?.remove()
      state.editor = null
      post({
        type: 'submit',
        annotation: {
          annotationId,
          comment,
          anchor: currentAnchor,
          pastedImages: pastedImages.map(({ previewUrl: _previewUrl, id: _id, ...image }) => image)
        }
      })
      clearDraft()
    }

    root.appendChild(editor)
    state.editor = editor
    updateSubmitVisibility()
    resizeEditor()
    input.focus()
  }

  function upsertCommittedMarker(
    committed: BrowserAnnotationCommitted,
    scrollOffset = currentScrollOffset()
  ): BrowserAnnotationMarker {
    const root = ensureRoot()
    const existing = state.markers.find((marker) => marker.id === committed.annotationId)
    if (existing) {
      existing.label = committed.label
      existing.comment = committed.comment
      existing.anchor = committed.anchor
      existing.scrollOffset = scrollOffset
      existing.element.textContent = String(committed.label)
      existing.element.setAttribute('aria-label', `Browser comment ${committed.label}`)
      positionMarker(existing)
      return existing
    }

    const marker = document.createElement('button')
    resetRuntimeElementStyle(marker)
    marker.type = 'button'
    marker.textContent = String(committed.label)
    marker.setAttribute('aria-label', `Browser comment ${committed.label}`)
    marker.setAttribute('data-owls-browser-annotation-marker', 'true')
    marker.style.position = 'fixed'
    marker.style.display = 'inline-flex'
    marker.style.alignItems = 'center'
    marker.style.justifyContent = 'center'
    marker.style.width = '26px'
    marker.style.height = '26px'
    marker.style.minWidth = '26px'
    marker.style.minHeight = '26px'
    marker.style.padding = '0'
    marker.style.margin = '0'
    marker.style.border = '2px solid white'
    marker.style.borderRadius = '50%'
    marker.style.background = '#0a84ff'
    marker.style.color = 'white'
    marker.style.fontSize = '13px'
    marker.style.fontWeight = '700'
    marker.style.lineHeight = '1'
    marker.style.transition = 'transform 120ms ease, box-shadow 120ms ease'
    marker.style.boxShadow = '0 8px 22px rgba(10,132,255,0.38)'
    marker.style.pointerEvents = 'auto'
    marker.style.cursor = 'pointer'
    marker.style.appearance = 'none'
    marker.onmouseenter = () => renderMarkerPreview(markerState, false)
    marker.onmouseleave = () => removeMarkerPreview(markerState.id)
    marker.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      selectMarker(state.selectedMarkerId === markerState.id ? null : markerState)
    }
    root.appendChild(marker)
    const markerState = {
      id: committed.annotationId,
      label: committed.label,
      comment: committed.comment,
      anchor: committed.anchor,
      element: marker,
      scrollOffset
    }
    state.markers.push(markerState)
    positionMarker(markerState)
    return markerState
  }

  function markerFor(command: Extract<BrowserAnnotationHostCommand, { type: 'commit' }>): void {
    const draft = state.draft
    const anchor = draft?.anchor
    if (!anchor || draft?.annotationId !== command.annotationId) return
    upsertCommittedMarker(
      {
        annotationId: command.annotationId,
        label: command.label,
        comment: command.comment,
        anchor
      },
      draft.scrollOffset
    )
    state.draft = null
    state.hoverBox?.remove()
    state.hoverBox = null
  }

  function selectCommittedMarker(annotationId: string | null): void {
    if (!annotationId) {
      selectMarker(null)
      return
    }
    const marker = state.markers.find((marker) => marker.id === annotationId)
    selectMarker(marker ?? null)
  }

  function syncCommittedMarkers(comments: BrowserAnnotationCommitted[]): void {
    const visibleComments = comments.filter((comment) =>
      browserAnnotationUrlsMatch(comment.anchor.pageUrl, location.href)
    )
    const nextIds = new Set(visibleComments.map((comment) => comment.annotationId))
    for (const marker of state.markers) {
      if (!nextIds.has(marker.id)) {
        marker.element.remove()
      }
    }
    state.markers = state.markers.filter((marker) => nextIds.has(marker.id))
    if (state.selectedMarkerId && !nextIds.has(state.selectedMarkerId)) {
      selectMarker(null)
    }
    for (const comment of visibleComments) {
      upsertCommittedMarker(comment)
    }
    positionMarkers()
  }

  function eventTargetInsideRoot(target: EventTarget | null): boolean {
    return Boolean(target instanceof Node && state.root?.contains(target))
  }

  function hasPendingSubmission(): boolean {
    return Boolean(state.draft?.annotationId)
  }

  function refreshDraft(): void {
    const draft = state.draft
    if (state.mode !== 'comment' || !draft || draft.annotationId) return

    const rect = rectForAnchor(draft.anchor, draft.scrollOffset)
    if (!rect) return
    const point =
      draft.anchor.kind === 'element'
        ? markerPointFor(draft.anchor, draft.scrollOffset)
        : fallbackMarkerPoint(draft.anchor, draft.scrollOffset)
    draft.anchor = {
      ...draft.anchor,
      viewportRect: rect,
      viewportPoint: point,
      viewportSize: viewportSize()
    }
    draft.scrollOffset = currentScrollOffset()
    drawBox(rect, true)
    if (state.editor) {
      positionEditor(state.editor, draft.anchor)
    }
  }

  function onPointerMove(event: MouseEvent | PointerEvent, sourceWindow: Window = window): void {
    if (state.mode !== 'comment' || state.editor || hasPendingSubmission()) return
    if (state.dragStart) {
      const end = pointFromEvent(event, sourceWindow)
      const rect = {
        x: Math.min(state.dragStart.x, end.x),
        y: Math.min(state.dragStart.y, end.y),
        width: Math.abs(end.x - state.dragStart.x),
        height: Math.abs(end.y - state.dragStart.y)
      }
      drawBox(rect, true)
      return
    }
    const point = pointFromEvent(event, sourceWindow)
    const target = hitTargetAtPoint(point)?.element
    if (!target || target === state.root || state.root?.contains(target)) return
    const rect = viewportRectForElement(target)
    if (rect) drawBox(rect, false)
  }

  function onPointerDown(event: MouseEvent | PointerEvent, sourceWindow: Window = window): void {
    if (state.mode !== 'comment' || state.editor) return
    if (eventTargetInsideRoot(event.target)) return
    selectMarker(null)
    if (hasPendingSubmission()) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    state.dragStart = pointFromEvent(event, sourceWindow)
  }

  function onPointerUp(event: MouseEvent | PointerEvent, sourceWindow: Window = window): void {
    if (state.mode !== 'comment' || state.editor) return
    if (hasPendingSubmission()) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (!state.dragStart) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const end = pointFromEvent(event, sourceWindow)
    const dragRect = {
      x: Math.min(state.dragStart.x, end.x),
      y: Math.min(state.dragStart.y, end.y),
      width: Math.abs(end.x - state.dragStart.x),
      height: Math.abs(end.y - state.dragStart.y)
    }
    state.dragStart = null
    const point = pointFromEvent(event, sourceWindow)
    const hitTarget = hitTargetAtPoint(point)
    const anchor =
      dragRect.width >= 8 || dragRect.height >= 8
        ? anchorForRegion(dragRect, point)
        : anchorForElement(hitTarget ?? { element: document.body }, point)
    state.draft = { anchor, scrollOffset: currentScrollOffset() }
    drawBox(anchor.viewportRect || { x: point.x, y: point.y, width: 1, height: 1 }, true)
    renderEditor(anchor)
  }

  function suppressPageEvent(event: Event): void {
    if (state.mode !== 'comment') return
    if (eventTargetInsideRoot(event.target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function setMode(command: Extract<BrowserAnnotationHostCommand, { type: 'set-mode' }>): void {
    state.mode = command.mode
    state.labels = command.labels || state.labels
    document.documentElement.style.cursor = command.mode === 'comment' ? 'copy' : ''
    document.documentElement.style.userSelect = command.mode === 'comment' ? 'none' : ''
    if (command.mode === 'comment') {
      ensureRoot()
    } else {
      clearRoot()
      state.markers = []
      state.selectedMarkerId = null
    }
  }

  function discard(): void {
    setMode({ type: 'set-mode', mode: 'browse', labels: state.labels })
  }

  function handleCommand(command: BrowserAnnotationHostCommand): void {
    if (command.type === 'set-mode') setMode(command)
    if (command.type === 'discard') discard()
    if (command.type === 'cancel-draft') clearDraft()
    if (command.type === 'commit') markerFor(command)
    if (command.type === 'sync-comments') syncCommittedMarkers(command.comments)
    if (command.type === 'select') selectCommittedMarker(command.annotationId)
  }

  let overlayRefreshFrame: number | null = null
  function scheduleOverlayRefresh(): void {
    if (state.mode !== 'comment') return
    if (!state.draft && state.markers.length === 0) return
    if (overlayRefreshFrame !== null) return
    overlayRefreshFrame = requestAnimationFrame(() => {
      overlayRefreshFrame = null
      refreshDraft()
      positionMarkers()
      if (state.selectedMarkerId) {
        const marker = state.markers.find((marker) => marker.id === state.selectedMarkerId)
        if (marker && state.markerPreview) {
          positionMarkerPreview(state.markerPreview, marker)
        }
      }
    })
  }

  const COMPATIBILITY_MOUSE_SUPPRESSION_MS = 700
  let lastPointerDownAt = 0
  let lastPointerUpAt = 0
  function markPointerDown(): void {
    lastPointerDownAt = performance.now()
  }

  function markPointerUp(): void {
    lastPointerUpAt = performance.now()
  }

  function shouldIgnoreCompatibilityMouseDown(): boolean {
    return (
      typeof PointerEvent !== 'undefined' &&
      performance.now() - lastPointerDownAt < COMPATIBILITY_MOUSE_SUPPRESSION_MS
    )
  }

  function shouldIgnoreCompatibilityMouseUp(): boolean {
    return (
      typeof PointerEvent !== 'undefined' &&
      performance.now() - lastPointerUpAt < COMPATIBILITY_MOUSE_SUPPRESSION_MS
    )
  }

  const pointerEventListeners: Array<{
    type: keyof WindowEventMap
    listener: (event: Event, sourceWindow: Window) => void
  }> = [
    ...(typeof PointerEvent !== 'undefined'
      ? [
          {
            type: 'pointermove' as const,
            listener: (event: Event, sourceWindow: Window) =>
              onPointerMove(event as PointerEvent, sourceWindow)
          },
          {
            type: 'pointerdown' as const,
            listener: (event: Event, sourceWindow: Window) => {
              markPointerDown()
              onPointerDown(event as PointerEvent, sourceWindow)
            }
          },
          {
            type: 'pointerup' as const,
            listener: (event: Event, sourceWindow: Window) => {
              markPointerUp()
              onPointerUp(event as PointerEvent, sourceWindow)
            }
          }
        ]
      : []),
    {
      type: 'mousemove',
      listener: (event, sourceWindow) => onPointerMove(event as MouseEvent, sourceWindow)
    },
    {
      type: 'mousedown',
      listener: (event, sourceWindow) => {
        if (shouldIgnoreCompatibilityMouseDown()) return
        onPointerDown(event as MouseEvent, sourceWindow)
      }
    },
    {
      type: 'mouseup',
      listener: (event, sourceWindow) => {
        if (shouldIgnoreCompatibilityMouseUp()) return
        onPointerUp(event as MouseEvent, sourceWindow)
      }
    }
  ]

  const suppressedEventTypes: Array<keyof WindowEventMap> = [
    'click',
    'auxclick',
    'dblclick',
    'selectstart',
    'dragstart'
  ]

  const keydownListener = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || state.mode !== 'comment') return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (state.selectedMarkerId) {
      selectMarker(null)
      return
    }
    if (state.draft) {
      clearDraft()
      return
    }
    post({ type: 'exit-comment-mode' })
  }

  const frameListenerCleanups = new Map<Window, () => void>()

  function sameOriginChildWindows(targetWindow: Window): Window[] {
    let targetDocument: Document
    try {
      targetDocument = targetWindow.document
    } catch {
      return []
    }
    const frames = Array.from(targetDocument.querySelectorAll('iframe')).flatMap((frame) => {
      if (!isFrameElement(frame)) return []
      const frameWindow = frameWindowFor(frame)
      const frameDocument = frameDocumentFor(frame)
      if (!frameWindow || !frameDocument) return []
      return [frameWindow, ...sameOriginChildWindows(frameWindow)]
    })
    return [targetWindow, ...frames]
  }

  let syncFrameListenersFrame: number | null = null
  function scheduleFrameListenerSync(): void {
    if (syncFrameListenersFrame !== null) return
    syncFrameListenersFrame = requestAnimationFrame(() => {
      syncFrameListenersFrame = null
      syncFrameListeners()
    })
  }

  function addListenersForWindow(targetWindow: Window): () => void {
    const cleanupCallbacks: Array<() => void> = []
    for (const { type, listener } of pointerEventListeners) {
      const wrapped = (event: Event): void => listener(event, targetWindow)
      targetWindow.addEventListener(type, wrapped, true)
      cleanupCallbacks.push(() => targetWindow.removeEventListener(type, wrapped, true))
    }
    for (const type of suppressedEventTypes) {
      targetWindow.addEventListener(type, suppressPageEvent, true)
      cleanupCallbacks.push(() => targetWindow.removeEventListener(type, suppressPageEvent, true))
    }
    targetWindow.addEventListener('scroll', scheduleOverlayRefresh, true)
    targetWindow.addEventListener('resize', scheduleOverlayRefresh, true)
    targetWindow.addEventListener('keydown', keydownListener, true)
    let targetDocument: Document | null = null
    try {
      targetDocument = targetWindow.document
      targetDocument.addEventListener('load', scheduleFrameListenerSync, true)
    } catch {
      targetDocument = null
    }
    cleanupCallbacks.push(() =>
      targetWindow.removeEventListener('scroll', scheduleOverlayRefresh, true)
    )
    cleanupCallbacks.push(() =>
      targetWindow.removeEventListener('resize', scheduleOverlayRefresh, true)
    )
    cleanupCallbacks.push(() => targetWindow.removeEventListener('keydown', keydownListener, true))
    cleanupCallbacks.push(() => {
      targetDocument?.removeEventListener('load', scheduleFrameListenerSync, true)
    })
    return () => {
      for (const cleanup of cleanupCallbacks) cleanup()
    }
  }

  function syncFrameListeners(): void {
    const activeWindows = new Set(sameOriginChildWindows(window))
    for (const targetWindow of activeWindows) {
      if (!frameListenerCleanups.has(targetWindow)) {
        frameListenerCleanups.set(targetWindow, addListenersForWindow(targetWindow))
      }
    }
    for (const [targetWindow, cleanup] of frameListenerCleanups) {
      if (!activeWindows.has(targetWindow)) {
        cleanup()
        frameListenerCleanups.delete(targetWindow)
      }
    }
  }

  syncFrameListeners()
  const frameObserver = new MutationObserver(() => {
    observeFrameMutations()
    scheduleFrameListenerSync()
  })
  let observingDocumentElement = false
  function observeFrameMutations(): void {
    const root = document.documentElement
    if (root) {
      if (observingDocumentElement) return
      frameObserver.disconnect()
      observingDocumentElement = true
      frameObserver.observe(root, {
        attributeFilter: ['src'],
        attributes: true,
        childList: true,
        subtree: true
      })
      scheduleFrameListenerSync()
      return
    }

    observingDocumentElement = false
    frameObserver.observe(document, {
      childList: true,
      subtree: true
    })
  }
  observeFrameMutations()
  if (!document.documentElement) {
    document.addEventListener('readystatechange', observeFrameMutations, { once: true })
  }

  const postReady = (): void => {
    post({ type: 'ready', url: location.href, title: document.title || undefined })
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', postReady, { once: true })
  } else {
    postReady()
  }

  return {
    handleCommand,
    dispose: () => {
      if (overlayRefreshFrame !== null) {
        cancelAnimationFrame(overlayRefreshFrame)
        overlayRefreshFrame = null
      }
      clearRoot()
      document.documentElement.style.cursor = ''
      document.documentElement.style.userSelect = ''
      if (syncFrameListenersFrame !== null) {
        cancelAnimationFrame(syncFrameListenersFrame)
        syncFrameListenersFrame = null
      }
      frameObserver.disconnect()
      for (const cleanup of frameListenerCleanups.values()) {
        cleanup()
      }
      frameListenerCleanups.clear()
    }
  }
}

export type BrowserAnnotationRuntimeHostCommand = BrowserAnnotationHostCommand
export type BrowserAnnotationRuntimeLabels = BrowserAnnotationLabels
export type BrowserAnnotationRuntimeEventPayload = BrowserAnnotationRuntimeEvent
