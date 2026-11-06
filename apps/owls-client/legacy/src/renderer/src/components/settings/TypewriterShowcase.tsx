import { Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

export type TypewriterShowcaseItem = {
  id: string
  kind: 'plugin' | 'skill'
  token: string
  label: string
  body: string
  iconSrc?: string
}

function ShowcaseChip({ item }: { item: TypewriterShowcaseItem }) {
  return (
    <span className="inline-flex h-6 max-w-48 shrink-0 items-center gap-1.5 rounded-md bg-white/65 px-2 text-[12px] font-semibold leading-none text-foreground dark:bg-white/10 dark:text-white/60">
      {item.kind === 'plugin' && item.iconSrc ? (
        <img src={item.iconSrc} alt="" className="size-3.5 rounded-sm object-cover" />
      ) : item.kind === 'skill' ? (
        <Sparkles className="size-3.5 text-muted-foreground/70" strokeWidth={1.8} aria-hidden />
      ) : (
        <span className="text-[11px] text-muted-foreground/70">@plugin</span>
      )}
      <span className="truncate">{item.label}</span>
    </span>
  )
}

function carouselIndicatorIndexes(count: number, activeIndex: number): number[] {
  if (count <= 5) return Array.from({ length: count }, (_, index) => index)
  if (activeIndex <= 2) return [0, 1, 2, 3, count - 1]
  if (activeIndex >= count - 3) return [0, count - 4, count - 3, count - 2, count - 1]
  return [0, activeIndex - 1, activeIndex, activeIndex + 1, count - 1]
}

export function TypewriterShowcase({
  items,
  actionLabel,
  actionDisabled,
  onAction,
  variant = 'carousel'
}: {
  items: TypewriterShowcaseItem[]
  actionLabel?: string
  actionDisabled?: boolean | ((item: TypewriterShowcaseItem) => boolean)
  onAction?: (item: TypewriterShowcaseItem) => void
  variant?: 'carousel' | 'stack'
}) {
  const demoItems = useMemo(() => items.filter((item) => item.token && item.body), [items])
  const [activeIndex, setActiveIndex] = useState(0)
  const normalizedActiveIndex = demoItems.length ? activeIndex % demoItems.length : 0
  const indicatorIndexes = carouselIndicatorIndexes(demoItems.length, normalizedActiveIndex)
  const item = demoItems[normalizedActiveIndex]
  const currentActionDisabled =
    typeof actionDisabled === 'function' ? (item ? actionDisabled(item) : true) : actionDisabled

  useEffect(() => {
    if (variant !== 'carousel') return
    if (demoItems.length <= 1) return
    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % demoItems.length)
    }, 4200)
    return () => window.clearInterval(interval)
  }, [demoItems.length, variant])

  if (!item) {
    return (
      <div className="relative mt-6 h-44 overflow-hidden rounded-3xl border border-border/60 bg-linear-to-br from-sky-100 via-violet-100 to-fuchsia-100 shadow-sm dark:from-slate-900 dark:via-indigo-950/70 dark:to-zinc-900">
        <div className="relative flex h-full items-center justify-center px-6 py-8 text-center">
          <div>
            <Sparkles className="mx-auto size-6 text-muted-foreground" strokeWidth={1.8} />
            <div className="mt-2 text-[13px] font-medium text-foreground">
              Nothing to preview yet
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (variant === 'stack') {
    return (
      <div className="relative mt-6 h-60 overflow-hidden rounded-3xl border border-border/60 bg-linear-to-br from-sky-100 via-violet-100 to-fuchsia-100 shadow-sm dark:from-slate-900 dark:via-indigo-950/70 dark:to-zinc-900">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.75),transparent_34%),radial-gradient(circle_at_70%_65%,rgba(255,255,255,0.45),transparent_30%)] dark:bg-[radial-gradient(circle_at_30%_20%,rgba(96,165,250,0.24),transparent_34%),radial-gradient(circle_at_70%_65%,rgba(168,85,247,0.2),transparent_30%)]" />
        <div className="relative flex h-full flex-col items-center justify-center gap-4 px-6 py-8">
          {demoItems.slice(0, 3).map((demoItem, index) => (
            <div key={demoItem.id} className="flex w-full justify-center">
              <div
                className="inline-flex max-w-[86%] items-center gap-2 rounded-2xl bg-white/58 px-4 py-2.5 text-[15px] leading-6 text-foreground dark:bg-black/32 dark:text-white"
                style={{
                  transform: `translateX(${index === 1 ? -28 : index === 2 ? 22 : 0}px)`
                }}
              >
                <ShowcaseChip item={demoItem} />
                <span className="min-w-0 truncate">{demoItem.body}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="relative mt-6 h-44 overflow-hidden rounded-3xl border border-border/60 bg-linear-to-br from-sky-100 via-violet-100 to-fuchsia-100 shadow-sm dark:from-slate-900 dark:via-indigo-950/70 dark:to-zinc-900">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.75),transparent_34%),radial-gradient(circle_at_70%_65%,rgba(255,255,255,0.45),transparent_30%)] dark:bg-[radial-gradient(circle_at_30%_20%,rgba(96,165,250,0.24),transparent_34%),radial-gradient(circle_at_70%_65%,rgba(168,85,247,0.2),transparent_30%)]" />
      <div className="absolute right-5 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2">
        {indicatorIndexes.map((index) => (
          <button
            key={demoItems[index].id}
            type="button"
            aria-label={demoItems[index].label}
            className={`size-1.5 rounded-full transition ${
              index === normalizedActiveIndex
                ? 'bg-foreground'
                : 'bg-foreground/25 hover:bg-foreground/45 dark:bg-white/25 dark:hover:bg-white/45'
            }`}
            onClick={() => setActiveIndex(index)}
          />
        ))}
      </div>
      <div className="relative flex h-full flex-col items-center justify-center px-6 py-8">
        <div className="relative h-14 w-full max-w-2xl overflow-hidden">
          <div
            className="flex flex-col transition-transform duration-500 ease-out"
            style={{ transform: `translateY(-${normalizedActiveIndex * 3.5}rem)` }}
          >
            {demoItems.map((demoItem) => (
              <div
                key={demoItem.id}
                className="flex h-14 items-center justify-center px-8 text-center"
              >
                <div className="inline-flex max-w-full items-center gap-2 rounded-2xl bg-white/58 px-4 py-2.5 text-[15px] leading-6 text-foreground dark:bg-black/32 dark:text-white">
                  <ShowcaseChip item={demoItem} />
                  <span className="min-w-0 truncate">{demoItem.body}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            disabled={currentActionDisabled}
            className="mt-5 rounded-full bg-foreground px-4 py-2 text-[12px] font-semibold text-accent-foreground shadow-sm transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => onAction(item)}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}
