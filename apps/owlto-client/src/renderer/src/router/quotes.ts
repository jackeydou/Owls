import { create } from 'zustand'

/** A passage of the thread the user quoted, with an optional note on it, waiting in the draft. */
export type DraftQuote = { id: string; text: string; note: string }

/** Characters kept from one selection; a message has an 8000-character budget in all. */
export const QUOTE_LIMIT = 1200
export const QUOTE_NOTE_LIMIT = 300
/** Quotes one message can carry. */
export const DRAFT_QUOTE_LIMIT = 4

type QuoteState = {
  /** Each thread's quotes, in the order they were added. */
  byThread: Record<string, DraftQuote[]>
  /** Returns false when the thread already carries the most quotes a message can take. */
  add(threadId: string, text: string, note: string): boolean
  remove(threadId: string, quoteId: string): void
  clear(threadId: string): void
}

const NONE: DraftQuote[] = []

export const useQuoteStore = create<QuoteState>((set, get) => ({
  byThread: {},
  add: (threadId, text, note) => {
    const list = get().byThread[threadId] ?? NONE
    if (list.length >= DRAFT_QUOTE_LIMIT) return false
    const quote = {
      id: crypto.randomUUID(),
      text: text.slice(0, QUOTE_LIMIT),
      note: note.trim().slice(0, QUOTE_NOTE_LIMIT)
    }
    set((s) => ({ byThread: { ...s.byThread, [threadId]: [...list, quote] } }))
    return true
  },
  remove: (threadId, quoteId) =>
    set((s) => ({
      byThread: {
        ...s.byThread,
        [threadId]: (s.byThread[threadId] ?? NONE).filter((q) => q.id !== quoteId)
      }
    })),
  clear: (threadId) =>
    set((s) => {
      if (!s.byThread[threadId]) return s
      const { [threadId]: _, ...rest } = s.byThread
      return { byThread: rest }
    })
}))

export const useThreadQuotes = (threadId: string | undefined): DraftQuote[] =>
  useQuoteStore((s) => (threadId ? (s.byThread[threadId] ?? NONE) : NONE))

/**
 * The message as sent: each quote as a Markdown blockquote with its note under it, then the
 * user's text. Agents read the quote as plain Markdown, and the thread shows it as a quote.
 */
export function withQuotes(quotes: DraftQuote[], message: string): string {
  const parts = quotes.map((quote) => {
    const block = quote.text
      .split('\n')
      .map((line) => (line.trim() ? `> ${line}` : '>'))
      .join('\n')
    return quote.note ? `${block}\n\n${quote.note}` : block
  })
  if (message) parts.push(message)
  return parts.join('\n\n')
}

export type MessagePart = { kind: 'quote' | 'text'; text: string }

/** Splits a user's message into its quoted blocks (lines starting with `>`) and plain text. */
export function messageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = []
  for (const line of text.split('\n')) {
    const quoted = /^>\s?(.*)$/.exec(line)
    const kind = quoted ? 'quote' : 'text'
    const body = quoted ? quoted[1] : line
    const last = parts.at(-1)
    if (last?.kind === kind) last.text += `\n${body}`
    else parts.push({ kind, text: body })
  }
  return parts
    .map((part) => ({ ...part, text: part.text.replace(/^\n+|\n+$/g, '') }))
    .filter((part) => part.text.trim())
}
