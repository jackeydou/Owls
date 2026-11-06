export type JsonRenderPrimitive = string | number | boolean | null

export type JsonRenderValue =
  | JsonRenderPrimitive
  | JsonRenderValue[]
  | { [key: string]: JsonRenderValue }

export type JsonRenderState = Record<string, JsonRenderValue>

export type JsonRenderStateSource = JsonRenderState | string

export type JsonRenderDocument = {
  renderer: 'json-render'
  spec: unknown
  state_source?: JsonRenderStateSource
}

export type JsonRenderSpecElement = {
  type: string
  props?: Record<string, unknown>
  children?: string[]
}

export type JsonRenderSpecLike = {
  root: string
  elements: Record<string, JsonRenderSpecElement>
}

export function isJsonRenderValue(
  value: unknown,
  seen = new WeakSet<object>()
): value is JsonRenderValue {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return true
  if (typeof value !== 'object') return false
  const objectValue = value
  if (seen.has(objectValue)) return false
  seen.add(objectValue)
  if (Array.isArray(value)) {
    return value.every((item) => isJsonRenderValue(item, seen))
  }
  return Object.values(value as Record<string, unknown>).every((item) =>
    isJsonRenderValue(item, seen)
  )
}

export function isJsonRenderState(value: unknown): value is JsonRenderState {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && isJsonRenderValue(value)
  )
}

export function isJsonRenderDocument(value: unknown): value is JsonRenderDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { renderer?: unknown }).renderer === 'json-render' &&
    'spec' in value &&
    (!('state_source' in value) ||
      typeof (value as { state_source?: unknown }).state_source === 'string' ||
      isJsonRenderState((value as { state_source?: unknown }).state_source))
  )
}

export function isJsonRenderSpecLike(value: unknown): value is JsonRenderSpecLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { root?: unknown }).root === 'string' &&
    typeof (value as { elements?: unknown }).elements === 'object' &&
    (value as { elements?: unknown }).elements !== null &&
    !Array.isArray((value as { elements?: unknown }).elements)
  )
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}

function resolveJsonPointer(state: JsonRenderState, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return state
  if (!pointer.startsWith('/')) return undefined
  let current: unknown = state
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = decodePointerSegment(rawSegment)
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
      continue
    }
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function resolveTextValue(value: unknown, state: JsonRenderState): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { $state?: unknown }).$state === 'string'
  ) {
    return resolveTextValue(resolveJsonPointer(state, (value as { $state: string }).$state), state)
  }
  return null
}

function valueLength(value: unknown, state: JsonRenderState): number | null {
  const resolved =
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { $state?: unknown }).$state === 'string'
      ? resolveJsonPointer(state, (value as { $state: string }).$state)
      : value
  return Array.isArray(resolved) ? resolved.length : null
}

function propText(
  props: Record<string, unknown> | undefined,
  state: JsonRenderState,
  names: string[]
): string[] {
  if (!props) return []
  return names
    .map((name) => resolveTextValue(props[name], state))
    .filter((value): value is string => Boolean(value))
}

function summarizeElement(element: JsonRenderSpecElement, state: JsonRenderState): string {
  const props = element.props
  const readable = propText(props, state, [
    'title',
    'text',
    'description',
    'body',
    'label',
    'value'
  ])
  const parts: string[] = []
  if (readable.length) parts.push(readable.slice(0, 3).join(' - '))

  if (props && element.type === 'KeyValue') {
    const items =
      typeof props.items === 'object' &&
      props.items !== null &&
      !Array.isArray(props.items) &&
      typeof (props.items as { $state?: unknown }).$state === 'string'
        ? resolveJsonPointer(state, (props.items as { $state: string }).$state)
        : props.items
    if (Array.isArray(items)) {
      const labels = items
        .slice(0, 4)
        .map((item) => {
          if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
          const record = item as Record<string, unknown>
          const label = resolveTextValue(record.label, state)
          const value = resolveTextValue(record.value, state)
          return label && value ? `${label}=${value}` : label
        })
        .filter((item): item is string => Boolean(item))
      if (labels.length) parts.push(labels.join('; '))
    }
  }

  if (props && element.type === 'DataTable' && Array.isArray(props.columns)) {
    const columns = props.columns
      .slice(0, 6)
      .map((column) => {
        if (typeof column !== 'object' || column === null || Array.isArray(column)) return null
        return resolveTextValue((column as Record<string, unknown>).label, state)
      })
      .filter((item): item is string => Boolean(item))
    const rows = valueLength(props.rows ?? props.data, state)
    const summary = [
      columns.length ? `columns=${columns.join(', ')}` : null,
      rows ? `rows=${rows}` : null
    ]
      .filter(Boolean)
      .join('; ')
    if (summary) parts.push(summary)
  }

  return parts.length ? `${element.type}: ${parts.join(' | ')}` : element.type
}

export function jsonRenderDocumentToTextTree(
  document: JsonRenderDocument,
  state: JsonRenderState = {},
  options: { maxLines?: number; maxChars?: number } = {}
): string {
  const spec = document.spec
  if (!isJsonRenderSpecLike(spec)) return 'Invalid json-render document'
  const maxLines = options.maxLines ?? 80
  const maxChars = options.maxChars ?? 4096
  const lines: string[] = []
  const visited = new Set<string>()

  const visit = (elementId: string, depth: number): void => {
    if (lines.length >= maxLines) return
    if (visited.has(elementId)) return
    visited.add(elementId)
    const element = spec.elements[elementId]
    if (!element) return
    lines.push(`${'  '.repeat(depth)}${summarizeElement(element, state)}`)
    for (const childId of element.children ?? []) {
      visit(childId, depth + 1)
    }
  }

  visit(spec.root, 0)
  let text = lines.join('\n')
  if (lines.length >= maxLines) text = `${text}\n...`
  if (text.length > maxChars) return `${text.slice(0, maxChars - 4)}\n...`
  return text || 'Empty json-render document'
}
