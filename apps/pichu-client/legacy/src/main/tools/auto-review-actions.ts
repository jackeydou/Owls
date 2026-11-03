import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { ToolApprovalAutoReviewFileChange } from '../../shared/tool-approval.js'

const AUTO_REVIEW_CHANGE_PREVIEW_CHARS = 1_200
const AUTO_REVIEW_SOURCE_READ_MAX_BYTES = 256_000
const AUTO_REVIEW_DIFF_CONTEXT_LINES = 3

function readTrimmedStringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const fieldValue = (value as Record<string, unknown>)[field]
  return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue.trim() : undefined
}

function readRawStringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const fieldValue = (value as Record<string, unknown>)[field]
  return typeof fieldValue === 'string' ? fieldValue : undefined
}

function normalizePreview(value: string): {
  preview: string
  byteLength: number
  truncated: boolean
} {
  const normalized = normalizeText(value)
  const truncated = normalized.length > AUTO_REVIEW_CHANGE_PREVIEW_CHARS
  return {
    preview: truncated
      ? `${normalized.slice(0, AUTO_REVIEW_CHANGE_PREVIEW_CHARS)}...[truncated]`
      : normalized,
    byteLength: Buffer.byteLength(value, 'utf8'),
    truncated
  }
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function splitDiffLines(value: string): string[] {
  const lines = normalizeText(value).split('\n')
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return lines
}

function buildUnifiedDiffPreview(
  filePath: string,
  oldContent: string,
  newContent: string
): { preview?: string; truncated: boolean } {
  const oldLines = splitDiffLines(oldContent)
  const newLines = splitDiffLines(newContent)
  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1
  }
  if (prefix === oldLines.length && prefix === newLines.length) return { truncated: false }

  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const oldStart = Math.max(0, prefix - AUTO_REVIEW_DIFF_CONTEXT_LINES)
  const newStart = Math.max(0, prefix - AUTO_REVIEW_DIFF_CONTEXT_LINES)
  const oldEnd = Math.min(
    oldLines.length,
    oldLines.length - suffix + AUTO_REVIEW_DIFF_CONTEXT_LINES
  )
  const newEnd = Math.min(
    newLines.length,
    newLines.length - suffix + AUTO_REVIEW_DIFF_CONTEXT_LINES
  )
  const hunk: string[] = [
    `--- ${filePath}`,
    `+++ ${filePath}`,
    `@@ -${oldStart + 1},${oldEnd - oldStart} +${newStart + 1},${newEnd - newStart} @@`
  ]

  for (let index = oldStart; index < prefix; index += 1) {
    hunk.push(` ${oldLines[index] ?? ''}`)
  }
  for (let index = prefix; index < oldLines.length - suffix; index += 1) {
    hunk.push(`-${oldLines[index] ?? ''}`)
  }
  for (let index = prefix; index < newLines.length - suffix; index += 1) {
    hunk.push(`+${newLines[index] ?? ''}`)
  }
  const trailingContextStart = Math.max(prefix, oldLines.length - suffix)
  for (let index = trailingContextStart; index < oldEnd; index += 1) {
    hunk.push(` ${oldLines[index] ?? ''}`)
  }

  const diffText = hunk.join('\n')
  const preview = normalizePreview(diffText)
  return { preview: preview.preview, truncated: preview.truncated }
}

function expandToolPath(filePath: string): string {
  if (filePath === '~') return homedir()
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2))
  return filePath.startsWith('@') ? filePath.slice(1) : filePath
}

function resolveToolPath(filePath: string, cwd: string | undefined): string | undefined {
  if (!cwd) return undefined
  const expanded = expandToolPath(filePath)
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded)
}

