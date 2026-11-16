import { groupByFamily } from '@renderer/lib/model-families'
import { cn } from '@renderer/lib/utils'
import { type ReactNode, useState } from 'react'
import { ChevronRightIcon, PlusIcon, SearchIcon } from './icons'
import { type RankedItem, RankedList, type RankedListCopy } from './ranked-list'

export type RankedPickerCopy = RankedListCopy & {
  /** Shown when nothing is picked yet. */
  empty: string
  /** Names the fold that holds the unpicked choices, e.g. "More models". */
  more: string
  search: string
  noMatch: string
  /** Names a variant chip whose model has no variant words. */
  standard: string
  add(label: string): string
}

type ChipRow = {
  key: string
  family: string | null
  chips: Array<{ item: RankedItem; label: string }>
}

/**
 * Families with several models get a labeled row of variant chips; runs of one-model
 * families share one unlabeled row of full-name chips, so they do not take a line each.
 */
function packSingles(
  groups: ReturnType<typeof groupByFamily<RankedItem>>,
  standard: string
): ChipRow[] {
  const rows: ChipRow[] = []
  for (const group of groups) {
    if (group.items.length > 1) {
      rows.push({
        key: group.family,
        family: group.family,
        chips: group.items.map(({ item, variant }) => ({ item, label: variant || standard }))
      })
      continue
    }
    const item = group.items[0].item
    const last = rows.at(-1)
    if (last && last.family === null) last.chips.push({ item, label: item.label })
    else
      rows.push({ key: `singles:${item.id}`, family: null, chips: [{ item, label: item.label }] })
  }
  return rows
}

/** Above this many unpicked choices the fold gets a search field. */
const SEARCH_THRESHOLD = 8

/**
 * A long list of choices split in two: the picked ones as a short list the user drags into
 * order, and the rest folded below, grouped by model family as chips that add a choice to
 * the end of the order. Every change hands back the whole list, picked entries first.
 */
export function RankedPicker({
  header,
  items,
  copy,
  onChange,
  className
}: {
  header?: ReactNode
  items: RankedItem[]
  copy: RankedPickerCopy
  onChange(items: RankedItem[]): void
  className?: string
}) {
  const picked = items.filter((i) => i.on)
  const rest = items.filter((i) => !i.on)
  const [open, setOpen] = useState(() => picked.length === 0 || rest.length <= SEARCH_THRESHOLD)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? rest.filter((i) => `${i.label} ${i.id}`.toLowerCase().includes(needle))
    : rest
  const groups = packSingles(
    groupByFamily(shown, (i) => i.label),
    copy.standard
  )
  function add(item: RankedItem) {
    onChange([...picked, { ...item, on: true }, ...rest.filter((i) => i.id !== item.id)])
  }
  return (
    <div className={cn('owlto-ranked-list owlto-ranked-picker', className)}>
      {header ? <div className="owlto-ranked-header">{header}</div> : null}
      {picked.length ? (
        <RankedList
          numbered
          items={picked}
          copy={copy}
          onChange={(next) =>
            onChange([...next.filter((i) => i.on), ...next.filter((i) => !i.on), ...rest])
          }
        />
      ) : (
        <p className="owlto-ranked-empty">{copy.empty}</p>
      )}
      {rest.length ? (
        <div className="owlto-picker-more">
          <button
            type="button"
            className="owlto-picker-toggle"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <ChevronRightIcon size={14} className="owlto-picker-chevron" />
            <span>{copy.more}</span>
            <small>{rest.length}</small>
          </button>
          {open ? (
            <div className="owlto-picker-body">
              {rest.length > SEARCH_THRESHOLD ? (
                <label className="owlto-picker-search">
                  <SearchIcon size={14} aria-hidden />
                  <input
                    type="search"
                    aria-label={copy.search}
                    placeholder={copy.search}
                    maxLength={100}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              ) : null}
              {groups.length ? (
                <ul className="owlto-picker-groups">
                  {groups.map((row) => (
                    <li key={row.key} className="owlto-picker-group">
                      {row.family ? (
                        <span className="owlto-picker-family">{row.family}</span>
                      ) : null}
                      <span className="owlto-picker-chips">
                        {row.chips.map(({ item, label }) => (
                          <button
                            key={item.id}
                            type="button"
                            className="owlto-picker-chip"
                            aria-label={copy.add(item.label)}
                            onClick={() => add(item)}
                          >
                            <PlusIcon size={11} aria-hidden />
                            {label}
                          </button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="owlto-ranked-empty">{copy.noMatch}</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
