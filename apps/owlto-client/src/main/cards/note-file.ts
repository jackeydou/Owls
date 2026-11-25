import { createHash } from 'node:crypto'
import { Document, isSeq, parse } from 'yaml'
import { type Card, type CardSource, cardSourceSchema } from '../../shared/cards.js'

/** The parts of a note its Markdown file holds. The index keeps `rev` and `status`. */
export type NoteFields = Pick<
  Card,
  'title' | 'body' | 'tags' | 'projectId' | 'source' | 'createdAt' | 'updatedAt'
>
/** A note file as read from disk. Every field may be missing in a file the user wrote. */
export type ParsedNote = {
  id: string | null
  title: string | null
  body: string
  tags: string[]
  projectId: string | null
  source: CardSource | null
  createdAt: string | null
  updatedAt: string | null
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
/** Ids the app hands out, and the only ones it accepts from a file. */
export const NOTE_ID = /^c_[0-9a-z]{1,40}$/
const STEM_LIMIT = 80

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null
const time = (value: unknown): string | null => {
  const raw = value instanceof Date ? value.toISOString() : text(value)
  return raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null
}
/** Same rules as a saved card's tags: trimmed, deduplicated, sorted. */
const tagList = (value: unknown): string[] => {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const tags = list
    .map((tag) => (typeof tag === 'string' || typeof tag === 'number' ? String(tag).trim() : ''))
    .filter(Boolean)
  return [...new Set(tags)].sort((a, b) => a.localeCompare(b))
}

/**
 * Reads a note file: YAML frontmatter for its metadata, then the Markdown body.
 * A file with no frontmatter, or frontmatter that does not parse, is all body.
 */
export function parseNote(content: string): ParsedNote {
  const match = FRONTMATTER.exec(content)
  let meta: Record<string, unknown> = {}
  if (match) {
    try {
      const value: unknown = parse(match[1] ?? '')
      if (value && typeof value === 'object' && !Array.isArray(value))
        meta = value as Record<string, unknown>
    } catch {
      meta = {}
    }
  }
  const id = text(meta.id)
  const source = cardSourceSchema.safeParse(meta.source)
  return {
    id: id && NOTE_ID.test(id) ? id : null,
    title: text(meta.title),
    body: match ? content.slice(match[0].length) : content,
    tags: tagList(meta.tags),
    projectId: text(meta.project),
    source: source.success ? source.data : null,
    createdAt: time(meta.created),
    updatedAt: time(meta.updated)
  }
}

/**
 * Writes a note file. Keys come in a fixed order and empty ones are left out,
 * so a file only changes where the note does.
 */
export function serializeNote(id: string, note: NoteFields): string {
  const meta: Record<string, unknown> = { id, title: note.title }
  if (note.tags.length) meta.tags = note.tags
  if (note.projectId) meta.project = note.projectId
  if (note.source) meta.source = note.source
  meta.created = note.createdAt
  meta.updated = note.updatedAt
  const doc = new Document(meta)
  const tags = doc.get('tags', true)
  if (isSeq(tags)) tags.flow = true
  const yaml = doc.toString({ lineWidth: 0 })
  return `---\n${yaml}---\n${note.body}`
}

/**
 * Gives a note file the id `id` and changes nothing else, so every device that
 * fixes the same file writes the same bytes. Frontmatter that does not parse is
 * left in the body, as `parseNote` reads it.
 */
export function withNoteId(content: string, id: string): string {
  const match = FRONTMATTER.exec(content)
  if (!match || !readsAsMap(match[1] ?? '')) return `---\nid: ${id}\n---\n${content}`
  const lines = (match[1] ?? '').split(/\r?\n/).filter((line) => !/^id[ \t]*:/.test(line))
  return `---\n${[`id: ${id}`, ...lines].join('\n')}\n---\n${content.slice(match[0].length)}`
}

function readsAsMap(yaml: string): boolean {
  try {
    const value: unknown = parse(yaml)
    return value === null || (typeof value === 'object' && !Array.isArray(value))
  } catch {
    return false
  }
}

/**
 * The id a note file gets when it has none, or shares one with another file: the
 * same on every device that reads the file, so two devices fixing it at once do
 * not write two ids.
 */
export function derivedNoteId(name: string, id: string | null): string {
  const digest = createHash('sha256').update(`${id ?? ''}\n${name.normalize('NFC')}`)
  return `c_${digest.digest('hex').slice(0, 12)}`
}

/**
 * A file name for a note title: characters file systems reject become spaces,
 * and the name is kept short. Two notes may share a stem; see `uniqueName`.
 */
export function fileStem(title: string): string {
  const cleaned = title
    .normalize('NFC')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are not allowed in file names.
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
  const short = [...cleaned].slice(0, STEM_LIMIT).join('').trim()
  return short || 'Untitled'
}

/** `<stem>.md`, or `<stem> 2.md` and so on when the name is taken. Case-insensitive, as macOS is. */
export function uniqueName(stem: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${stem}.md` : `${stem} ${n}.md`
    if (!taken.has(name.toLowerCase())) return name
  }
}
