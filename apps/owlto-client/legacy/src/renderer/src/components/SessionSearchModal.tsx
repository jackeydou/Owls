import { type I18nKey, useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { Loader2, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSearchResult } from '../../../preload/index.d'

type SessionSearchModalProps = {
  open: boolean
  onClose: () => void
  onSelectSession: (sessionId: string) => void
}

function formatResultTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function roleLabel(role: SessionSearchResult['role'], t: (key: I18nKey) => string): string {
  if (role === 'session') return t('search.role.title')
  if (role === 'tool') return t('search.role.tool')
  if (role === 'user') return t('search.role.user')
  if (role === 'assistant') return t('search.role.assistant')
  if (role === 'system') return t('search.role.system')
  return role
}

function HighlightedSnippet({
  text,
  highlights
}: {
  text: string
  highlights: SessionSearchResult['highlights']
}): React.JSX.Element {
  if (highlights.length === 0) {
    return <>{text}</>
  }

  const nodes: React.ReactNode[] = []
  let cursor = 0

  highlights.forEach((range) => {
    if (range.start > cursor) {
      nodes.push(text.slice(cursor, range.start))
    }
    nodes.push(
      <mark
        key={`${range.start}-${range.end}`}
        className="rounded bg-accent/20 px-0.5 text-accent-foreground"
      >
        {text.slice(range.start, range.end)}
      </mark>
    )
    cursor = range.end
  })

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return <>{nodes}</>
}

export function SessionSearchModal({
  open,
  onClose,
  onSelectSession
}: SessionSearchModalProps): React.JSX.Element | null {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SessionSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const trimmedQuery = query.trim()
  const canSearch = trimmedQuery.length >= 2
  const activeResult = results[activeIndex]

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setError(null)
    setActiveIndex(0)
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!canSearch) {
      setResults([])
      setLoading(false)
      setError(null)
      setActiveIndex(0)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    const id = window.setTimeout(() => {
      void window.api.messages
        .search({ text: trimmedQuery, limit: 50 })
        .then((nextResults) => {
          if (cancelled) return
          setResults(nextResults)
          setActiveIndex(0)
        })
        .catch((err) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : String(err))
          setResults([])
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false)
          }
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [canSearch, open, trimmedQuery])

  const groupedResultCount = useMemo(() => {
    return new Set(results.map((result) => result.sessionId)).size
  }, [results])

  if (!open) return null

  const selectResult = (result: SessionSearchResult | undefined) => {
    if (!result) return
    onSelectSession(result.sessionId)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('search.aria')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex max-h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
                return
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(index + 1, Math.max(0, results.length - 1)))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(0, index - 1))
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                selectResult(activeResult)
              }
            }}
            placeholder={t('search.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          {loading ? (
            <Loader2
              className="size-4 shrink-0 animate-spin text-muted-foreground"
              strokeWidth={1.8}
            />
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground"
            aria-label={t('search.close')}
          >
            <X className="size-4" strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
          {!canSearch ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {t('search.minChars')}
            </div>
          ) : error ? (
            <div className="px-4 py-12 text-center text-sm text-destructive">{error}</div>
          ) : !loading && results.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {t('search.noMatches')}
            </div>
          ) : (
            <>
              <div className="px-2 pb-2 text-[11px] text-muted-foreground">
                {t('search.matchSummary', {
                  matches: results.length,
                  sessions: groupedResultCount
                })}
              </div>
              <div className="flex flex-col gap-1">
                {results.map((result, index) => (
                  <button
                    key={`${result.sessionId}-${result.messageId ?? 'session'}`}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectResult(result)}
                    className={cn(
                      'rounded-xl px-3 py-2.5 text-left transition',
                      index === activeIndex
                        ? 'bg-sidebar-active text-foreground'
                        : 'hover:bg-sidebar-hover'
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                        {result.title || result.sessionId.slice(0, 16)}
                      </span>
                      <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                        {roleLabel(result.role, t)}
                      </span>
                    </div>
                    <div className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                      <HighlightedSnippet text={result.snippet} highlights={result.highlights} />
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground/60">
                      {formatResultTime(result.messageCreatedAt || result.sessionUpdatedAt)}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