function pathScopeForResolvedPath(
  resolvedPath: string,
  cwd: string
): ToolApprovalAutoReviewFileChange['pathScope'] {
  const relativePath = relative(resolve(cwd), resolvedPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
    ? 'insideCwd'
    : 'outsideCwd'
}

function readPathMetadata(
  filePath: string,
  cwd: string | undefined
): Pick<ToolApprovalAutoReviewFileChange, 'resolvedPath' | 'pathScope'> {
  const resolvedPath = resolveToolPath(filePath, cwd)
  if (!resolvedPath || !cwd) return { pathScope: 'unknown' }
  return {
    resolvedPath,
    pathScope: pathScopeForResolvedPath(resolvedPath, cwd)
  }
}

function readSmallTextFileForDiff(
  resolvedPath: string,
  cwd: string
):
  | {
      content: string
    }
  | {
      reason: string
    } {
  try {
    if (!existsSync(resolvedPath)) return { content: '' }
    const lstat = lstatSync(resolvedPath)
    if (lstat.isSymbolicLink()) return { reason: 'Existing file is a symbolic link.' }

    const realCwd = realpathSync(cwd)
    const realResolvedPath = realpathSync(resolvedPath)
    if (pathScopeForResolvedPath(realResolvedPath, realCwd) !== 'insideCwd') {
      return { reason: 'Existing file resolves outside the workspace.' }
    }

    const stat = statSync(realResolvedPath)
    if (!stat.isFile()) return { reason: 'Target path is not a file.' }
    if (stat.size > AUTO_REVIEW_SOURCE_READ_MAX_BYTES) {
      return { reason: `Existing file is larger than ${AUTO_REVIEW_SOURCE_READ_MAX_BYTES} bytes.` }
    }
    const buffer = readFileSync(realResolvedPath)
    if (buffer.includes(0)) return { reason: 'Existing file appears to be binary.' }
    return { content: buffer.toString('utf8') }
  } catch (error) {
    return {
      reason: error instanceof Error ? error.message : 'Could not read existing file content.'
    }
  }
}

function withPathMetadata(
  change: ToolApprovalAutoReviewFileChange,
  cwd: string | undefined
): ToolApprovalAutoReviewFileChange {
  return { ...change, ...readPathMetadata(change.path, cwd) }
}

function appendDiffPreview(
  change: ToolApprovalAutoReviewFileChange,
  cwd: string | undefined,
  newContent: string
): ToolApprovalAutoReviewFileChange {
  const withMetadata = withPathMetadata(change, cwd)
  if (!cwd || !withMetadata.resolvedPath || withMetadata.pathScope !== 'insideCwd') {
    return withMetadata
  }

  const oldContent = readSmallTextFileForDiff(withMetadata.resolvedPath, cwd)
  if ('reason' in oldContent) {
    return { ...withMetadata, diffUnavailableReason: oldContent.reason }
  }

  const diff = buildUnifiedDiffPreview(change.path, oldContent.content, newContent)
  return {
    ...withMetadata,
    ...(diff.preview ? { diffPreview: diff.preview } : {}),
    truncated: withMetadata.truncated || diff.truncated
  }
}

function applyExactEdits(
  content: string,
  edits: Array<{ oldText: string; newText: string }>
):
  | {
      content: string
    }
  | {
      reason: string
    } {
  let updated = normalizeText(content)
  for (const edit of edits) {
    const oldText = normalizeText(edit.oldText)
    const newText = normalizeText(edit.newText)
    const firstIndex = updated.indexOf(oldText)
    if (firstIndex === -1) return { reason: 'Old text was not found in the current file.' }
    if (updated.indexOf(oldText, firstIndex + oldText.length) !== -1) {
      return { reason: 'Old text matched more than once in the current file.' }
    }
    updated = `${updated.slice(0, firstIndex)}${newText}${updated.slice(firstIndex + oldText.length)}`
  }
  return { content: updated }
}

function readEditEntries(toolInput: unknown): Array<{ oldText: string; newText: string }> {
  if (!toolInput || typeof toolInput !== 'object') return []
  const input = toolInput as Record<string, unknown>
  const rawEdits = typeof input.edits === 'string' ? safeParseJson(input.edits) : input.edits
  const edits = Array.isArray(rawEdits) ? rawEdits : []
  const entries = edits.flatMap((edit): Array<{ oldText: string; newText: string }> => {
    if (!edit || typeof edit !== 'object') return []
    const record = edit as Record<string, unknown>
    return typeof record.oldText === 'string' && typeof record.newText === 'string'
      ? [{ oldText: record.oldText, newText: record.newText }]
      : []
  })
  const legacyOldText = readRawStringField(toolInput, 'oldText')
  const legacyNewText = readRawStringField(toolInput, 'newText')
  if (legacyOldText !== undefined && legacyNewText !== undefined) {
    entries.push({ oldText: legacyOldText, newText: legacyNewText })
  }
  return entries
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function readApplyPatchPaths(toolInput: unknown): string[] {
  const patch =
    readTrimmedStringField(toolInput, 'patch') ??
    readTrimmedStringField(toolInput, 'input') ??
    readTrimmedStringField(toolInput, 'content') ??
    readTrimmedStringField(toolInput, 'diff')
  if (!patch) return []

  const paths: string[] = []
  for (const line of patch.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/)
    if (match?.[1]?.trim()) {
      paths.push(match[1].trim())
      continue
    }
    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/)
    if (moveMatch?.[1]?.trim()) {
      paths.push(moveMatch[1].trim())
    }
  }
  return paths
}

