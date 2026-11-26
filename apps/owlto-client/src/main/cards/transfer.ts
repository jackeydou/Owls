import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { uniqueName } from './note-file.js'
import { PLACEHOLDER } from './store.js'

/**
 * `move` takes the files out of the old folder (into iCloud, so the Mac keeps no stale copy).
 * `copy` leaves them (out of iCloud, so the user's other devices keep their notes).
 */
export type NotesTransferMode = 'move' | 'copy'
export type NotesTransfer = { moved: number; skipped: number }

/**
 * Brings the note files of `from` into `to`, the way the notes folder holds them: Markdown
 * files directly in the folder. A file `to` already has with the same content counts as
 * brought over; one with other content arrives under a free name, and the store gives the
 * copy its own id. Files that cannot be read now, such as notes iCloud has not downloaded,
 * stay behind and are counted as skipped; `download` asks for them.
 */
export function transferNotes(
  from: string,
  to: string,
  mode: NotesTransferMode,
  download: (path: string) => void = () => {}
): NotesTransfer {
  mkdirSync(to, { recursive: true })
  if (!existsSync(from)) return { moved: 0, skipped: 0 }
  let moved = 0
  let skipped = 0
  const taken = new Set(readdirSync(to).map((name) => name.toLowerCase()))
  const names = readdirSync(from, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
  for (const entry of names) {
    if (!entry.isFile()) continue
    const placeholder = PLACEHOLDER.exec(entry.name)?.[1]
    if (placeholder) {
      download(join(from, placeholder))
      skipped++
      continue
    }
    if (entry.name.startsWith('.') || !entry.name.toLowerCase().endsWith('.md')) continue
    const source = join(from, entry.name)
    let content: Buffer
    try {
      content = readFileSync(source)
    } catch {
      download(source)
      skipped++
      continue
    }
    const same = join(to, entry.name)
    if (existsSync(same) && readFileSync(same).equals(content)) {
      if (mode === 'move') unlinkSync(source)
      moved++
      continue
    }
    const name = taken.has(entry.name.toLowerCase())
      ? uniqueName(basename(entry.name, '.md'), taken)
      : entry.name
    taken.add(name.toLowerCase())
    const target = join(to, name)
    if (mode === 'copy') copyFileSync(source, target)
    else moveFile(source, target)
    moved++
  }
  return { moved, skipped }
}

/**
 * Counts the note files in `from` that cannot be read now (iCloud placeholders, files that
 * fail to read) and asks `download` for each.
 */
export function pendingNotes(from: string, download: (path: string) => void): number {
  if (!existsSync(from)) return 0
  let pending = 0
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const placeholder = PLACEHOLDER.exec(entry.name)?.[1]
    if (placeholder) {
      download(join(from, placeholder))
      pending++
      continue
    }
    if (entry.name.startsWith('.') || !entry.name.toLowerCase().endsWith('.md')) continue
    try {
      readFileSync(join(from, entry.name))
    } catch {
      download(join(from, entry.name))
      pending++
    }
  }
  return pending
}

function moveFile(source: string, target: string): void {
  try {
    renameSync(source, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    copyFileSync(source, target)
    unlinkSync(source)
  }
}
