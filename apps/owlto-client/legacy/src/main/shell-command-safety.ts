import { homedir } from 'node:os'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { type ParseEntry, parse } from 'shell-quote'

type ShellSegment = string[]

const SAFE_SHELL_OPERATORS = new Set(['|', '&&', '||', ';'])
const UNSAFE_FIND_OPTIONS = new Set([
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fls',
  '-fprint',
  '-fprint0',
  '-fprintf'
])
const UNSAFE_RIPGREP_OPTIONS = new Set(['--pre', '--hostname-bin', '--search-zip', '-z'])
const UNSAFE_GIT_GLOBAL_OPTIONS = [
  '-C',
  '-c',
  '-p',
  '--config-env',
  '--exec-path',
  '--git-dir',
  '--namespace',
  '--paginate',
  '--super-prefix',
  '--work-tree'
]
const UNSAFE_GIT_SUBCOMMAND_OPTIONS = ['--output', '--ext-diff', '--textconv', '--exec']
const READ_ONLY_GIT_SUBCOMMANDS = new Set(['status', 'log', 'diff', 'show', 'branch', 'rev-parse'])
const ENVIRONMENT_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=.*$/
const ALWAYS_APPROVE_REQUIRED_EXECUTABLES = new Set([
  'doas',
  'launchctl',
  'osascript',
  'security',
  'su',
  'sudo'
])
const SHELL_WRAPPER_EXECUTABLES = new Set(['bash', 'dash', 'fish', 'sh', 'zsh'])
const INLINE_CODE_EXECUTABLE_OPTIONS = new Map<string, Set<string>>([
  ['node', new Set(['-e', '--eval', '-p', '--print'])],
  ['perl', new Set(['-e'])],
  ['python', new Set(['-c', '-m'])],
  ['python3', new Set(['-c', '-m'])],
  ['ruby', new Set(['-e'])]
])
const BRACED_HOME_VARIABLE = '$' + '{HOME}'

function shellVariable(name: string): string {
  return `$${name}`
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

function containsShellExecutionExpansion(command: string): boolean {
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

function splitShellSegments(entries: ParseEntry[]): ShellSegment[] | null {
  const segments: ShellSegment[] = []
  let current: string[] = []

  for (const entry of entries) {
    if (typeof entry === 'string') {
      current.push(entry)
      continue
    }

    if (!entry || typeof entry !== 'object' || !('op' in entry)) return null
    const operator = String(entry.op)
    if (!SAFE_SHELL_OPERATORS.has(operator)) return null
    if (current.length === 0) return null
    segments.push(current)
    current = []
  }

  if (current.length === 0) return null
  segments.push(current)
  return segments
}

function isOptionWithValue(option: string): boolean {
  return !option.includes('=') && !option.startsWith('-I')
}

function hasUnsafeOption(args: string[], unsafeOptions: Set<string>): boolean {
  for (const arg of args) {
    if (unsafeOptions.has(arg)) return true
    for (const option of unsafeOptions) {
      if (isOptionWithValue(option) && arg.startsWith(`${option}=`)) return true
    }
  }
  return false
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value === '.' || value === './') return true
  if (value === '..' || value.startsWith('../') || value.startsWith('/')) return false
  if (value.split('/').includes('..')) return false
  if (value === '~' || value.startsWith('~/') || value.startsWith('$HOME')) return false
  return true
}

function shellOptionValue(arg: string): string | null {
  if (!arg.startsWith('-')) return null
  const equalsIndex = arg.indexOf('=')
  if (equalsIndex <= 0) return null
  return arg.slice(equalsIndex + 1)
}

function commandHasOnlySafeRelativePaths(args: string[]): boolean {
  return args.every((arg) => {
    if (arg === '--') return true

    const optionValue = shellOptionValue(arg)
    if (optionValue !== null) return isSafeRelativePath(optionValue)
    if (arg.startsWith('-')) return true
    return isSafeRelativePath(arg)
  })
}

function gitOptionMatches(arg: string, option: string): boolean {
  return (
    arg === option ||
    arg.startsWith(`${option}=`) ||
    (option.length === 2 && arg.startsWith(option) && arg.length > 2)
  )
}

function gitSubcommand(args: string[]): string | null {
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) continue
    if (UNSAFE_GIT_GLOBAL_OPTIONS.some((option) => gitOptionMatches(arg, option))) return null
    if (arg === '--' || arg.startsWith('-')) continue
    return arg
  }
  return null
}

