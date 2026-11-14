export type DiffLineKind = 'added' | 'removed' | 'hunk' | 'context'
export type DiffLine = { kind: DiffLineKind; text: string }
export type DiffFile = { path: string; added: number; removed: number; lines: DiffLine[] }
export type DiffStats = { added: number; removed: number }

const GIT_HEADER =
  /^(index |new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|Binary files)/

function headerPath(line: string): string | null {
  const path = line.slice(4).split('\t')[0].trim()
  if (!path || path === '/dev/null') return null
  return path.replace(/^[ab]\//, '')
}
/** The last path on a `diff --git a/x b/x` line, for files with no `---`/`+++` pair (binary, mode-only). */
function gitPath(line: string): string {
  const match = / b\/(.+)$/.exec(line)
  return match ? match[1] : line.slice('diff --git '.length)
}

/**
 * Splits a unified diff into files. Codex sends `git diff` output; Claude Code workers
 * build `---`/`+++` sections per edit, so a file can appear more than once and is merged.
 */
export function parseDiff(diff: string): DiffFile[] {
  const files = new Map<string, DiffFile>()
  let current: DiffFile | null = null
  const open = (path: string): DiffFile => {
    const file = files.get(path) ?? { path, added: 0, removed: 0, lines: [] }
    files.set(path, file)
    return file
  }
  const lines = diff.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('diff --git ')) {
      // The `---`/`+++` pair that follows names it more reliably; this covers binary files.
      let named = false
      for (let j = i + 1; j < lines.length && !lines[j].startsWith('diff --git '); j++) {
        if (lines[j].startsWith('--- ') || lines[j].startsWith('@@')) {
          named = lines[j].startsWith('--- ')
          break
        }
      }
      current = named ? null : open(gitPath(line))
      continue
    }
    if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      current = open(headerPath(lines[i + 1]) ?? headerPath(line) ?? line.slice(4))
      i++
      continue
    }
    const file = current
    if (!file) continue
    if (GIT_HEADER.test(line)) continue
    if (line.startsWith('@@')) file.lines.push({ kind: 'hunk', text: line })
    else if (line.startsWith('+')) {
      file.added++
      file.lines.push({ kind: 'added', text: line.slice(1) })
    } else if (line.startsWith('-')) {
      file.removed++
      file.lines.push({ kind: 'removed', text: line.slice(1) })
    } else if (line.startsWith('\\')) continue
    else file.lines.push({ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line })
  }
  for (const file of files.values()) {
    while (file.lines.at(-1)?.kind === 'context' && !file.lines.at(-1)?.text) file.lines.pop()
  }
  return [...files.values()]
}

export function diffStats(files: DiffFile[]): DiffStats {
  return files.reduce(
    (total, file) => ({ added: total.added + file.added, removed: total.removed + file.removed }),
    { added: 0, removed: 0 }
  )
}
