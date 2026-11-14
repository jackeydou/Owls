import type { SessionItem, ThreadItem } from '../../shared/app.js'

/**
 * One thread's items in memory, loaded the first time the thread is used. An
 * item keeps its position when it changes, so streaming replaces it in place.
 */
export class ThreadLog {
  private readonly entries: ThreadItem[]
  private readonly index = new Map<string, ThreadItem>()

  constructor(entries: ThreadItem[]) {
    this.entries = [...entries].sort((a, b) => a.position - b.position)
    for (const entry of this.entries) this.index.set(entry.item.id, entry)
  }

  get length(): number {
    return this.entries.length
  }
  get(id: string): ThreadItem | undefined {
    return this.index.get(id)
  }
  /** Inserts or replaces the item with the same id. Its `rev` is unset until it is saved. */
  put(item: SessionItem): ThreadItem {
    const existing = this.index.get(item.id)
    if (existing) {
      existing.item = item
      existing.rev = null
      return existing
    }
    const position = (this.entries.at(-1)?.position ?? -1) + 1
    const entry: ThreadItem = { item, position, rev: null }
    this.entries.push(entry)
    this.index.set(item.id, entry)
    return entry
  }
  running(): SessionItem[] {
    return this.entries.filter((e) => e.item.status === 'running').map((e) => e.item)
  }
  /** Items changed after `rev`, with unsaved ones, in position order. */
  after(rev: number): ThreadItem[] {
    return this.entries.filter((e) => e.rev === null || e.rev > rev).map((e) => ({ ...e }))
  }
}