function isSafeGitCommand(args: string[]): boolean {
  let subcommandIndex = -1

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) continue
    if (UNSAFE_GIT_GLOBAL_OPTIONS.some((option) => gitOptionMatches(arg, option))) return false
    if (arg === '--' || arg.startsWith('-')) continue
    if (!READ_ONLY_GIT_SUBCOMMANDS.has(arg)) return false
    subcommandIndex = index
    break
  }

  if (subcommandIndex === -1) return false
  const subcommand = args[subcommandIndex]
  const subcommandArgs = args.slice(subcommandIndex + 1)
  if (
    subcommandArgs.some((arg) =>
      UNSAFE_GIT_SUBCOMMAND_OPTIONS.some((option) => gitOptionMatches(arg, option))
    )
  ) {
    return false
  }

  if (subcommand !== 'branch') return true
  if (subcommandArgs.length === 0) return true
  return subcommandArgs.every(
    (arg) =>
      arg === '--list' ||
      arg === '-l' ||
      arg === '--show-current' ||
      arg === '-a' ||
      arg === '--all' ||
      arg === '-r' ||
      arg === '--remotes' ||
      arg === '-v' ||
      arg === '-vv' ||
      arg === '--verbose' ||
      arg.startsWith('--format=')
  )
}

function isSafeSedCommand(args: string[]): boolean {
  if (args.length < 3 || args.length > 4) return false
  if (args[1] !== '-n') return false
  if (!/^(\d+,)?\d+p$/.test(args[2] ?? '')) return false
  return args.length === 3 || isSafeRelativePath(args[3] ?? '')
}

function isSafeReadOnlySegment(segment: ShellSegment): boolean {
  const executable = segment[0]
  if (!executable) return false
  const args = segment.slice(1)

  switch (executable) {
    case 'pwd':
    case 'whoami':
    case 'id':
    case 'uname':
    case 'true':
    case 'false':
    case 'echo':
      return true
    case 'which':
      return args.length > 0 && commandHasOnlySafeRelativePaths(args)
    case 'command':
      return (args[0] === '-v' || args[0] === '-V') && args.length >= 2
    case 'git':
      return isSafeGitCommand(segment)
    case 'sed':
      return isSafeSedCommand(segment)
    case 'find':
      return !hasUnsafeOption(args, UNSAFE_FIND_OPTIONS) && commandHasOnlySafeRelativePaths(args)
    case 'rg':
    case 'grep':
      return !hasUnsafeOption(args, UNSAFE_RIPGREP_OPTIONS) && commandHasOnlySafeRelativePaths(args)
    case 'cat':
    case 'head':
    case 'tail':
    case 'ls':
    case 'nl':
    case 'stat':
    case 'wc':
      return commandHasOnlySafeRelativePaths(args)
    default:
      return false
  }
}

export function isKnownSafeReadOnlyShellCommand(command: string): boolean {
  if (containsShellExecutionExpansion(command)) return false

  let entries: ParseEntry[]
  try {
    entries = parse(normalizeShellCommandSeparators(command), shellVariable)
  } catch {
    return false
  }

  const segments = splitShellSegments(entries)
  return Boolean(segments?.length && segments.every(isSafeReadOnlySegment))
}

function isEnvironmentAssignment(token: string | undefined): boolean {
  return Boolean(token && ENVIRONMENT_ASSIGNMENT_PATTERN.test(token))
}

function environmentAssignmentKey(token: string): string {
  return token.slice(0, token.indexOf('='))
}

