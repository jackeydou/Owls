import { basename } from 'node:path'
import { type ParseEntry, parse } from 'shell-quote'
import type { ToolApprovalParsedCommand } from '../shared/tool-approval.js'

const SHELL_WRAPPER_EXECUTABLES = new Set(['bash', 'dash', 'fish', 'sh', 'zsh'])
const CANONICAL_SHELL_SCRIPT_PREFIX = '__pichu_shell_script__'
const SIDE_EFFECT_PREVIEW_CHARS = 2_000

function preserveShellVariable(name: string): string {
  return `$${name}`
}

export function containsShellExecutionExpansion(command: string): boolean {
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }

    if (char === "'" && quote !== '"') {
      quote = quote === "'" ? null : "'"
      continue
    }

    if (char === '"' && quote !== "'") {
      quote = quote === '"' ? null : '"'
      continue
    }

    if (quote === "'") continue
    if (char === '`') return true
    if (char === '$' && next === '(') return true
    if (quote === null && (char === '<' || char === '>') && next === '(') return true
  }

  return false
}

function normalizeShellCommandSeparators(command: string): string {
  let quote: '"' | "'" | null = null
  let escaped = false
  let normalized = ''

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]

    if (escaped) {
      normalized += char
      escaped = false
      continue
    }

    if (char === '\\' && quote !== "'") {
      normalized += char
      escaped = true
      continue
    }

    if (char === "'" && quote !== '"') {
      quote = quote === "'" ? null : "'"
      normalized += char
      continue
    }

    if (char === '"' && quote !== "'") {
      quote = quote === '"' ? null : '"'
      normalized += char
      continue
    }

    normalized += char === '\n' && quote === null ? ';' : char
  }

  return normalized
}

function splitShellSegments(entries: ParseEntry[]): string[][] | null {
  const segments: string[][] = [[]]
  for (const entry of entries) {
    if (typeof entry === 'object') return null
    if (typeof entry !== 'string') continue
    if (entry === '|' || entry === '&&' || entry === '||' || entry === ';') {
      if (segments.at(-1)?.length === 0) return null
      segments.push([])
      continue
    }
    segments.at(-1)?.push(entry)
  }
  const normalized = segments.filter((segment) => segment.length > 0)
  return normalized.length > 0 ? normalized : null
}

function parsePlainShellSegments(command: string): string[][] | null {
  if (containsShellExecutionExpansion(command)) return null
  try {
    const entries = parse(normalizeShellCommandSeparators(command), preserveShellVariable)
    return splitShellSegments(entries)
  } catch {
    return null
  }
}

function shellScriptFromWrapper(
  argv: string[]
): { shell: string; flag: string; script: string } | null {
  if (argv.length !== 3) return null
  const [shell, flag, script] = argv
  if (!shell || !flag || !script) return null
  if (flag !== '-lc' && flag !== '-c') return null
  if (!SHELL_WRAPPER_EXECUTABLES.has(basename(shell))) return null
  return { shell, flag, script }
}

function canonicalArgvForShellCommand(command: string, argv: string[]): string[] {
  const wrapper = shellScriptFromWrapper(argv)
  if (wrapper) {
    const segments = parsePlainShellSegments(wrapper.script)
    if (segments?.length === 1) return segments[0]
    return [CANONICAL_SHELL_SCRIPT_PREFIX, wrapper.flag, wrapper.script]
  }

  const segments = parsePlainShellSegments(command)
  if (segments?.length === 1) return segments[0]
  return [CANONICAL_SHELL_SCRIPT_PREFIX, '-c', command]
}

function unquoteShellWord(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function heredocSideEffects(
  command: string
): NonNullable<ToolApprovalParsedCommand['sideEffects']> {
  const effects: NonNullable<ToolApprovalParsedCommand['sideEffects']> = []
  const lines = command.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim()
    if (!line) continue
    const match =
      line.match(/^cat\s+>\s+("[^"]+"|'[^']+'|\S+)\s+<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2$/) ??
      line.match(/^cat\s+<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s+>\s+("[^"]+"|'[^']+'|\S+)$/)
    if (!match) continue

    const reverseForm =
      match.length === 4 && line.includes('<<') && line.indexOf('<<') < line.indexOf('>')
    const path = unquoteShellWord(reverseForm ? match[3] : match[1])
    const delimiter = reverseForm ? match[2] : match[3]
    const contentStart = index + 1
    let contentEnd = contentStart
    while (contentEnd < lines.length && lines[contentEnd] !== delimiter) contentEnd += 1
    const content = lines.slice(contentStart, contentEnd).join('\n')
    effects.push({
      kind: 'writeFile',
      path,
      contentPreview:
        content.length > SIDE_EFFECT_PREVIEW_CHARS
          ? content.slice(0, SIDE_EFFECT_PREVIEW_CHARS)
          : content,
      byteLength: Buffer.byteLength(content),
      truncated: content.length > SIDE_EFFECT_PREVIEW_CHARS
    })
  }
  return effects
}

function mkdirSideEffects(command: string): NonNullable<ToolApprovalParsedCommand['sideEffects']> {
  const effects: NonNullable<ToolApprovalParsedCommand['sideEffects']> = []
  const segments = parsePlainShellSegments(command)
  for (const segment of segments ?? []) {
    if (segment[0] !== 'mkdir') continue
    const paths = segment.slice(1).filter((arg) => arg !== '-p' && !arg.startsWith('-'))
    if (paths.length > 0) effects.push({ kind: 'createDirectory', paths })
  }
  return effects
}

function commandSideEffects(command: string): ToolApprovalParsedCommand['sideEffects'] {
  const effects = [...mkdirSideEffects(command), ...heredocSideEffects(command)]
  return effects.length > 0 ? effects : undefined
}

export function parseShellCommandForApproval(command: string): ToolApprovalParsedCommand {
  let entries: ParseEntry[]
  try {
    entries = parse(command, preserveShellVariable)
  } catch (error) {
    return {
      parseStatus: 'raw',
      command,
      canonicalArgv: canonicalArgvForShellCommand(command, []),
      shellScript: command,
      argv: [],
      arguments: [],
      sideEffects: commandSideEffects(command),
      error: error instanceof Error ? error.message : String(error)
    }
  }

  const argv = entries.filter((entry): entry is string => typeof entry === 'string')
  const hasUnsupportedShellSyntax =
    containsShellExecutionExpansion(command) || entries.some((entry) => typeof entry !== 'string')
  const wrapper = shellScriptFromWrapper(argv)

  return {
    parseStatus: hasUnsupportedShellSyntax ? 'partial' : 'parsed',
    command,
    canonicalArgv: canonicalArgvForShellCommand(command, argv),
    shellScript: wrapper?.script ?? (hasUnsupportedShellSyntax ? command : undefined),
    argv,
    executable: argv[0],
    arguments: argv.slice(1),
    sideEffects: commandSideEffects(wrapper?.script ?? command),
    error: hasUnsupportedShellSyntax
      ? 'Command contains shell syntax that cannot be represented exactly as argv.'
      : undefined
  }
}
