import type { ToolWidgetState } from '@renderer/components/tool-widgets/types'
import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  CalendarClock,
  FileSearch,
  Globe,
  ImageIcon,
  PencilLine,
  Search,
  Send,
  Terminal,
  Wrench
} from 'lucide-react'

export type ActivityFileDetail = {
  path: string
  name: string
}

export type ActivityDiffStats = {
  additions: number
  deletions: number
}

export type TerminalTransportDetail = {
  sessionId: string | null
  exitCode: number | null
  signalCode: string | null
  terminalStatus: string | null
  originalTokenCount: number | null
  output: string | null
  stdout: string | null
  stderr: string | null
  wallTimeMs: number | null
}

export function formatToolValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value.trim() || null
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function formatSingleLineToolValue(value: unknown): string | null {
  const text = formatToolValue(value)?.replace(/\s+/g, ' ').trim()
  return text || null
}

export function formatInlineToolValue(value: unknown, maxLength = 110): string | null {
  const text = formatSingleLineToolValue(value)
  if (!text) return null
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getToolDetail(widget: ToolWidgetState): string | null {
  const path = formatInlineToolValue(widget.args.path ?? widget.args.filePath ?? widget.args.url)
  if (path) return path

  const command = formatInlineToolValue(
    widget.args.command ?? widget.args.cmd ?? widget.args.scriptName
  )
  if (command) return command

  for (const key of [
    'prompt',
    'query',
    'q',
    'searchQuery',
    'search_query',
    'input',
    'text',
    'message',
    'name',
    'title'
  ]) {
    const detail = formatInlineToolValue(widget.args[key])
    if (detail) return detail
  }

  return null
}

export function localPathBasename(value: string): string {
  const withoutTrailingSlash = value.replace(/[\\/]+$/, '')
  const segments = withoutTrailingSlash.split(/[\\/]+/)
  return segments[segments.length - 1] || value
}

export function getActivityPath(widget: ToolWidgetState): string | null {
  const path = formatSingleLineToolValue(
    widget.args.path ?? widget.args.filePath ?? widget.args.file_path ?? widget.args.filepath
  )
  return path
}

export function getActivityFileDetail(widget: ToolWidgetState): ActivityFileDetail | null {
  const path = getActivityPath(widget)
  if (!path) return null
  return { path, name: localPathBasename(path) }
}

export function getActivityDetail(widget: ToolWidgetState): string | null {
  const path = getActivityPath(widget)
  if (path) return localPathBasename(path)
  return getToolDetail(widget)
}

export function countDiffStats(diff: string): ActivityDiffStats | null {
  let additions = 0
  let deletions = 0

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) {
      additions += 1
    } else if (line.startsWith('-')) {
      deletions += 1
    }
  }

  return additions > 0 || deletions > 0 ? { additions, deletions } : null
}

export function numberFromRecord(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

export function diffTextFromValue(value: unknown): string | null {
  if (!isPlainRecord(value)) return null

  const directDiff = formatToolValue(value.diff ?? value.patch)
  if (directDiff) return directDiff

  if (isPlainRecord(value.details)) {
    const detailDiff = formatToolValue(value.details.diff ?? value.details.patch)
    if (detailDiff) return detailDiff
  }

  return null
}

export function getActivityDiffStats(widget: ToolWidgetState): ActivityDiffStats | null {
  for (const value of [widget.result, widget.args]) {
    if (!isPlainRecord(value)) continue

    const additions = numberFromRecord(value, ['additions', 'added', 'linesAdded', 'lines_added'])
    const deletions = numberFromRecord(value, [
      'deletions',
      'deleted',
      'removed',
      'linesDeleted',
      'lines_deleted',
      'linesRemoved',
      'lines_removed'
    ])
    if (additions !== null || deletions !== null) {
      return { additions: additions ?? 0, deletions: deletions ?? 0 }
    }

    const diff = diffTextFromValue(value)
    const stats = diff ? countDiffStats(diff) : null
    if (stats) return stats
  }

  return null
}

export function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[-\s]+/g, '_')
}

