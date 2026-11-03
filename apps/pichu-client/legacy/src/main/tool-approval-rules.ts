import type {
  ToolApprovalRememberRuleProposal,
  ToolApprovalRequestForRenderer
} from '../shared/tool-approval.js'

const BANNED_PREFIX_SUGGESTIONS = [
  ['__pichu_shell_script__'],
  ['python3'],
  ['python3', '-'],
  ['python3', '-c'],
  ['python'],
  ['python', '-'],
  ['python', '-c'],
  ['py'],
  ['py', '-3'],
  ['pythonw'],
  ['pyw'],
  ['pypy'],
  ['pypy3'],
  ['git'],
  ['bash'],
  ['bash', '-lc'],
  ['sh'],
  ['sh', '-c'],
  ['sh', '-lc'],
  ['zsh'],
  ['zsh', '-lc'],
  ['/bin/zsh'],
  ['/bin/zsh', '-lc'],
  ['/bin/bash'],
  ['/bin/bash', '-lc'],
  ['pwsh'],
  ['pwsh', '-Command'],
  ['pwsh', '-c'],
  ['powershell'],
  ['powershell', '-Command'],
  ['powershell', '-c'],
  ['powershell.exe'],
  ['powershell.exe', '-Command'],
  ['powershell.exe', '-c'],
  ['env'],
  ['sudo'],
  ['node'],
  ['node', '-e'],
  ['perl'],
  ['perl', '-e'],
  ['ruby'],
  ['ruby', '-e'],
  ['php'],
  ['php', '-r'],
  ['lua'],
  ['lua', '-e'],
  ['osascript']
]

function quoteToken(token: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(token)) return token
  return `'${token.replaceAll("'", "'\\''")}'`
}

export function commandPrefixDisplay(commandPrefix: string[]): string {
  return commandPrefix.map(quoteToken).join(' ')
}

function executableName(token: string): string {
  return token.split('/').filter(Boolean).at(-1) ?? token
}

function normalizedPrefix(commandPrefix: string[]): string[] {
  return commandPrefix.map((token, index) => (index === 0 ? executableName(token) : token))
}

function prefixEquals(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((token, index) => token === right[index])
}

function isRememberablePrefix(commandPrefix: string[]): boolean {
  if (commandPrefix.length === 0) return false
  const normalized = normalizedPrefix(commandPrefix)
  return !BANNED_PREFIX_SUGGESTIONS.some((banned) => prefixEquals(normalized, banned))
}

function proposedCommandPrefix(request: ToolApprovalRequestForRenderer): string[] | null {
  if (request.toolName !== 'exec_command') return null
  const parsed = request.parsedCommand
  if (!parsed || parsed.parseStatus !== 'parsed') return null
  const commandPrefix = (parsed.canonicalArgv ?? parsed.argv)
    .map((token) => token.trim())
    .filter(Boolean)
  if (commandPrefix.length === 0) return null
  if (!isRememberablePrefix(commandPrefix)) return null
  return commandPrefix
}

export function buildToolApprovalRememberRuleProposal(
  request: ToolApprovalRequestForRenderer
): ToolApprovalRememberRuleProposal | undefined {
  const commandPrefix = proposedCommandPrefix(request)
  if (!commandPrefix) return undefined
  return {
    type: 'commandPrefix',
    commandPrefix,
    display: commandPrefixDisplay(commandPrefix)
  }
}

export function commandMatchesRememberRule(
  request: ToolApprovalRequestForRenderer,
  rule: ToolApprovalRememberRuleProposal
): boolean {
  if (rule.type !== 'commandPrefix') return false
  const parsed = request.parsedCommand
  if (!parsed || parsed.parseStatus !== 'parsed') return false
  const argv = parsed.canonicalArgv ?? parsed.argv
  if (argv.length < rule.commandPrefix.length) return false
  return rule.commandPrefix.every((token, index) => argv[index] === token)
}
