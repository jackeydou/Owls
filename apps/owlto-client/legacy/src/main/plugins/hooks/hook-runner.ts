import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { userInfo } from 'node:os'
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import type {
  AfterToolCallResult,
  AgentToolResult,
  BeforeToolCallResult
} from '@earendil-works/pi-agent-core'
import type { ToolApprovalUiSpec } from '../../../shared/tool-approval.js'
import {
  type EnabledPluginHookDeclaration,
  getEnabledPluginHookDeclarationsAsync,
  recordPluginHookAuditAsync
} from '../plugin-registry.js'
import type {
  AgentHookConfig,
  AgentHookEventName,
  AgentHookMatcherGroup,
  PluginHookDeclaration
} from './hook-types.js'

const DEFAULT_HOOK_TIMEOUT_MS = 600_000
const MAX_CAPTURED_OUTPUT_CHARS = 64_000
const HOOK_KILL_GRACE_MS = 2_000
const ALLOWED_COMMAND_EXECUTABLES = new Set(['node', 'python', 'python3', 'bash', 'sh'])

export type HookCommonInput = {
  session_id: string
  transcript_path: string | null
  cwd: string
  hook_event_name: AgentHookEventName
  model?: string
  turn_id?: string
}

export type HookRunContext = {
  sessionId: string
  cwd: string
  model?: string
  turnId?: string
  signal?: AbortSignal
}

export type HookRunDecision = {
  additionalContext: string[]
  blockReason?: string
  denyReason?: string
  permissionAllowed: boolean
  preToolPermissionDecision?: 'allow' | 'ask'
  approvalUi?: ToolApprovalUiSpec
  updatedInput?: unknown
  stopContinuationMessage?: string
  stopContinueFalse: boolean
  replaceToolResult?: AgentToolResult<Record<string, unknown>>
}

export type PreToolUseHookResult = BeforeToolCallResult & {
  updatedInput?: unknown
  permissionDecision?: 'allow' | 'ask'
  approvalUi?: ToolApprovalUiSpec
}

type HookProcessResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  error?: string
  durationMs: number
}

type HookExecutionTarget = {
  plugin: EnabledPluginHookDeclaration
  declaration: PluginHookDeclaration
  group: AgentHookMatcherGroup
  groupIndex: number
  hookIndex: number
  command: string
  timeoutMs: number
  matcher?: string
}