export function isCommandToolName(normalized: string): boolean {
  return (
    normalized === 'exec' ||
    normalized === 'exec_command' ||
    normalized.startsWith('pichu_') ||
    normalized.startsWith('cdn_') ||
    normalized.startsWith('llm_') ||
    normalized.includes('shell') ||
    normalized.includes('command')
  )
}

export function isTerminalTransportToolName(normalized: string): boolean {
  return normalized === 'write_stdin'
}

export function isTerminalTransportWidget(widget: ToolWidgetState): boolean {
  return isTerminalTransportToolName(normalizeToolName(widget.toolName))
}

export function isCommandWidget(widget: ToolWidgetState): boolean {
  return isCommandToolName(normalizeToolName(widget.toolName))
}

export function isImageGenerationWidget(widget: ToolWidgetState): boolean {
  return normalizeToolName(widget.toolName) === 'image_generate'
}

export function isInlineToolWidget(widget: ToolWidgetState): boolean {
  const normalized = normalizeToolName(widget.toolName)
  return (
    normalized === 'ask_user' || normalized === 'askuserinput' || normalized === 'ask_user_input'
  )
}

function addGeneratedImagePath(paths: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return
  const path = value.trim()
  if (path.startsWith('/')) paths.add(path)
}

function addGeneratedImagePathArray(paths: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return
  for (const item of value) addGeneratedImagePath(paths, item)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function collectGeneratedImagePathsFromText(paths: Set<string>, text: string): void {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.toLowerCase().startsWith('media:')) continue
    addGeneratedImagePath(
      paths,
      trimmed
        .slice('media:'.length)
        .trim()
        .replace(/^['"`]+|['"`]+$/g, '')
    )
  }
}

export function collectGeneratedImagePathsFromResult(paths: Set<string>, result: unknown): void {
  if (!isRecord(result)) return

  addGeneratedImagePathArray(paths, result.paths)

  const details = isRecord(result.details) ? result.details : null
  if (details) {
    addGeneratedImagePathArray(paths, details.paths)
    if (isRecord(details.media)) addGeneratedImagePathArray(paths, details.media.mediaUrls)
  }

  const content = Array.isArray(result.content) ? result.content : []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      collectGeneratedImagePathsFromText(paths, block.text)
    }
  }
}