function isRiskyEnvironmentAssignmentKey(key: string): boolean {
  return (
    key === 'PATH' ||
    key === 'ENV' ||
    key === 'BASH_ENV' ||
    key.startsWith('LD_') ||
    key.startsWith('DYLD_')
  )
}

function isAssignmentOnlySegment(segment: ShellSegment): boolean {
  return segment.length > 0 && segment.every(isEnvironmentAssignment)
}

function executableName(executable: string): string {
  return basename(executable)
}

function expandsToAbsolutePath(value: string): string | null {
  if (!value || value.includes('\0')) return null
  if (/[*?[\]{}]/.test(value)) return null

  let expanded = value
  if (expanded === '~') expanded = homedir()
  else if (expanded.startsWith('~/')) expanded = resolve(homedir(), expanded.slice(2))
  else if (expanded === '$HOME' || expanded === BRACED_HOME_VARIABLE) expanded = homedir()
  else if (expanded.startsWith('$HOME/')) expanded = resolve(homedir(), expanded.slice(6))
  else if (expanded.startsWith(`${BRACED_HOME_VARIABLE}/`)) {
    expanded = resolve(homedir(), expanded.slice(BRACED_HOME_VARIABLE.length + 1))
  }

  return isAbsolute(expanded) ? resolve(expanded) : null
}

function pathIsOutsideCwd(path: string, cwd: string): boolean {
  const normalizedCwd = resolve(cwd)
  const normalizedPath = resolve(path)
  const fromCwd = relative(normalizedCwd, normalizedPath)
  return fromCwd === '' ? false : fromCwd.startsWith('..') || isAbsolute(fromCwd)
}

function segmentHasExternalPath(segment: ShellSegment, cwd: string): boolean {
  return segment.slice(1).some((arg) => {
    if (arg === '--') return false
    const optionValue = shellOptionValue(arg)
    if (optionValue !== null) {
      const path = expandsToAbsolutePath(optionValue)
      return path ? pathIsOutsideCwd(path, cwd) : false
    }
    if (arg.startsWith('-')) return false
    const path = expandsToAbsolutePath(arg)
    return path ? pathIsOutsideCwd(path, cwd) : false
  })
}

function gitCommandRequiresApproval(segment: ShellSegment): boolean {
  const subcommand = gitSubcommand(segment)
  return subcommand === null || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)
}

function inlineCodeCommandRequiresApproval(executable: string, args: string[]): boolean {
  const options = INLINE_CODE_EXECUTABLE_OPTIONS.get(executable)
  if (!options) return false
  return args.some((arg) => options.has(arg))
}

function segmentRequiresAutoApproval(segment: ShellSegment, cwd: string): boolean {
  if (isAssignmentOnlySegment(segment)) return false

  const executableIndex = segment.findIndex((token) => !isEnvironmentAssignment(token))
  if (executableIndex === -1) return false

  if (
    segment
      .slice(0, executableIndex)
      .some((token) => isRiskyEnvironmentAssignmentKey(environmentAssignmentKey(token)))
  ) {
    return true
  }

  const executable = segment[executableIndex]
  if (!executable) return true
  const name = executableName(executable)
  const args = segment.slice(executableIndex + 1)
  const commandSegment = [executable, ...args]

  if (ALWAYS_APPROVE_REQUIRED_EXECUTABLES.has(name)) return true
  if (SHELL_WRAPPER_EXECUTABLES.has(name)) return true
  if (inlineCodeCommandRequiresApproval(name, args)) return true
  if (segmentHasExternalPath(commandSegment, cwd)) return true
  if (name === 'git') return gitCommandRequiresApproval(commandSegment)
  return false
}

export function bashCommandRequiresAutoApproval(command: string, cwd: string): boolean {
  if (!command.trim()) return true
  if (containsShellExecutionExpansion(command)) return true

  let entries: ParseEntry[]
  try {
    entries = parse(normalizeShellCommandSeparators(command), shellVariable)
  } catch {
    return true
  }

  const segments = splitShellSegments(entries)
  if (!segments?.length) return true
  return segments.some((segment) => segmentRequiresAutoApproval(segment, cwd))
}