type ParsedHookOutput = {
  additionalContext?: string
  blockReason?: string
  denyReason?: string
  permissionAllowed?: boolean
  preToolPermissionDecision?: 'allow' | 'ask'
  approvalUi?: ToolApprovalUiSpec
  updatedInput?: unknown
  stopContinuationMessage?: string
  stopContinueFalse?: boolean
  replaceToolResult?: AgentToolResult<Record<string, unknown>>
  ignoredUpdatedMcpToolOutput?: boolean
  ignoredSuppressOutput?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = normalize(parent)
  const normalizedChild = normalize(child)
  return (
    normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${sep}`)
  )
}

function stripSimpleQuotes(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function tokenizeCommand(command: string): string[] {
  return command.match(/'[^']*'|"[^"]*"|\S+/g) ?? []
}

function managedDirectories(config: AgentHookConfig, pluginRoot: string): string[] {
  return [config.managed_dir, config.windows_managed_dir]
    .map((entry) => entry?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => (isAbsolute(entry) ? entry : resolve(pluginRoot, entry)))
}

function resolvePluginRelativeToken(token: string, pluginRoot: string): string {
  const unquoted = stripSimpleQuotes(token)
  const resolved = resolve(pluginRoot, unquoted)
  if (!isPathInside(pluginRoot, resolved)) {
    throw new Error(`Hook command path escapes plugin root: ${unquoted}`)
  }
  return shellQuote(resolved)
}

function resolveAbsoluteManagedToken(token: string, managedDirs: string[]): string {
  const unquoted = stripSimpleQuotes(token)
  if (!managedDirs.some((managedDir) => isPathInside(managedDir, unquoted))) {
    throw new Error(`Hook command absolute path is outside managed hook directories: ${unquoted}`)
  }
  return shellQuote(unquoted)
}

export function prepareHookCommand(
  command: string,
  pluginRoot: string,
  config: AgentHookConfig = {}
): string {
  const tokens = tokenizeCommand(command)
  if (tokens.length === 0) {
    throw new Error('Hook command is empty')
  }

  const managedDirs = managedDirectories(config, pluginRoot)
  const executable = stripSimpleQuotes(tokens[0])
  if (isAbsolute(executable) && managedDirs.length === 0) {
    throw new Error('Hook command executable must not be an absolute path')
  }
  if (
    !isAbsolute(executable) &&
    !executable.startsWith('./') &&
    !ALLOWED_COMMAND_EXECUTABLES.has(executable)
  ) {
    throw new Error(`Hook command executable is not allowed: ${executable}`)
  }

  return tokens
    .map((token, index) => {
      const unquoted = stripSimpleQuotes(token)
      if (isAbsolute(unquoted)) {
        return resolveAbsoluteManagedToken(token, managedDirs)
      }
      if (unquoted.startsWith('./')) {
        return resolvePluginRelativeToken(token, pluginRoot)
      }
      if (index === 0 && executable.startsWith('./')) {
        return resolvePluginRelativeToken(token, pluginRoot)
      }
      return token
    })
    .join(' ')
}

export function getDefaultHookShell(): string {
  try {
    const shell = userInfo().shell?.trim()
    return shell && isAbsolute(shell) ? shell : '/bin/sh'
  } catch {
    return '/bin/sh'
  }
}

function appendCapturedOutput(current: string, chunk: Buffer): string {
  if (current.length >= MAX_CAPTURED_OUTPUT_CHARS) return current
  return `${current}${chunk.toString('utf8')}`.slice(0, MAX_CAPTURED_OUTPUT_CHARS)
}

async function runCommandHook(params: {
  command: string
  pluginRoot: string
  config: AgentHookConfig
  cwd: string
  input: Record<string, unknown>
  timeoutMs: number
  signal?: AbortSignal
}): Promise<HookProcessResult> {
  const startedAt = Date.now()
  let preparedCommand: string
  try {
    preparedCommand = prepareHookCommand(params.command, params.pluginRoot, params.config)
  } catch (error) {
    return {
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      aborted: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    }
  }

  return new Promise((resolveProcess) => {
    const child = spawn(getDefaultHookShell(), ['-c', preparedCommand], {
      cwd: params.cwd,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let aborted = false
    let spawnError: string | undefined

    const settle = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      params.signal?.removeEventListener('abort', abort)
      resolveProcess({
        exitCode,
        stdout,
        stderr,
        timedOut,
        aborted,
        error: spawnError,
        durationMs: Date.now() - startedAt
      })
    }

    const killProcessGroup = (signal: NodeJS.Signals): void => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal)
          return
        } catch {
          // Fall back to the shell process below.
        }
      }
      child.kill(signal)
    }

    const terminate = (): void => {
      killProcessGroup('SIGTERM')
      setTimeout(() => {
        if (!settled) {
          killProcessGroup('SIGKILL')
        }
      }, HOOK_KILL_GRACE_MS).unref()
    }

    const abort = (): void => {
      aborted = true
      terminate()
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, params.timeoutMs)

    params.signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendCapturedOutput(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendCapturedOutput(stderr, chunk)
    })
    child.on('error', (error) => {
      spawnError = error.message
    })
    child.on('close', (exitCode) => {
      settle(exitCode)
    })
    child.stdin.end(`${JSON.stringify(params.input)}\n`, 'utf8')
  })
}

function matcherMatches(matcher: string | undefined, value: string): boolean {
  if (matcher === undefined) return true
  const trimmed = matcher.trim()
  if (!trimmed || trimmed === '*') return true
  try {
    return new RegExp(trimmed).test(value)
  } catch {
    return false
  }
}

function matchingTargets(params: {
  plugins: EnabledPluginHookDeclaration[]
  eventName: AgentHookEventName
  matcherValues: string[]
}): HookExecutionTarget[] {
  const targets: HookExecutionTarget[] = []
  for (const plugin of params.plugins) {
    for (const declaration of plugin.hookDeclarations) {
      const groups = declaration.config.hooks?.[params.eventName] ?? []
      groups.forEach((group, groupIndex) => {
        if (
          !params.matcherValues.some((matcherValue) => matcherMatches(group.matcher, matcherValue))
        ) {
          return
        }
        group.hooks.forEach((hook, hookIndex) => {
          targets.push({
            plugin,
            declaration,
            group,
            groupIndex,
            hookIndex,
            command: hook.command,
            timeoutMs: Math.min(
              Math.max(Math.round((hook.timeout ?? DEFAULT_HOOK_TIMEOUT_MS / 1000) * 1000), 1),
              DEFAULT_HOOK_TIMEOUT_MS
            ),
            matcher: group.matcher
          })
        })
      })
    }
  }
  return targets.sort(
    (left, right) =>
      left.plugin.pluginName.localeCompare(right.plugin.pluginName) ||
      left.plugin.pluginId.localeCompare(right.plugin.pluginId) ||
      left.declaration.source.index - right.declaration.source.index ||
      left.groupIndex - right.groupIndex ||
      left.hookIndex - right.hookIndex
  )
}

function parseJsonOutput(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getAdditionalContext(parsed: Record<string, unknown>): string | undefined {
  const specific = parsed.hookSpecificOutput
  if (isRecord(specific)) {
    return getString(specific.additionalContext)
  }
  return getString(parsed.additionalContext)
}

function parseApprovalUi(value: unknown): ToolApprovalUiSpec | undefined {
  if (!isRecord(value)) return undefined
  if (value.renderer === 'json-render' && hasOwnField(value, 'spec')) {
    const approvalUi: ToolApprovalUiSpec = {
      renderer: 'json-render',
      spec: value.spec
    }
    if (isRecord(value.state)) {
      approvalUi.state = value.state
    }
    return approvalUi
  }
  if (typeof value.root === 'string' && isRecord(value.elements)) {
    return { renderer: 'json-render', spec: value }
  }
  return undefined
}

function redactSensitiveString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(authorization|cookie|token|secret|password)\s*[:=]\s*([^&\s]+)/gi, '$1=[redacted]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[redacted]')
}

function redactedDetail(value: string | undefined): string | undefined {
  return value ? redactSensitiveString(value).slice(0, 500) : value
}

function hasOwnField(value: Record<string, unknown>, field: string): boolean {
  return Object.hasOwn(value, field)
}

function hasUnsupportedPermissionRequestFields(parsed: Record<string, unknown>): boolean {
  if (
    hasOwnField(parsed, 'updatedInput') ||
    hasOwnField(parsed, 'updatedPermissions') ||
    hasOwnField(parsed, 'interrupt')
  ) {
    return true
  }

  const specific = parsed.hookSpecificOutput
  return (
    isRecord(specific) &&
    (hasOwnField(specific, 'updatedInput') ||
      hasOwnField(specific, 'updatedPermissions') ||
      hasOwnField(specific, 'interrupt'))
  )
}

function permissionRequestDecision(parsed: Record<string, unknown>): ParsedHookOutput {
  if (hasUnsupportedPermissionRequestFields(parsed)) {
    return {
      denyReason:
        'PermissionRequest hook returned unsupported permission mutation fields and was denied.'
    }
  }

  const specific = parsed.hookSpecificOutput
  const approvalUi =
    parseApprovalUi(isRecord(specific) ? specific.approvalUi : undefined) ??
    parseApprovalUi(parsed.approvalUi)
  if (!isRecord(specific)) return approvalUi ? { approvalUi } : {}

  const decision = specific.decision
  if (!isRecord(decision)) return approvalUi ? { approvalUi } : {}

  const behavior = getString(decision.behavior)
  if (behavior === 'allow') return { permissionAllowed: true }
  if (behavior === 'deny') {
    return {
      denyReason:
        getString(decision.message) ??
        getString(decision.reason) ??
        getString(specific.message) ??
        'PermissionRequest hook denied tool approval.'
    }
  }
  return approvalUi ? { approvalUi } : {}
}

function preToolOutput(parsed: Record<string, unknown>): ParsedHookOutput {
  const specific = parsed.hookSpecificOutput
  const specificRecord = isRecord(specific) ? specific : undefined
  const permissionDecision = isRecord(specific) ? getString(specific.permissionDecision) : undefined
  const output: ParsedHookOutput = {}
  if (specificRecord && hasOwnField(specificRecord, 'updatedInput')) {
    output.updatedInput = specificRecord.updatedInput
  } else if (hasOwnField(parsed, 'updatedInput')) {
    output.updatedInput = parsed.updatedInput
  }
  if (permissionDecision === 'allow' || permissionDecision === 'ask') {
    output.preToolPermissionDecision = permissionDecision
  }
  const approvalUi =
    parseApprovalUi(specificRecord?.approvalUi) ?? parseApprovalUi(parsed.approvalUi)
  if (approvalUi) {
    output.approvalUi = approvalUi
  }
  return output
}

function reservedPostToolOutput(parsed: Record<string, unknown>): ParsedHookOutput {
  const specific = parsed.hookSpecificOutput
  const specificRecord = isRecord(specific) ? specific : undefined
  return {
    ignoredUpdatedMcpToolOutput:
      hasOwnField(parsed, 'updatedMCPToolOutput') ||
      Boolean(specificRecord && hasOwnField(specificRecord, 'updatedMCPToolOutput')),
    ignoredSuppressOutput:
      hasOwnField(parsed, 'suppressOutput') ||
      Boolean(specificRecord && hasOwnField(specificRecord, 'suppressOutput'))
  }
}

function hookFeedbackResult(text: string): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: 'text', text }],
    details: { hookFeedback: text }
  }
}

function interpretOutput(
  eventName: AgentHookEventName,
  processResult: HookProcessResult
): ParsedHookOutput {
  const stderr = processResult.stderr.trim()
  if (processResult.exitCode === 2) {
    const reason = stderr || 'Hook requested that execution stop.'
    if (eventName === 'Stop') return { stopContinuationMessage: reason }
    if (eventName === 'PreToolUse') return { denyReason: reason }
    if (eventName === 'PermissionRequest') return { denyReason: reason }
    if (eventName === 'PostToolUse') return { replaceToolResult: hookFeedbackResult(reason) }
    if (eventName === 'UserPromptSubmit') return { blockReason: reason }
    return {}
  }

  if (
    processResult.exitCode !== 0 ||
    processResult.timedOut ||
    processResult.aborted ||
    processResult.error
  ) {
    return {}
  }

  const trimmedStdout = processResult.stdout.trim()
  if (!trimmedStdout) return {}

  if (eventName === 'SessionStart' || eventName === 'UserPromptSubmit') {
    const parsed = parseJsonOutput(trimmedStdout)
    if (!parsed) return { additionalContext: trimmedStdout }
    const legacyDecision = getString(parsed.decision)
    if (eventName === 'UserPromptSubmit' && legacyDecision === 'block') {
      return { blockReason: getString(parsed.reason) ?? 'Hook blocked the prompt.' }
    }
    return { additionalContext: getAdditionalContext(parsed) }
  }

  const parsed = parseJsonOutput(trimmedStdout)
  if (!parsed) return {}

  const legacyDecision = getString(parsed.decision)
  if (eventName === 'PreToolUse') {
    const preTool = preToolOutput(parsed)
    const specific = parsed.hookSpecificOutput
    const permissionDecision = isRecord(specific)
      ? getString(specific.permissionDecision)
      : undefined
    if (permissionDecision === 'deny') {
      return {
        ...preTool,
        denyReason:
          (isRecord(specific) ? getString(specific.permissionDecisionReason) : undefined) ??
          'Hook denied tool execution.'
      }
    }
    if (legacyDecision === 'block') {
      return { ...preTool, denyReason: getString(parsed.reason) ?? 'Hook blocked tool execution.' }
    }
    return preTool
  }

  if (eventName === 'PermissionRequest') {
    return permissionRequestDecision(parsed)
  }

  if (eventName === 'PostToolUse') {
    const reserved = reservedPostToolOutput(parsed)
    if (parsed.continue === false || legacyDecision === 'block') {
      return {
        ...reserved,
        replaceToolResult: hookFeedbackResult(
          getString(parsed.reason) ?? 'Hook requested that the model stop using this tool result.'
        )
      }
    }
    return { ...reserved, additionalContext: getAdditionalContext(parsed) }
  }

  if (eventName === 'Stop') {
    const reserved = {
      ignoredSuppressOutput: hasOwnField(parsed, 'suppressOutput')
    }
    if (parsed.continue === false) return { stopContinueFalse: true }
    if (parsed.continue === true || legacyDecision === 'block') {
      return {
        ...reserved,
        stopContinuationMessage:
          getString(parsed.systemMessage) ??
          getString(parsed.reason) ??
          'A Stop hook requested one continuation.'
      }
    }
  }

  return {}
}

function buildInput(params: {
  context: HookRunContext
  eventName: AgentHookEventName
  extraInput?: Record<string, unknown>
}): Record<string, unknown> {
  return {
    session_id: params.context.sessionId,
    transcript_path: null,
    cwd: params.context.cwd,
    hook_event_name: params.eventName,
    model: params.context.model,
    turn_id: params.context.turnId,
    ...params.extraInput
  }
}

async function auditHookExecution(
  target: HookExecutionTarget,
  eventName: AgentHookEventName,
  processResult: HookProcessResult,
  decision: ParsedHookOutput
): Promise<void> {
  await recordPluginHookAuditAsync({
    pluginId: target.plugin.pluginId,
    pluginName: target.plugin.pluginName,
    marketplaceName: target.plugin.marketplaceName,
    message: `Ran ${eventName} hook`,
    level: processResult.exitCode === 0 && !processResult.error ? 'info' : 'warning',
    details: {
      eventName,
      matcher: target.matcher ?? '*',
      commandHash: createHash('sha256').update(target.command).digest('hex'),
      source: target.declaration.source,
      timeoutMs: target.timeoutMs,
      durationMs: processResult.durationMs,
      exitCode: processResult.exitCode,
      timedOut: processResult.timedOut,
      aborted: processResult.aborted,
      stderr: redactedDetail(processResult.stderr.trim()),
      error: redactedDetail(processResult.error),
      decision: {
        additionalContext: Boolean(decision.additionalContext),
        blocked: Boolean(decision.blockReason),
        denied: Boolean(decision.denyReason),
        permissionAllowed: Boolean(decision.permissionAllowed),
        updatedInput: decision.updatedInput !== undefined,
        preToolPermissionDecision: decision.preToolPermissionDecision,
        approvalUi: Boolean(decision.approvalUi),
        ignoredUpdatedMcpToolOutput: Boolean(decision.ignoredUpdatedMcpToolOutput),
        ignoredSuppressOutput: Boolean(decision.ignoredSuppressOutput),
        stopContinuation: Boolean(decision.stopContinuationMessage),
        stopContinueFalse: Boolean(decision.stopContinueFalse),
        replaceToolResult: Boolean(decision.replaceToolResult)
      }
    }
  })
}

export async function runAgentHookEvent(params: {
  eventName: AgentHookEventName
  matcherValue?: string
  matcherValues?: string[]
  context: HookRunContext
  extraInput?: Record<string, unknown>
}): Promise<HookRunDecision> {
  const plugins = await getEnabledPluginHookDeclarationsAsync()
  const targets = matchingTargets({
    plugins,
    eventName: params.eventName,
    matcherValues: params.matcherValues ?? [params.matcherValue ?? '']
  })
  let input = buildInput({
    context: params.context,
    eventName: params.eventName,
    extraInput: params.extraInput
  })
  const decisions: ParsedHookOutput[] = []
  for (const target of targets) {
    const processResult = await runCommandHook({
      command: target.command,
      pluginRoot: target.plugin.pluginRoot,
      config: target.declaration.config,
      cwd: params.context.cwd,
      input,
      timeoutMs: target.timeoutMs,
      signal: params.context.signal
    })
    const decision = interpretOutput(params.eventName, processResult)
    await auditHookExecution(target, params.eventName, processResult, decision)
    decisions.push(decision)
    if (params.eventName === 'PreToolUse' && decision.updatedInput !== undefined) {
      input = { ...input, tool_input: decision.updatedInput }
    }
  }

  return {
    additionalContext: decisions
      .map((decision) => decision.additionalContext)
      .filter((value): value is string => Boolean(value)),
    blockReason: decisions.find((decision) => decision.blockReason)?.blockReason,
    denyReason: decisions.find((decision) => decision.denyReason)?.denyReason,
    permissionAllowed: decisions.some((decision) => decision.permissionAllowed),
    preToolPermissionDecision:
      decisions.find((decision) => decision.preToolPermissionDecision === 'allow')
        ?.preToolPermissionDecision ??
      decisions.find((decision) => decision.preToolPermissionDecision === 'ask')
        ?.preToolPermissionDecision,
    approvalUi: [...decisions].reverse().find((decision) => decision.approvalUi)?.approvalUi,
    updatedInput: [...decisions].reverse().find((decision) => decision.updatedInput !== undefined)
      ?.updatedInput,
    stopContinuationMessage: decisions.find((decision) => decision.stopContinuationMessage)
      ?.stopContinuationMessage,
    stopContinueFalse: decisions.some((decision) => decision.stopContinueFalse),
    replaceToolResult: decisions.find((decision) => decision.replaceToolResult)?.replaceToolResult
  }
}

function toolAliasNames(toolName: string): string[] {
  const aliases = new Set([toolName])
  if (toolName === 'apply_patch') {
    aliases.add('Edit')
    aliases.add('Write')
  }
  return [...aliases]
}

function toolInputWithDescription(
  toolInput: unknown,
  description: string
): Record<string, unknown> {
  if (isRecord(toolInput)) {
    return { ...toolInput, description }
  }
  return { value: toolInput, description }
}

export async function runPreToolUseHooks(params: {
  context: HookRunContext
  toolName: string
  toolUseId: string
  toolInput: unknown
  matcherValues?: string[]
  signal?: AbortSignal
}): Promise<PreToolUseHookResult | undefined> {
  const decision = await runAgentHookEvent({
    eventName: 'PreToolUse',
    matcherValues: params.matcherValues ?? toolAliasNames(params.toolName),
    context: { ...params.context, signal: params.signal ?? params.context.signal },
    extraInput: {
      tool_name: params.toolName,
      tool_use_id: params.toolUseId,
      tool_input: params.toolInput
    }
  })
  if (decision.denyReason) {
    return { block: true, reason: decision.denyReason }
  }
  if (
    decision.updatedInput !== undefined ||
    decision.preToolPermissionDecision ||
    decision.approvalUi
  ) {
    const result: PreToolUseHookResult = {
      updatedInput: decision.updatedInput,
      permissionDecision: decision.preToolPermissionDecision
    }
    if (decision.approvalUi) {
      result.approvalUi = decision.approvalUi
    }
    return result
  }
  return undefined
}

export async function runPermissionRequestHooks(params: {
  context: HookRunContext
  toolName: string
  toolUseId: string
  toolInput: unknown
  description: string
  matcherValues?: string[]
  signal?: AbortSignal
}): Promise<{
  behavior: 'allow' | 'deny' | 'ask'
  reason?: string
  approvalUi?: ToolApprovalUiSpec
}> {
  const decision = await runAgentHookEvent({
    eventName: 'PermissionRequest',
    matcherValues: params.matcherValues ?? toolAliasNames(params.toolName),
    context: { ...params.context, signal: params.signal ?? params.context.signal },
    extraInput: {
      tool_name: params.toolName,
      tool_use_id: params.toolUseId,
      tool_input: toolInputWithDescription(params.toolInput, params.description)
    }
  })
  if (decision.denyReason) {
    return { behavior: 'deny', reason: decision.denyReason }
  }
  if (decision.permissionAllowed) {
    return { behavior: 'allow' }
  }
  return decision.approvalUi
    ? { behavior: 'ask', approvalUi: decision.approvalUi }
    : { behavior: 'ask' }
}

export async function runPostToolUseHooks(params: {
  context: HookRunContext
  toolName: string
  toolUseId: string
  toolInput: unknown
  toolResponse: unknown
  isError: boolean
  matcherValues?: string[]
  signal?: AbortSignal
}): Promise<AfterToolCallResult | undefined> {
  const decision = await runAgentHookEvent({
    eventName: 'PostToolUse',
    matcherValues: params.matcherValues ?? toolAliasNames(params.toolName),
    context: { ...params.context, signal: params.signal ?? params.context.signal },
    extraInput: {
      tool_name: params.toolName,
      tool_use_id: params.toolUseId,
      tool_input: params.toolInput,
      tool_response: params.toolResponse,
      tool_error: params.isError
    }
  })
  if (decision.replaceToolResult) {
    return {
      content: decision.replaceToolResult.content,
      details: decision.replaceToolResult.details,
      isError: true
    }
  }
  return undefined
}