function sentenceCase(text: string): string {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

export function displayToolName(name: string): string {
  const normalized = normalizeToolName(name)
  if (isTerminalTransportToolName(normalized)) return 'Command output'
  if (isCommandToolName(normalized)) return 'Command'
  if (normalized.includes('search')) return 'Search'
  if (normalized === 'browser' || normalized.includes('fetch')) {
    return 'Browser'
  }
  if (normalized === 'read') return 'Read'
  if (normalized === 'write' || normalized === 'edit' || normalized.includes('patch')) return 'Edit'
  if (normalized === 'list' || normalized === 'grep' || normalized === 'rg') return 'File search'
  if (normalized.includes('image')) return 'Image generation'
  if (normalized.includes('message') || normalized.includes('send')) return 'Message'
  if (normalized.includes('cron') || normalized.includes('calendar')) return 'Calendar'
  if (normalized.includes('agent')) return 'Agent'
  return sentenceCase(name.replace(/[_-]+/g, ' ').trim() || 'tool')
}

export function pluralToolLabel(label: string): string {
  if (label === 'Command') return 'commands'
  if (label === 'Command output') return 'command output checks'
  return `${label.toLowerCase()} tools`
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function toolActionVerb(widget: ToolWidgetState): {
  past: string
  present: string
} {
  const normalized = normalizeToolName(widget.toolName)
  if (isTerminalTransportToolName(normalized)) {
    return hasStdinInput(widget)
      ? { past: 'Sent input to command', present: 'Sending input to command' }
      : { past: 'Read command output', present: 'Waiting for command output' }
  }
  if (isCommandToolName(normalized)) return { past: 'Ran', present: 'Running' }
  if (normalized === 'read') return { past: 'Read', present: 'Reading' }
  if (normalized === 'write' || normalized === 'edit' || normalized.includes('patch')) {
    return { past: 'Edited', present: 'Editing' }
  }
  if (
    normalized.includes('search') ||
    normalized === 'grep' ||
    normalized === 'rg' ||
    normalized === 'list'
  ) {
    return { past: 'Searched', present: 'Searching' }
  }
  if (normalized === 'browser' || normalized.includes('fetch')) {
    return { past: 'Fetched', present: 'Fetching' }
  }
  if (normalized.includes('image')) {
    return { past: 'Generated image', present: 'Generating image' }
  }
  if (normalized.includes('message') || normalized.includes('send')) {
    return { past: 'Sent', present: 'Sending' }
  }
  if (normalized.includes('agent')) return { past: 'Ran', present: 'Running' }

  const label = displayToolName(widget.toolName)
  return { past: label, present: `Running ${label.toLowerCase()}` }
}

export function summarizeFinishedTools(widgets: ToolWidgetState[]): string {
  const counts = widgets.reduce(
    (acc, widget) => {
      const normalized = normalizeToolName(widget.toolName)
      if (isTerminalTransportToolName(normalized)) acc.commandOutputReads += 1
      else if (isCommandToolName(normalized)) acc.commands += 1
      else if (normalized === 'read') acc.reads += 1
      else if (normalized === 'write' || normalized === 'edit' || normalized.includes('patch')) {
        acc.edits += 1
      } else if (
        normalized.includes('search') ||
        normalized === 'grep' ||
        normalized === 'rg' ||
        normalized === 'list'
      ) {
        acc.searches += 1
      } else if (normalized.includes('image')) acc.images += 1
      else acc.other += 1
      return acc
    },
    {
      commandOutputReads: 0,
      commands: 0,
      edits: 0,
      images: 0,
      other: 0,
      reads: 0,
      searches: 0
    }
  )
  const commandOutputSummary =
    counts.commandOutputReads > 1
      ? `checked command output ${counts.commandOutputReads} times`
      : 'checked command output'

  if (counts.edits > 0) {
    const parts: string[] = [pluralize(counts.edits, 'file')]
    if (counts.reads > 0) parts.push(`read ${pluralize(counts.reads, 'file')}`)
    if (counts.searches > 0) parts.push(pluralize(counts.searches, 'search', 'searches'))
    if (counts.commands > 0) parts.push(`ran ${pluralize(counts.commands, 'command')}`)
    if (counts.commandOutputReads > 0) parts.push(commandOutputSummary)
    if (counts.images > 0) parts.push(`generated ${pluralize(counts.images, 'image')}`)
    if (counts.other > 0) parts.push(`used ${pluralize(counts.other, 'tool')}`)
    return `Edited ${parts.join(', ')}`
  }

  if (counts.reads > 0 || counts.searches > 0) {
    const parts: string[] = []
    if (counts.reads > 0) parts.push(pluralize(counts.reads, 'file'))
    if (counts.searches > 0) parts.push(pluralize(counts.searches, 'search', 'searches'))
    if (counts.commands > 0) parts.push(`ran ${pluralize(counts.commands, 'command')}`)
    if (counts.commandOutputReads > 0) parts.push(commandOutputSummary)
    if (counts.images > 0) parts.push(`generated ${pluralize(counts.images, 'image')}`)
    if (counts.other > 0) parts.push(`used ${pluralize(counts.other, 'tool')}`)
    return `Explored ${parts.join(', ')}`
  }

  if (counts.commands > 0) {
    const parts = [pluralize(counts.commands, 'command')]
    if (counts.commandOutputReads > 0) parts.push(commandOutputSummary)
    return `Ran ${parts.join(', ')}`
  }
  if (counts.commandOutputReads > 0) {
    return counts.commandOutputReads > 1
      ? `Read command output ${counts.commandOutputReads} times`
      : 'Read command output'
  }
  if (counts.images > 0) return `Generated ${pluralize(counts.images, 'image')}`
  return `Used ${pluralize(widgets.length, 'tool')}`
}

export function summarizeToolActivities(widgets: ToolWidgetState[], isRunActive: boolean): string {
  const running = widgets.filter(
    (widget) => widget.status === 'streaming' || widget.status === 'running'
  )
  const finished = widgets.filter(
    (widget) => widget.status === 'complete' || widget.status === 'error'
  )
  const mostRecent = widgets[widgets.length - 1]

  if (running.length > 0) {
    const labels = [...new Set(running.map((widget) => displayToolName(widget.toolName)))]
    if (running.length === 1) {
      const widget = running[0]
      return widget ? activityLine(widget, 'present') : 'Working'
    }
    if (labels.length === 1)
      return `Running ${running.length} ${pluralToolLabel(labels[0] ?? 'Tool')}`
    return `Running ${running.length} tools`
  }
  if (isRunActive && finished.length > 0) {
    if (finished.length === 1) {
      const latestFinished = finished[0]
      return latestFinished ? activityLine(latestFinished) : summarizeFinishedTools(finished)
    }
    return summarizeFinishedTools(finished)
  }
  if (finished.length === 1 && mostRecent) {
    return activityLine(mostRecent)
  }
  if (finished.length > 1) {
    return summarizeFinishedTools(finished)
  }
  return mostRecent ? activityLine(mostRecent) : 'Working'
}

export function activityLine(widget: ToolWidgetState, tense: 'past' | 'present' = 'past'): string {
  if (isTerminalTransportToolName(normalizeToolName(widget.toolName))) {
    const verb = toolActionVerb(widget)
    const input = getTerminalStdinInputPreview(widget)
    if (input) {
      return tense === 'present'
        ? `Sending input ${input} to command`
        : `Sent input ${input} to command`
    }
    return tense === 'present' ? verb.present : verb.past
  }
  if (isCommandWidget(widget)) {
    const command = getCommandText(widget) ?? commandTextFromToolName(widget.toolName)
    return tense === 'present' ? `Running ${command}` : `Ran ${command}`
  }
  const verb = toolActionVerb(widget)
  const detail = getActivityDetail(widget)?.trim()
  const label = tense === 'present' ? verb.present : verb.past
  if (!detail || detail.toLowerCase() === label.toLowerCase()) return label
  return `${label} ${detail}`
}

export function getCommandText(widget: ToolWidgetState): string | null {
  return formatToolValue(widget.args.command ?? widget.args.cmd ?? widget.args.scriptName)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nullableStringFromRecord(record: Record<string, unknown>, key: string): string | null {
  if (record[key] === null) return null
  return stringOrNull(record[key])
}

function managedExecDetailFromResult(result: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(result)) return null
  if (isPlainRecord(result.details)) return result.details
  if ('output' in result || 'sessionId' in result || 'exitCode' in result) return result
  return null
}

export function getTerminalTransportDetail(
  widget: ToolWidgetState
): TerminalTransportDetail | null {
  if (!isTerminalTransportWidget(widget)) return null
  const details = managedExecDetailFromResult(widget.result)
  if (!details) return null
  return {
    sessionId: nullableStringFromRecord(details, 'sessionId'),
    exitCode: finiteNumberOrNull(details.exitCode),
    signalCode: stringOrNull(details.signalCode),
    terminalStatus: stringOrNull(details.terminalStatus),
    originalTokenCount: finiteNumberOrNull(details.originalTokenCount),
    output: stringOrNull(details.output),
    stdout: stringOrNull(details.stdout),
    stderr: stringOrNull(details.stderr),
    wallTimeMs: finiteNumberOrNull(details.wallTimeMs)
  }
}

function hasStdinInput(widget: ToolWidgetState): boolean {
  const chars = terminalStdinInputValue(widget)
  return typeof chars === 'string' ? chars.length > 0 : chars !== undefined && chars !== null
}

function terminalStdinInputValue(widget: ToolWidgetState): unknown {
  return widget.args.chars ?? widget.args.stdin ?? widget.args.input
}

const TERMINAL_STDIN_CONTROL_LABELS = new Map<string, string>([
  ['\u0003', 'Ctrl-C'],
  ['\u0004', 'Ctrl-D'],
  ['\u001a', 'Ctrl-Z'],
  ['\u001b', 'Esc'],
  ['\u007f', 'Backspace'],
  ['\t', 'Tab'],
  ['\n', 'Enter'],
  ['\r', 'Enter'],
  ['\r\n', 'Enter']
])

function terminalStdinControlPreview(value: string): string | null {
  const direct = TERMINAL_STDIN_CONTROL_LABELS.get(value)
  if (direct) return direct

  const labels: string[] = []
  for (const char of value) {
    const label = TERMINAL_STDIN_CONTROL_LABELS.get(char)
    if (!label) return null
    if (labels[labels.length - 1] !== label) labels.push(label)
  }
  return labels.length > 0 ? labels.join(', ') : null
}

function terminalStdinConfirmationPreview(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'y' || normalized === 'n') return normalized
  if (normalized === 'yes' || normalized === 'no') return normalized
  return null
}

export function getTerminalStdinInputPreview(widget: ToolWidgetState): string | null {
  if (!isTerminalTransportWidget(widget)) return null
  const value = terminalStdinInputValue(widget)
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && value.length === 0) return null
  const controlPreview = typeof value === 'string' ? terminalStdinControlPreview(value) : null
  if (controlPreview) return controlPreview
  return typeof value === 'string' ? terminalStdinConfirmationPreview(value) : null
}

