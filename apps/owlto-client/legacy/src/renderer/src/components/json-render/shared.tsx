const MAX_TEXT_LENGTH = 20_000

export const TONES = ['default', 'info', 'warning', 'danger', 'success'] as const
export const FORMATS = ['text', 'code', 'path', 'json', 'url'] as const

export type Tone = (typeof TONES)[number]
export type Format = (typeof FORMATS)[number]

export type TableColumn = {
  label: string
  path?: string
  key?: string
  format?: Format
}

export type KeyValueItem = {
  label: string
  value: unknown
  format?: Format
}

export type ChoiceItem = {
  label: string
  value: string
  checked?: boolean
  pressed?: boolean
  disabled?: boolean
}

export function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, MAX_TEXT_LENGTH)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value)
  }
  try {
    return JSON.stringify(value, null, 2).slice(0, MAX_TEXT_LENGTH)
  } catch {
    return String(value).slice(0, MAX_TEXT_LENGTH)
  }
}

export function getPathValue(value: unknown, path: string | undefined): unknown {
  if (!path) return value
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!segment) return current
    if (typeof current !== 'object' || current === null) return undefined
    if (Array.isArray(current) && /^\\d+$/.test(segment)) return current[Number(segment)]
    return (current as Record<string, unknown>)[segment]
  }, value)
}

export function toneClass(tone: Tone | undefined): string {
  if (tone === 'danger') return 'border-red-500/30 bg-red-500/8 text-red-700 dark:text-red-300'
  if (tone === 'warning') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  if (tone === 'success') {
    return 'border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300'
  }
  if (tone === 'info') return 'border-sky-500/30 bg-sky-500/8 text-sky-700 dark:text-sky-300'
  return 'border-border/70 bg-foreground/5 text-foreground/85'
}

export function formatClass(format: Format | undefined): string {
  if (format === 'code' || format === 'json') {
    return 'whitespace-pre-wrap font-mono text-[11.5px] leading-5'
  }
  if (format === 'path' || format === 'url') return 'break-all font-mono text-[12px]'
  return 'text-[12.5px] leading-5'
}

export function safeImageSrc(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.startsWith('data:image/')) return trimmed
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' || url.protocol === 'http:' ? trimmed : null
  } catch {
    return null
  }
}

export function safeLinkHref(value: string): string | null {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' || url.protocol === 'http:' ? trimmed : null
  } catch {
    return null
  }
}

export function JsonTreeView({
  value,
  depth,
  defaultExpandedDepth
}: {
  value: unknown
  depth: number
  defaultExpandedDepth: number
}): React.JSX.Element {
  if (typeof value !== 'object' || value === null) {
    return <span className="text-foreground/90">{stringifyValue(value)}</span>
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>)
  const defaultOpen = depth < defaultExpandedDepth

  return (
    <details open={defaultOpen} className="group">
      <summary className="cursor-pointer select-none text-[12px] text-muted-foreground">
        {Array.isArray(value) ? `Array(${entries.length})` : `Object(${entries.length})`}
      </summary>
      <div className="mt-1 space-y-1 border-border/60 border-l pl-3">
        {entries.map(([key, entryValue]) => (
          <div key={key} className="grid grid-cols-[minmax(80px,160px)_1fr] gap-2">
            <span className="truncate font-mono text-[11.5px] text-muted-foreground">{key}</span>
            <div className="min-w-0 font-mono text-[11.5px] leading-5">
              <JsonTreeView
                value={entryValue}
                depth={depth + 1}
                defaultExpandedDepth={defaultExpandedDepth}
              />
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}
