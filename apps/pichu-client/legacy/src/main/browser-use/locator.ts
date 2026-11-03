import { animateEmbeddedBrowserCursorClick } from '../ipc-handlers/embedded-browser-handler.js'
import {
  dispatchMouseClick,
  executeCdp,
  insertCdpText,
  viewportPointForBackendNode,
  waitForBrowserNavigation
} from './cdp-backend.js'

type RuntimeEvalResult = {
  result?: {
    value?: unknown
  }
  exceptionDetails?: unknown
}

type BrowserUseWaitOptions = {
  timeoutMs?: number
}

export type BrowserUseSelector =
  | { type: 'css'; value: string }
  | { type: 'text'; value: string }
  | { type: 'role'; role: string; name?: string }
  | { type: 'label'; value: string }
  | { type: 'testId'; value: string }

export type BrowserUseActionExpectation = {
  urlContains?: string
  textVisible?: string
  selectorVisible?: BrowserUseSelector
  selectorHidden?: BrowserUseSelector
  valueEquals?: {
    selector: BrowserUseSelector
    value: string
  }
}

export type LocatorCandidate = {
  token: string
  framePath: number[]
  tagName: string
  role: string | null
  name: string | null
  text: string
  value: string | null
  visible: boolean
  enabled: boolean
  editable: boolean
  backendNodeId: number | null
  viewportPoint: { x: number; y: number } | null
}

export type ResolvedLocator = LocatorCandidate & {
  backendNodeId: number | null
  point: { x: number; y: number }
}

export type BrowserUseActionResult = {
  ok: true
  url: string
  title: string
  postActionSummary: string | null
}

const INJECTED_RUNTIME_VERSION = 2
const DEFAULT_WAIT_TIMEOUT_MS = 5_000
const POST_ACTION_NAVIGATION_WAIT_MS = 1_000
const TOKEN_ATTRIBUTE = 'data-pichu-browser-use-token'
const sessionsWithNewDocumentRuntime = new Set<string>()