export function commandTextFromToolName(toolName: string): string {
  return toolName
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/^(Pichu|Cdn|Llm)\b/, (match) => match.toLowerCase())
}

export function extractTextContent(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (Array.isArray(value)) {
    const parts = value.map(extractTextContent).filter(Boolean)
    return parts.length > 0 ? parts.join('\n') : null
  }

  if (!isPlainRecord(value)) return null

  if (Array.isArray(value.content)) {
    const parts = value.content.map(extractTextContent).filter(Boolean)
    if (parts.length > 0) return parts.join('\n')
  }

  for (const key of ['text', 'output', 'stdout', 'stderr', 'message']) {
    const text = formatToolValue(value[key])
    if (text) return text
  }

  if (isPlainRecord(value.details)) {
    for (const key of ['text', 'output', 'stdout', 'stderr', 'message']) {
      const text = formatToolValue(value.details[key])
      if (text) return text
    }
  }

  return null
}

export function getCommandOutput(widget: ToolWidgetState): string | null {
  return extractTextContent(widget.result)
}

export function commandStatusLabel(widget: ToolWidgetState): string {
  if (widget.status === 'running' || widget.status === 'streaming') return 'Running'
  if (widget.status === 'error' || widget.isError) return 'Failed'
  return 'Success'
}

export function iconForTool(toolName: string): LucideIcon {
  const normalized = normalizeToolName(toolName)
  if (normalized.includes('search')) return Search
  if (isTerminalTransportToolName(normalized)) return Terminal
  if (isCommandToolName(normalized)) return Terminal
  if (normalized === 'browser' || normalized.includes('fetch')) {
    return Globe
  }
  if (
    normalized === 'read' ||
    normalized === 'list' ||
    normalized === 'grep' ||
    normalized === 'rg' ||
    normalized.includes('file')
  ) {
    return FileSearch
  }
  if (normalized === 'write' || normalized === 'edit' || normalized.includes('patch')) {
    return PencilLine
  }
  if (normalized.includes('image')) return ImageIcon
  if (normalized.includes('message') || normalized.includes('send')) return Send
  if (normalized.includes('cron') || normalized.includes('calendar')) return CalendarClock
  if (normalized.includes('agent')) return Bot
  return Wrench
}
