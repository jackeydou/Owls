import { createHash, randomBytes } from 'node:crypto'
import {
  type FSWatcher,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  type Stats,
  statSync,
  unlinkSync,
  watch,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { type Board, boardSchema, type Card, cardSchema } from '../../shared/cards.js'
import { boardsTable, noteFilesTable } from '../app/schema.js'
import type { OwltoStore } from '../app/store.js'
import { nextRev } from '../app/sync-state.js'
import { logChange } from '../sync/sync-log.js'
import {
  derivedNoteId,
  fileStem,
  type NoteFields,
  type ParsedNote,
  parseNote,
  serializeNote,
  uniqueName,
  withNoteId
} from './note-file.js'

type Tx = Pick<OwltoStore['db'], 'insert'>
type Unsaved<T> = Omit<T, 'rev'>
type IndexRow = typeof noteFilesTable.$inferSelect
/** A live note: the card it reads as, its file, and the file's state when last read. */
type Entry = { card: Card; file: string; mtimeMs: number; size: number }

const newNoteId = () => `c_${randomBytes(6).toString('hex')}`
const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')
/** How long the folder must stay quiet before an edit made elsewhere is read. */
const WATCH_SETTLE_MS = 150
/** iCloud keeps a note it has not downloaded as a hidden `.<name>.icloud` placeholder. */
export const PLACEHOLDER = /^\.(.+\.md)\.icloud$/i

/**
 * Notes and boards. Each note is a Markdown file in the notes folder, with its
 * metadata in YAML frontmatter, so other editors and git can use it. `owlto.db`
 * keeps only an index of those files (id, file name, change version, content
 * hash) plus the boards. The folder is the source of truth: files added,
 * edited, renamed, or deleted elsewhere are picked up on the next read.
 *
 * The folder may be synced (iCloud Drive, Dropbox, git). A file that is there
 * but cannot be read yet, such as an iCloud placeholder, is kept as it was, never
 * read as deleted, and every device gives a file that needs an id the same one.
 */
export class CardStore {
  /** Live notes by id, as of the last scan. */
  private readonly entries = new Map<string, Entry>()
  constructor(
    private readonly store: OwltoStore,
    private notesFolder: string,
    private readonly now: () => Date = () => new Date()
  ) {}
  /** The folder holding one Markdown file per note. */
  get folder(): string {
    return this.notesFolder
  }
  /**
   * Reads notes from `folder` from now on. The index stays: a note whose file moved along
   * keeps its id, its version, and its board places.
   */
  relocate(folder: string): void {
    this.notesFolder = folder
    this.entries.clear()
  }
  private get db() {
    return this.store.db
  }
  /** Live notes, most recently changed first. */
  cards(): Card[] {
    this.scan()
    return [...this.entries.values()]
      .map((entry) => entry.card)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  }
  /** Live boards, oldest first, so the list keeps its order as boards change. */
  boards(): Board[] {
    return this.db
      .select()
      .from(boardsTable)
      .where(eq(boardsTable.status, 'active'))
      .all()
      .map((row) => boardSchema.parse(row.value))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }
  /** A live note, or null once it is deleted or its file is gone. */
  card(id: string): Card | null {
    this.scan()
    return this.entries.get(id)?.card ?? null
  }
  /** The path of a live note's file. */
  filePath(id: string): string | null {
    this.scan()
    const entry = this.entries.get(id)
    return entry ? join(this.folder, entry.file) : null
  }
  board(id: string): Board | null {
    const row = this.db.select().from(boardsTable).where(eq(boardsTable.id, id)).get()
    return row ? boardSchema.parse(row.value) : null
  }
  /**
   * Writes a note's file, then indexes it. The file is named after the title,
   * and renamed only when the title changes, so a name the user picked stays.
   */
  putCard(card: Unsaved<Card>): Card {
    mkdirSync(this.folder, { recursive: true })
    const previous = this.entries.get(card.id)
    const keepName = previous && fileStem(previous.card.title) === fileStem(card.title)
    const name = keepName
      ? previous.file
      : uniqueName(fileStem(card.title), this.takenNames(previous?.file))
    // Rename first: on a case-insensitive disk a case-only rename is the same file.
    if (previous && previous.file !== name) this.renameFile(previous.file, name)
    const content = serializeNote(card.id, card)
    const stat = this.writeFile(name, content)
    return this.db.transaction((tx) => {
      const rev = nextRev(tx)
      const value = cardSchema.parse({ ...card, status: 'active', rev })
      this.writeIndex(tx, {
        id: value.id,
        rev,
        file: name,
        status: 'active',
        updatedAt: value.updatedAt,
        hash: sha256(content)
      })
      this.entries.set(value.id, {
        card: value,
        file: name,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      })
      return value
    })
  }
  putBoard(board: Unsaved<Board>): Board {
    return this.db.transaction((tx) => this.writeBoard(tx, board))
  }
  /** Deletes a note's file, leaves a tombstone in the index, and saves `boards` without it. */
  deleteCard(id: string, boards: Unsaved<Board>[]): void {
    const entry = this.entries.get(id)
    if (entry) this.removeFile(entry.file)
    this.db.transaction((tx) => {
      this.writeTombstone(tx, id)
      for (const board of boards) this.writeBoard(tx, board)
    })
    this.entries.delete(id)
  }
  /**
   * Reads the notes folder against the index: new and edited files take the next
   * change version, files that are gone become tombstones and leave every board.
   * Only files whose size or modified time changed are read again. Returns true
   * when any note changed.
   */
  scan(): boolean {
    mkdirSync(this.folder, { recursive: true })
    const rows = new Map<string, IndexRow>(
      this.db
        .select()
        .from(noteFilesTable)
        .all()
        .map((row) => [row.id, row])
    )
    const indexed = new Set(
      [...rows.values()].flatMap((row) => (row.status === 'active' && row.file ? [row.file] : []))
    )
    // Files the index knows go first, so a copied file is the one that gets a new id.
    const names = this.noteNames().sort(
      (a, b) => Number(indexed.has(b)) - Number(indexed.has(a)) || a.localeCompare(b)
    )
    const known = new Map([...this.entries.values()].map((entry) => [entry.file, entry]))
    const next = new Map<string, Entry>()
    // Files that exist but cannot be read now; their notes stay as last read.
    const unreadable = new Set(this.placeholderNames())
    let changed = false
    for (const name of names) {
      const path = join(this.folder, name)
      let stat: Stats
      let content: string
      try {
        stat = statSync(path)
        const cached = known.get(name)
        if (
          cached &&
          cached.mtimeMs === stat.mtimeMs &&
          cached.size === stat.size &&
          !next.has(cached.card.id)
        ) {
          next.set(cached.card.id, cached)
          continue
        }
        content = readFileSync(path, 'utf8')
      } catch (error) {
        // A file that went away between listing and reading is gone on the next
        // scan. Any other error (a sync client still downloading it, no network
        // for a file kept only in the cloud) leaves the note as it was.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadable.add(name)
        continue
      }
      const read = this.readNote(name, content, stat, rows, next)
      next.set(read.entry.card.id, read.entry)
      changed ||= read.changed
    }
    for (const name of unreadable) {
      const cached = known.get(name)
      if (cached && !next.has(cached.card.id)) next.set(cached.card.id, cached)
    }
    const gone = [...rows.values()].filter(
      (row) =>
        row.status === 'active' && !next.has(row.id) && !(row.file && unreadable.has(row.file))
    )
    if (gone.length) {
      this.removeNotes(gone.map((row) => row.id))
      changed = true
    }
    this.entries.clear()
    for (const [id, entry] of next) this.entries.set(id, entry)
    return changed
  }
  /**
   * Calls `changed` when files in the notes folder change from outside the app.
   * Returns the function that stops watching.
   */
  watch(changed: () => void): () => void {
    mkdirSync(this.folder, { recursive: true })
    let timer: NodeJS.Timeout | null = null
    let watcher: FSWatcher
    const settle = () => {
      timer = null
      try {
        if (this.scan()) changed()
      } catch (error) {
        console.warn('[notes] could not read the notes folder:', (error as Error).message)
      }
    }
    try {
      watcher = watch(this.folder, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(settle, WATCH_SETTLE_MS)
      })
    } catch (error) {
      console.warn('[notes] could not watch the notes folder:', (error as Error).message)
      return () => {}
    }
    watcher.on('error', (error) => {
      console.warn('[notes] stopped watching the notes folder:', error.message)
    })
    return () => {
      if (timer) clearTimeout(timer)
      watcher.close()
    }
  }
  /**
   * Turns one note file into a card. A file with no usable id (written by hand,
   * or a copy of another note, such as a sync conflict copy) gets one derived
   * from its name, written into its frontmatter with nothing else changed.
   */
  private readNote(
    name: string,
    content: string,
    stat: Stats,
    rows: Map<string, IndexRow>,
    taken: Map<string, Entry>
  ): { entry: Entry; changed: boolean } {
    const parsed = parseNote(content)
    const id = parsed.id && !taken.has(parsed.id) ? parsed.id : this.freshId(name, parsed.id, taken)
    const row = rows.get(id)
    let hash = sha256(content)
    if (row?.status === 'active' && row.file === name && row.hash === hash) {
      const card = cardSchema.parse({
        id,
        ...this.fields(name, parsed, stat, row.updatedAt),
        status: 'active',
        rev: row.rev
      })
      return { entry: { card, file: name, mtimeMs: stat.mtimeMs, size: stat.size }, changed: false }
    }
    const mtime = new Date(stat.mtimeMs).toISOString()
    const updatedAt = row?.hash === hash ? row.updatedAt : row ? mtime : (parsed.updatedAt ?? mtime)
    const fields = this.fields(name, parsed, stat, updatedAt)
    if (id !== parsed.id) {
      const rewritten = withNoteId(content, id)
      stat = this.writeFile(name, rewritten)
      hash = sha256(rewritten)
    }
    const card = this.db.transaction((tx) => {
      const rev = nextRev(tx)
      this.writeIndex(tx, { id, rev, file: name, status: 'active', updatedAt, hash })
      return cardSchema.parse({ id, ...fields, status: 'active', rev })
    })
    return { entry: { card, file: name, mtimeMs: stat.mtimeMs, size: stat.size }, changed: true }
  }
  private freshId(name: string, id: string | null, taken: Map<string, Entry>): string {
    const derived = derivedNoteId(name, id)
    return taken.has(derived) ? newNoteId() : derived
  }
  /** A file's fields, with the file name and times standing in for what it leaves out. */
  private fields(name: string, parsed: ParsedNote, stat: Stats, updatedAt: string): NoteFields {
    const created = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs
    return {
      title: parsed.title ?? basename(name, '.md').trim(),
      body: parsed.body,
      tags: parsed.tags,
      projectId: parsed.projectId,
      source: parsed.source,
      createdAt: parsed.createdAt ?? new Date(created).toISOString(),
      updatedAt
    }
  }
  /**
   * Tombstones notes whose files are gone. Boards keep their places, hidden while
   * the note is gone, so a file that comes back (a sync undo, a restore from the
   * trash) lands where it was.
   */
  private removeNotes(ids: string[]): void {
    this.db.transaction((tx) => {
      for (const id of ids) this.writeTombstone(tx, id)
    })
    for (const id of ids) this.entries.delete(id)
  }
  private writeTombstone(tx: Tx, id: string): void {
    const rev = nextRev(tx)
    const updatedAt = this.now().toISOString()
    this.writeIndex(tx, { id, rev, file: null, status: 'deleted', updatedAt, hash: null })
  }
  private writeIndex(tx: Tx, row: IndexRow): void {
    const { id, ...set } = row
    tx.insert(noteFilesTable)
      .values(row)
      .onConflictDoUpdate({ target: noteFilesTable.id, set })
      .run()
    logChange(tx, 'card', id)
  }
  private writeBoard(tx: Tx, board: Unsaved<Board>): Board {
    const rev = nextRev(tx)
    const value = boardSchema.parse({ ...board, rev })
    const row = { rev, status: value.status, updatedAt: value.updatedAt, value }
    tx.insert(boardsTable)
      .values({ id: value.id, ...row })
      .onConflictDoUpdate({ target: boardsTable.id, set: row })
      .run()
    logChange(tx, 'board', value.id)
    return value
  }
  /** Markdown files directly in the notes folder; hidden files are skipped. */
  private noteNames(): string[] {
    return readdirSync(this.folder, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && !entry.name.startsWith('.') && entry.name.toLowerCase().endsWith('.md')
      )
      .map((entry) => entry.name)
  }
  /** Note files iCloud has not downloaded, by the name they will have. */
  private placeholderNames(): string[] {
    return readdirSync(this.folder).flatMap((name) => {
      const match = PLACEHOLDER.exec(name)
      return match?.[1] ? [match[1]] : []
    })
  }
  /** Every name in the folder, lowercased, except `own`. */
  private takenNames(own: string | undefined): Set<string> {
    // A placeholder holds its note's name, so a new note does not take it.
    const names = [...readdirSync(this.folder), ...this.placeholderNames()]
    const taken = new Set(names.map((name) => name.toLowerCase()))
    if (own) taken.delete(own.toLowerCase())
    return taken
  }
  /** Writes through a hidden temp file, so a reader never sees half a note. */
  private writeFile(name: string, content: string): Stats {
    const path = join(this.folder, name)
    const temp = join(this.folder, `.${randomBytes(6).toString('hex')}.tmp`)
    writeFileSync(temp, content, 'utf8')
    renameSync(temp, path)
    return statSync(path)
  }
  private renameFile(from: string, to: string): void {
    try {
      renameSync(join(this.folder, from), join(this.folder, to))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  private removeFile(name: string): void {
    try {
      unlinkSync(join(this.folder, name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