const INJECTED_RUNTIME = String.raw`
(() => {
  const VERSION = ${INJECTED_RUNTIME_VERSION};
  const TOKEN_ATTRIBUTE = '${TOKEN_ATTRIBUTE}';
  const MAX_TEXT_LENGTH = 160;

  if (window.__pichuBrowserUse && window.__pichuBrowserUse.version === VERSION) {
    return;
  }

  let nextTokenId = 1;

  function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function tokenFor(element) {
    let token = element.getAttribute(TOKEN_ATTRIBUTE);
    if (!token) {
      token = 'obu-' + Date.now().toString(36) + '-' + nextTokenId.toString(36);
      nextTokenId += 1;
      element.setAttribute(TOKEN_ATTRIBUTE, token);
    }
    return token;
  }

  function isElementVisible(element) {
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden'
      && style.display !== 'none'
      && Number(style.opacity) !== 0
      && rect.width > 0
      && rect.height > 0;
  }

  function isElementEnabled(element) {
    return !element.matches(':disabled,[aria-disabled="true"]');
  }

  function isEditable(element) {
    const tagName = element.tagName.toLowerCase();
    if (element.isContentEditable) return true;
    if (tagName === 'textarea') return true;
    if (tagName !== 'input') return false;
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
  }

  function roleFor(element) {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit;
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'a' && element.hasAttribute('href')) return 'link';
    if (tagName === 'button') return 'button';
    if (tagName === 'select') return 'combobox';
    if (tagName === 'textarea') return 'textbox';
    if (tagName === 'input') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      return 'textbox';
    }
    if (/^h[1-6]$/.test(tagName)) return 'heading';
    return null;
  }

  function labelsFor(element) {
    const labels = [];
    if ('labels' in element && element.labels) {
      for (const label of element.labels) labels.push(compactText(label.innerText || label.textContent));
    }
    const id = element.getAttribute('id');
    if (id) {
      for (const label of element.ownerDocument.querySelectorAll('label[for="' + cssEscape(id) + '"]')) {
        labels.push(compactText(label.innerText || label.textContent));
      }
    }
    return labels.filter(Boolean);
  }

  function accessibleName(element) {
    const aria = element.getAttribute('aria-label');
    if (aria) return compactText(aria);
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const name = labelledBy
        .split(/\s+/)
        .map((id) => element.ownerDocument.getElementById(id))
        .filter(Boolean)
        .map((node) => compactText(node.innerText || node.textContent))
        .join(' ')
        .trim();
      if (name) return name;
    }
    const labels = labelsFor(element);
    if (labels.length > 0) return labels.join(' ');
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return compactText(placeholder);
    const title = element.getAttribute('title');
    if (title) return compactText(title);
    if ('value' in element && element.tagName.toLowerCase() === 'input') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (['submit', 'button', 'reset'].includes(type)) return compactText(element.value);
    }
    return compactText(element.innerText || element.textContent);
  }

  function valueFor(element) {
    if ('value' in element && typeof element.value === 'string') return element.value;
    if (element.isContentEditable) return element.innerText || element.textContent || '';
    return null;
  }

  function candidateFor(element, framePath) {
    const rect = element.getBoundingClientRect();
    const viewportPoint = rect.width > 0 && rect.height > 0
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : null;
    return {
      token: tokenFor(element),
      framePath,
      tagName: element.tagName.toLowerCase(),
      role: roleFor(element),
      name: accessibleName(element) || null,
      text: compactText(element.innerText || element.textContent),
      value: valueFor(element),
      visible: isElementVisible(element),
      enabled: isElementEnabled(element),
      editable: isEditable(element),
      backendNodeId: null,
      viewportPoint
    };
  }

  function walkDocuments(callback) {
    const unsupportedFrames = [];
    function visit(doc, framePath) {
      callback(doc, framePath);
      const frames = Array.from(doc.querySelectorAll('iframe,frame'));
      frames.forEach((frame, index) => {
        try {
          if (frame.contentDocument) {
            visit(frame.contentDocument, framePath.concat(index));
          } else {
            unsupportedFrames.push(frame.src || frame.getAttribute('src') || '<unknown frame>');
          }
        } catch {
          unsupportedFrames.push(frame.src || frame.getAttribute('src') || '<cross-origin frame>');
        }
      });
    }
    visit(document, []);
    return unsupportedFrames;
  }

  function allElementsForSnapshot(doc) {
    return Array.from(doc.querySelectorAll('a,button,input,textarea,select,[role],[tabindex],label,[contenteditable=""],[contenteditable="true"],[data-testid],[data-test],[data-qa]'));
  }

  function allElementsForQuery(doc) {
    return Array.from(doc.querySelectorAll('*'));
  }

  function queryInDocument(doc, selector) {
    if (selector.type === 'css') {
      return Array.from(doc.querySelectorAll(selector.value));
    }
    if (selector.type === 'testId') {
      const escaped = cssEscape(selector.value);
      return Array.from(doc.querySelectorAll('[data-testid="' + escaped + '"],[data-test="' + escaped + '"],[data-qa="' + escaped + '"]'));
    }
    if (selector.type === 'label') {
      const needle = compactText(selector.value).toLowerCase();
      const matches = [];
      for (const label of Array.from(doc.querySelectorAll('label'))) {
        if (!compactText(label.innerText || label.textContent).toLowerCase().includes(needle)) continue;
        if (label.control) matches.push(label.control);
        for (const nested of Array.from(label.querySelectorAll('input,textarea,select,[contenteditable=""],[contenteditable="true"]'))) {
          matches.push(nested);
        }
      }
      for (const element of allElementsForQuery(doc)) {
        if (accessibleName(element).toLowerCase().includes(needle) && isEditable(element)) {
          matches.push(element);
        }
      }
      return matches;
    }
    if (selector.type === 'role') {
      const role = String(selector.role || '').toLowerCase();
      const name = selector.name ? compactText(selector.name).toLowerCase() : null;
      return allElementsForQuery(doc).filter((element) => {
        if ((roleFor(element) || '').toLowerCase() !== role) return false;
        if (!name) return true;
        return accessibleName(element).toLowerCase().includes(name);
      });
    }
    if (selector.type === 'text') {
      const needle = compactText(selector.value).toLowerCase();
      return allElementsForQuery(doc).filter((element) => {
        const text = compactText(element.innerText || element.textContent).toLowerCase();
        const name = accessibleName(element).toLowerCase();
        return text.includes(needle) || name.includes(needle);
      });
    }
    return [];
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements));
  }

  function resolve(selector) {
    const nodes = [];
    const unsupportedFrames = walkDocuments((doc, framePath) => {
      for (const element of uniqueElements(queryInDocument(doc, selector))) {
        nodes.push(candidateFor(element, framePath));
      }
    });
    return { nodes, unsupportedFrames };
  }

  function snapshot() {
    const nodes = [];
    const unsupportedFrames = walkDocuments((doc, framePath) => {
      for (const element of allElementsForSnapshot(doc)) {
        const candidate = candidateFor(element, framePath);
        if (candidate.visible || candidate.name || candidate.text || candidate.value) {
          nodes.push(candidate);
        }
      }
    });
    return {
      url: window.location.href,
      title: document.title,
      nodes: nodes.slice(0, 500),
      unsupportedFrames
    };
  }

  function elementByToken(token) {
    let found = null;
    walkDocuments((doc) => {
      if (found) return;
      found = doc.querySelector('[' + TOKEN_ATTRIBUTE + '="' + cssEscape(token) + '"]');
    });
    return found;
  }

  function setNativeValue(element, value) {
    const tagName = element.tagName.toLowerCase();
    const proto = tagName === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function fillToken(token, value) {
    const element = elementByToken(token);
    if (!element) return { ok: false, reason: 'target-not-found' };
    if (!isEditable(element)) return { ok: false, reason: 'target-not-editable' };
    element.focus();
    if (element.isContentEditable) {
      element.textContent = value;
    } else if ('value' in element) {
      setNativeValue(element, value);
    } else {
      return { ok: false, reason: 'target-not-fillable' };
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    const activeToken = document.activeElement ? tokenFor(document.activeElement) : null;
    return { ok: valueFor(element) === value, activeToken, value: valueFor(element), reason: null };
  }

  function prepareInputToken(token) {
    const element = elementByToken(token);
    if (!element) return { ok: false, reason: 'target-not-found' };
    if (!isEditable(element)) return { ok: false, reason: 'target-not-editable' };
    element.focus();
    if ('select' in element) element.select();
    return { ok: true, activeToken: activeToken(), value: valueFor(element) };
  }

  function activeToken() {
    let active = null;
    walkDocuments((doc) => {
      if (active) return;
      const candidate = doc.activeElement;
      if (candidate && candidate !== doc.body) active = candidate;
    });
    return active ? tokenFor(active) : null;
  }

  function valueForToken(token) {
    const element = elementByToken(token);
    return element ? valueFor(element) : null;
  }

  function pointForToken(token) {
    const element = elementByToken(token);
    if (!element) return { ok: false, reason: 'target-not-found' };
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { ok: false, reason: 'target-not-visible' };
    }
    return { ok: true, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
  }

  function scrollToken(token, y) {
    const element = elementByToken(token);
    if (!element) return { ok: false, reason: 'target-not-found' };
    element.scrollBy({ left: 0, top: y, behavior: 'instant' });
    return { ok: true, scrollTop: element.scrollTop };
  }

  function overlays() {
    return Array.from(document.querySelectorAll('[role="dialog"],[role="listbox"],[role="menu"],[role="tree"],dialog,[data-radix-popper-content-wrapper]'))
      .filter((element) => isElementVisible(element))
      .map((element) => candidateFor(element, []));
  }

  window.__pichuBrowserUse = {
    version: VERSION,
    resolve,
    snapshot,
    fillToken,
    prepareInputToken,
    activeToken,
    valueForToken,
    pointForToken,
    scrollToken,
    overlays
  };
})();
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asEvalResult(value: Record<string, unknown>): RuntimeEvalResult {
  return value as RuntimeEvalResult
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function selectorDescription(selector: BrowserUseSelector): string {
  if (selector.type === 'role') {
    return selector.name ? `role=${selector.role} name~=${selector.name}` : `role=${selector.role}`
  }
  return `${selector.type}=${selector.value}`
}

function normalizeSelector(selector: BrowserUseSelector): BrowserUseSelector {
  if (selector.type === 'role') {
    return {
      type: 'role',
      role: selector.role,
      name: selector.name
    }
  }
  return selector
}

function candidateFromRecord(value: unknown): LocatorCandidate | null {
  if (!isRecord(value)) return null
  const token = stringValue(value.token)
  const tagName = stringValue(value.tagName)
  if (!token || !tagName) return null
  return {
    token,
    framePath: Array.isArray(value.framePath)
      ? value.framePath.filter((index): index is number => Number.isInteger(index))
      : [],
    tagName,
    role: stringValue(value.role),
    name: stringValue(value.name),
    text: stringValue(value.text) ?? '',
    value: stringValue(value.value),
    visible: booleanValue(value.visible),
    enabled: booleanValue(value.enabled),
    editable: booleanValue(value.editable),
    backendNodeId: numberValue(value.backendNodeId),
    viewportPoint: pointFromRecord(value.viewportPoint)
  }
}

function pointFromRecord(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null
  const x = numberValue(value.x)
  const y = numberValue(value.y)
  return x === null || y === null ? null : { x, y }
}

function candidatesFromEval(value: unknown): {
  nodes: LocatorCandidate[]
  unsupportedFrames: string[]
} {
  if (!isRecord(value)) return { nodes: [], unsupportedFrames: [] }
  const nodes = Array.isArray(value.nodes)
    ? value.nodes
        .map(candidateFromRecord)
        .filter((candidate): candidate is LocatorCandidate => candidate !== null)
    : []
  const unsupportedFrames = Array.isArray(value.unsupportedFrames)
    ? value.unsupportedFrames.filter((frame): frame is string => typeof frame === 'string')
    : []
  return { nodes, unsupportedFrames }
}

async function evaluateRuntime(sessionKey: string, expression: string): Promise<unknown> {
  const result = asEvalResult(
    await executeCdp(sessionKey, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
  )
  if (result.exceptionDetails) {
    throw new Error(
      `Browser Use injected runtime failed: ${JSON.stringify(result.exceptionDetails)}`
    )
  }
  return result.result?.value
}

async function getCurrentPageState(sessionKey: string): Promise<{ url: string; title: string }> {
  const value = await evaluateRuntime(
    sessionKey,
    '({ url: window.location.href, title: document.title })'
  )
  if (!isRecord(value)) return { url: '', title: '' }
  return {
    url: stringValue(value.url) ?? '',
    title: stringValue(value.title) ?? ''
  }
}

async function lookupBackendNodeId(sessionKey: string, token: string): Promise<number> {
  const escapedToken = token.replace(/["\\]/g, '\\$&')
  const searchResult = await executeCdp(sessionKey, 'DOM.performSearch', {
    query: `[${TOKEN_ATTRIBUTE}="${escapedToken}"]`,
    includeUserAgentShadowDOM: true
  })
  const searchId = stringValue(searchResult.searchId)
  const resultCount = numberValue(searchResult.resultCount) ?? 0
  if (!searchId || resultCount === 0) {
    throw new Error(`Browser Use target token ${token} could not be resolved to a DOM node.`)
  }
  const result = await executeCdp(sessionKey, 'DOM.getSearchResults', {
    searchId,
    fromIndex: 0,
    toIndex: Math.min(resultCount, 1)
  })
  await executeCdp(sessionKey, 'DOM.discardSearchResults', { searchId })
  const nodeIds = Array.isArray(result.nodeIds)
    ? result.nodeIds.filter((nodeId): nodeId is number => Number.isInteger(nodeId))
    : []
  if (nodeIds.length === 0) {
    throw new Error(`Browser Use target token ${token} could not be resolved to a DOM node.`)
  }
  const nodeResult = await executeCdp(sessionKey, 'DOM.describeNode', {
    nodeId: nodeIds[0]
  })
  const backendNodeId = isRecord(nodeResult.node)
    ? numberValue(nodeResult.node.backendNodeId)
    : null
  if (backendNodeId === null) {
    throw new Error(`Browser Use target token ${token} did not have a backend node id.`)
  }
  return backendNodeId
}

export async function enrichBackendNodeIds(
  sessionKey: string,
  candidates: LocatorCandidate[]
): Promise<LocatorCandidate[]> {
  const enriched: LocatorCandidate[] = []
  for (const candidate of candidates) {
    try {
      enriched.push({
        ...candidate,
        backendNodeId: await lookupBackendNodeId(sessionKey, candidate.token)
      })
    } catch {
      enriched.push(candidate)
    }
  }
  return enriched
}

export async function resolveLocatorCandidates(
  sessionKey: string,
  selector: BrowserUseSelector
): Promise<{
  nodes: LocatorCandidate[]
  unsupportedFrames: string[]
}> {
  await ensureInjectedRuntime(sessionKey)
  const selectorJson = JSON.stringify(normalizeSelector(selector))
  const result = candidatesFromEval(
    await evaluateRuntime(sessionKey, `window.__pichuBrowserUse.resolve(${selectorJson})`)
  )
  return {
    nodes: await enrichBackendNodeIds(sessionKey, result.nodes),
    unsupportedFrames: result.unsupportedFrames
  }
}

async function getPostActionSummary(sessionKey: string): Promise<string> {
  await ensureInjectedRuntime(sessionKey)
  const value = await evaluateRuntime(sessionKey, 'window.__pichuBrowserUse.snapshot()')
  if (!isRecord(value)) return ''
  const nodes = Array.isArray(value.nodes)
    ? value.nodes
        .map(candidateFromRecord)
        .filter((candidate): candidate is LocatorCandidate => candidate !== null)
        .filter((candidate) => candidate.visible)
        .slice(0, 10)
    : []
  return nodes
    .map((candidate) => {
      const label = candidate.name || candidate.text || candidate.value || candidate.tagName
      const role = candidate.role ? `${candidate.role}: ` : ''
      return `${role}${label}`
    })
    .join('\n')
}

async function activeToken(sessionKey: string): Promise<string | null> {
  const value = await evaluateRuntime(sessionKey, 'window.__pichuBrowserUse.activeToken()')
  return stringValue(value)
}

async function valueForToken(sessionKey: string, token: string): Promise<string | null> {
  const value = await evaluateRuntime(
    sessionKey,
    `window.__pichuBrowserUse.valueForToken(${JSON.stringify(token)})`
  )
  return stringValue(value)
}

async function viewportPointForToken(
  sessionKey: string,
  token: string
): Promise<{ x: number; y: number }> {
  const value = await evaluateRuntime(
    sessionKey,
    `window.__pichuBrowserUse.pointForToken(${JSON.stringify(token)})`
  )
  if (!isRecord(value) || value.ok !== true) {
    const reason = isRecord(value) ? stringValue(value.reason) : null
    throw new Error(
      `Browser Use could not resolve a viewport point for target token.${reason ? ` Reason: ${reason}.` : ''}`
    )
  }
  const point = pointFromRecord(value.point)
  if (!point) {
    throw new Error('Browser Use target token returned an invalid viewport point.')
  }
  return point
}

async function resolveViewportPoint(
  sessionKey: string,
  candidate: LocatorCandidate
): Promise<{
  backendNodeId: number | null
  point: { x: number; y: number }
}> {
  const backendNodeId =
    candidate.backendNodeId ??
    (await lookupBackendNodeId(sessionKey, candidate.token).catch(() => null))
  if (backendNodeId !== null) {
    try {
      return {
        backendNodeId,
        point: await viewportPointForBackendNode(sessionKey, backendNodeId)
      }
    } catch {
      // DOM node ids can go stale on dynamic pages. Fall back to the injected runtime point.
    }
  }
  return {
    backendNodeId,
    point: await viewportPointForToken(sessionKey, candidate.token)
  }
}

async function expectAction(
  sessionKey: string,
  expectation: BrowserUseActionExpectation | undefined
): Promise<void> {
  if (!expectation) return
  if (expectation.urlContains) {
    const state = await getCurrentPageState(sessionKey)
    if (!state.url.includes(expectation.urlContains)) {
      throw new Error(
        `Browser Use expected URL to contain "${expectation.urlContains}", but current URL is "${state.url}".`
      )
    }
  }
  if (expectation.textVisible) {
    const result = await resolveLocatorCandidates(sessionKey, {
      type: 'text',
      value: expectation.textVisible
    })
    if (!result.nodes.some((node) => node.visible)) {
      throw new Error(`Browser Use expected visible text "${expectation.textVisible}".`)
    }
  }
  if (expectation.selectorVisible) {
    const result = await resolveLocatorCandidates(sessionKey, expectation.selectorVisible)
    if (!result.nodes.some((node) => node.visible)) {
      throw new Error(
        `Browser Use expected visible selector ${selectorDescription(expectation.selectorVisible)}.`
      )
    }
  }
  if (expectation.selectorHidden) {
    const result = await resolveLocatorCandidates(sessionKey, expectation.selectorHidden)
    if (result.nodes.some((node) => node.visible)) {
      throw new Error(
        `Browser Use expected hidden selector ${selectorDescription(expectation.selectorHidden)}.`
      )
    }
  }
  if (expectation.valueEquals) {
    const resolved = await resolveStrictLocator(sessionKey, expectation.valueEquals.selector)
    const value = await valueForToken(sessionKey, resolved.token)
    if (value !== expectation.valueEquals.value) {
      throw new Error(
        `Browser Use expected value "${expectation.valueEquals.value}", but found "${value ?? ''}".`
      )
    }
  }
}

export async function ensureInjectedRuntime(sessionKey: string): Promise<void> {
  if (!sessionsWithNewDocumentRuntime.has(sessionKey)) {
    await executeCdp(sessionKey, 'Page.addScriptToEvaluateOnNewDocument', {
      source: INJECTED_RUNTIME
    })
    sessionsWithNewDocumentRuntime.add(sessionKey)
  }
  await executeCdp(sessionKey, 'Runtime.evaluate', {
    expression: INJECTED_RUNTIME,
    awaitPromise: true,
    returnByValue: true
  })
}

export async function resolveStrictLocator(
  sessionKey: string,
  selector: BrowserUseSelector
): Promise<ResolvedLocator> {
  const result = await resolveLocatorCandidates(sessionKey, selector)
  const visible = result.nodes.filter((candidate) => candidate.visible)
  if (result.nodes.length === 0) {
    const frameHint =
      result.unsupportedFrames.length > 0
        ? ` Unsupported cross-origin frames were found: ${result.unsupportedFrames.join(', ')}.`
        : ''
    throw new Error(`Browser Use found no match for ${selectorDescription(selector)}.${frameHint}`)
  }
  if (visible.length === 0) {
    throw new Error(
      `Browser Use found ${result.nodes.length} hidden match(es) for ${selectorDescription(selector)}.`
    )
  }
  if (visible.length > 1) {
    const labels = visible
      .slice(0, 5)
      .map((candidate) => candidate.name || candidate.text || candidate.value || candidate.tagName)
      .join(', ')
    throw new Error(
      `Browser Use strict selector ${selectorDescription(selector)} matched ${visible.length} visible elements: ${labels}.`
    )
  }
  const candidate = visible[0]
  if (!candidate.enabled) {
    throw new Error(`Browser Use target ${selectorDescription(selector)} is disabled.`)
  }
  const resolvedPoint = await resolveViewportPoint(sessionKey, candidate)
  return {
    ...candidate,
    backendNodeId: resolvedPoint.backendNodeId,
    point: resolvedPoint.point
  }
}

export async function browserUseClick(
  sessionKey: string,
  selector: BrowserUseSelector,
  expectation?: BrowserUseActionExpectation
): Promise<BrowserUseActionResult> {
  const target = await resolveStrictLocator(sessionKey, selector)
  await animateEmbeddedBrowserCursorClick(sessionKey, target.point)
  await dispatchMouseClick(sessionKey, target.point)
  await waitForBrowserNavigation(sessionKey, { timeoutMs: POST_ACTION_NAVIGATION_WAIT_MS })
  await ensureInjectedRuntime(sessionKey)
  await expectAction(sessionKey, expectation)
  const state = await getCurrentPageState(sessionKey)
  return {
    ok: true,
    ...state,
    postActionSummary: expectation ? null : await getPostActionSummary(sessionKey)
  }
}

export async function browserUseDispatchClick(
  sessionKey: string,
  selector: BrowserUseSelector
): Promise<BrowserUseActionResult> {
  const target = await resolveStrictLocator(sessionKey, selector)
  await animateEmbeddedBrowserCursorClick(sessionKey, target.point)
  await dispatchMouseClick(sessionKey, target.point)
  const state = await getCurrentPageState(sessionKey)
  return {
    ok: true,
    ...state,
    postActionSummary: null
  }
}

export async function browserUseFill(
  sessionKey: string,
  selector: BrowserUseSelector,
  value: string,
  expectation?: BrowserUseActionExpectation
): Promise<BrowserUseActionResult> {
  const target = await resolveStrictLocator(sessionKey, selector)
  if (!target.editable) {
    throw new Error(`Browser Use target ${selectorDescription(selector)} is not editable.`)
  }

  const fillResult = await evaluateRuntime(
    sessionKey,
    `window.__pichuBrowserUse.fillToken(${JSON.stringify(target.token)}, ${JSON.stringify(value)})`
  )
  if (!isRecord(fillResult) || fillResult.ok !== true) {
    await animateEmbeddedBrowserCursorClick(sessionKey, target.point)
    await dispatchMouseClick(sessionKey, target.point)
    const prepared = await evaluateRuntime(
      sessionKey,
      `window.__pichuBrowserUse.prepareInputToken(${JSON.stringify(target.token)})`
    )
    if (!isRecord(prepared) || prepared.ok !== true) {
      throw new Error(`Browser Use could not focus fill target ${selectorDescription(selector)}.`)
    }
    if ((await activeToken(sessionKey)) !== target.token) {
      throw new Error(
        'Browser Use refused to insert text because focus moved away from the target.'
      )
    }
    await insertCdpText(sessionKey, value)
    if ((await activeToken(sessionKey)) !== target.token) {
      throw new Error('Browser Use focus moved away from the target after text insertion.')
    }
  }

  const actualValue = await valueForToken(sessionKey, target.token)
  if (actualValue !== value) {
    throw new Error(
      `Browser Use expected filled value "${value}", but found "${actualValue ?? ''}".`
    )
  }
  await expectAction(sessionKey, expectation)
  const state = await getCurrentPageState(sessionKey)
  return {
    ok: true,
    ...state,
    postActionSummary: expectation ? null : await getPostActionSummary(sessionKey)
  }
}

export async function browserUseWaitFor(
  sessionKey: string,
  condition:
    | { type: 'selectorVisible'; selector: BrowserUseSelector }
    | { type: 'selectorHidden'; selector: BrowserUseSelector }
    | { type: 'textVisible'; value: string }
    | { type: 'urlContains'; value: string }
    | { type: 'loadState' },
  options: BrowserUseWaitOptions = {}
): Promise<BrowserUseActionResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const startedAt = Date.now()
  let lastError: unknown = null
  let matched = false

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      if (condition.type === 'selectorVisible') {
        const result = await resolveLocatorCandidates(sessionKey, condition.selector)
        if (result.nodes.some((node) => node.visible)) {
          matched = true
          break
        }
      } else if (condition.type === 'selectorHidden') {
        const result = await resolveLocatorCandidates(sessionKey, condition.selector)
        if (!result.nodes.some((node) => node.visible)) {
          matched = true
          break
        }
      } else if (condition.type === 'textVisible') {
        const result = await resolveLocatorCandidates(sessionKey, {
          type: 'text',
          value: condition.value
        })
        if (result.nodes.some((node) => node.visible)) {
          matched = true
          break
        }
      } else if (condition.type === 'urlContains') {
        const state = await getCurrentPageState(sessionKey)
        if (state.url.includes(condition.value)) {
          matched = true
          break
        }
      } else {
        await waitForBrowserNavigation(sessionKey, { timeoutMs: Math.min(timeoutMs, 1_000) })
        matched = true
        break
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  if (!matched) {
    const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : ''
    throw new Error(`Browser Use wait timed out after ${timeoutMs}ms.${detail}`)
  }

  const state = await getCurrentPageState(sessionKey)
  return {
    ok: true,
    ...state,
    postActionSummary: await getPostActionSummary(sessionKey)
  }
}