function readApplyPatchChanges(
  toolInput: unknown,
  cwd: string | undefined
): ToolApprovalAutoReviewFileChange[] {
  const patch =
    readRawStringField(toolInput, 'patch') ??
    readRawStringField(toolInput, 'input') ??
    readRawStringField(toolInput, 'content') ??
    readRawStringField(toolInput, 'diff')
  if (!patch) return []

  const changes: ToolApprovalAutoReviewFileChange[] = []
  let current:
    | {
        path: string
        kind: ToolApprovalAutoReviewFileChange['kind']
        moveTo?: string
        lines: string[]
      }
    | undefined

  const flush = () => {
    if (!current) return
    const patchText = current.lines.join('\n')
    const preview = patchText ? normalizePreview(patchText) : undefined
    changes.push(
      withPathMetadata(
        {
          path: current.path,
          kind: current.kind,
          ...(current.moveTo ? { moveTo: current.moveTo } : {}),
          ...(preview
            ? {
                patchPreview: preview.preview,
                byteLength: preview.byteLength,
                truncated: preview.truncated
              }
            : {})
        },
        cwd
      )
    )
  }

  for (const line of patch.split(/\r?\n/)) {
    const fileMatch = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/)
    if (fileMatch?.[1] && fileMatch[2]?.trim()) {
      flush()
      const kind =
        fileMatch[1] === 'Add' ? 'create' : fileMatch[1] === 'Delete' ? 'delete' : 'update'
      current = { path: fileMatch[2].trim(), kind, lines: [] }
      continue
    }
    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/)
    if (moveMatch?.[1]?.trim() && current) {
      current.kind = 'move'
      current.moveTo = moveMatch[1].trim()
      continue
    }
    current?.lines.push(line)
  }
  flush()
  return changes
}

export function readFileWritePaths(toolName: string, toolInput: unknown): string[] {
  const path =
    readTrimmedStringField(toolInput, 'path') ??
    readTrimmedStringField(toolInput, 'file_path') ??
    readTrimmedStringField(toolInput, 'filePath')
  if (path) return [path]
  if (toolName === 'apply_patch') return readApplyPatchPaths(toolInput)
  return []
}

export function readFileChangePreviews(
  toolName: string,
  toolInput: unknown,
  cwd: string | undefined
): ToolApprovalAutoReviewFileChange[] {
  if (toolName === 'apply_patch') return readApplyPatchChanges(toolInput, cwd)

  const path = readFileWritePaths(toolName, toolInput)[0]
  if (!path) return []

  if (toolName === 'write') {
    const content = readRawStringField(toolInput, 'content')
    if (content === undefined) return []
    const preview = normalizePreview(content)
    return [
      appendDiffPreview(
        {
          path,
          kind: 'write',
          contentPreview: preview.preview,
          byteLength: preview.byteLength,
          truncated: preview.truncated
        },
        cwd,
        content
      )
    ]
  }

  if (toolName === 'edit') {
    const edits = readEditEntries(toolInput)
    const baseChanges = edits.map((edit) => {
      const oldPreview = normalizePreview(edit.oldText)
      const newPreview = normalizePreview(edit.newText)
      return withPathMetadata(
        {
          path,
          kind: 'edit',
          oldTextPreview: oldPreview.preview,
          newTextPreview: newPreview.preview,
          byteLength: oldPreview.byteLength + newPreview.byteLength,
          truncated: oldPreview.truncated || newPreview.truncated
        },
        cwd
      )
    })
    const firstChange = baseChanges[0]
    if (!cwd || !firstChange?.resolvedPath || firstChange.pathScope !== 'insideCwd') {
      return baseChanges
    }
    const oldContent = readSmallTextFileForDiff(firstChange.resolvedPath, cwd)
    if ('reason' in oldContent) {
      return baseChanges.map((change) => ({ ...change, diffUnavailableReason: oldContent.reason }))
    }
    const updatedContent = applyExactEdits(oldContent.content, edits)
    if ('reason' in updatedContent) {
      return baseChanges.map((change) => ({
        ...change,
        diffUnavailableReason: updatedContent.reason
      }))
    }
    const diff = buildUnifiedDiffPreview(path, oldContent.content, updatedContent.content)
    return baseChanges.map((change, index) => {
      if (index !== 0 || !diff.preview) return change
      return {
        ...change,
        diffPreview: diff.preview,
        truncated: change.truncated || diff.truncated
      }
    })
  }

  return []
}
