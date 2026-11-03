import type { AgentTool } from '@earendil-works/pi-agent-core'
import type {
  AgentTrustProfile,
  ToolApprovalAutoReviewAction,
  ToolApprovalSubject
} from '../../shared/tool-approval.js'
import { oauthProviderForCustomMcpServer } from '../custom-mcp-oauth.js'
import { isFeatureGated } from '../feature-gates/local-feature-gate-service.js'
import type { HumanInputRuntimeContext } from '../human-input-runtime.js'
import { createLeadTeamTools } from '../multi-agent/team-tools.js'
import { createEnabledPluginMcpToolsAsync } from '../plugins/mcp-runtime.js'
import {
  getEnabledPluginBinPathsAsync,
  getEnabledPluginMcpServersAsync
} from '../plugins/plugin-registry.js'
import { getUsePluginStatusesAsync } from '../plugins/use-plugin-status.js'
import { bashCommandRequiresAutoApproval } from '../shell-command-safety.js'
import { customMcpRuntimeDataPath, enabledCustomMcpServers } from '../stores/custom-mcp-store.js'
import { getAgentTrustProfile } from '../stores/settings-store.js'
import { withToolApproval } from '../tool-approval-metadata.js'
import { readFileChangePreviews, readFileWritePaths } from './auto-review-actions.js'
import { createPichuCodingTools } from './coding.js'
import { createComputerUseTools } from './computer-use/index.js'
import { createCronJobTool } from './cron.js'
import { createEmbeddedBrowserTools } from './embedded-browser.js'
import { createAskUserInputTool } from './human-input.js'
import { createImageGenerationToolIfConfigured } from './image-generation.js'
import { createSopTools } from './sop.js'
import { createWorkbenchTools } from './workbench.js'

const ASK_PROFILE_TOOL_NAMES = new Set([
  'exec_command',
  'edit',
  'write',
  'apply_patch',
  'image_generate'
])

const AUTO_PROFILE_TOOL_NAMES = new Set(['edit', 'write', 'apply_patch'])

const PROFILE_APPROVAL_TOOL_NAMES = new Set([...ASK_PROFILE_TOOL_NAMES, ...AUTO_PROFILE_TOOL_NAMES])

function isShellExecTool(toolName: string): boolean {
  return toolName === 'exec_command'
}

function readStringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const fieldValue = (value as Record<string, unknown>)[field]
  return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue.trim() : undefined
}

function readShellCommandInput(toolName: string, toolInput: unknown): string | undefined {
  if (toolName === 'exec_command') {
    return readStringField(toolInput, 'cmd') ?? readStringField(toolInput, 'command')
  }
  return undefined
}

type ToolParametersWithProperties = AgentTool['parameters'] & {
  type?: unknown
  properties?: Record<string, unknown>
}

function withApprovalJustificationParameter(tool: AgentTool): AgentTool {
  const parameters = tool.parameters as ToolParametersWithProperties
  if (
    parameters.type !== 'object' ||
    !parameters.properties ||
    Object.hasOwn(parameters.properties, 'justification')
  ) {
    return tool
  }
  return {
    ...tool,
    parameters: {
      ...parameters,
      properties: {
        ...parameters.properties,
        justification: {
          type: 'string',
          description:
            'Short user-facing reason for the approval request. Phrase it as the question the user should answer.'
        }
      }
    }
  }
}

function describeAskApprovalTool(tool: AgentTool, toolInput: unknown): string | undefined {
  if (isShellExecTool(tool.name)) {
    const command = readShellCommandInput(tool.name, toolInput)
    return command ? `Run ${command}` : 'Run a shell command'
  }
  if (tool.name === 'edit' || tool.name === 'write' || tool.name === 'apply_patch') {
    const paths = readFileWritePaths(tool.name, toolInput)
    if (paths.length === 0) return 'Edit files'
    if (paths.length === 1) return `Edit ${paths[0]}`
    const previewCount = 2
    const preview = paths.slice(0, previewCount).join(', ')
    const suffix = paths.length > previewCount ? ', ...' : ''
    return `Edit ${paths.length} files: ${preview}${suffix}`
  }
  if (tool.name === 'web_search') {
    const query = readStringField(toolInput, 'query')
    return query ? `Search the web for ${query}` : 'Use the internet'
  }
  if (tool.name === 'image_generate') {
    return 'Use image generation'
  }
  return tool.label ?? tool.name
}

function trimQuestionTarget(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 120) return normalized
  return `${normalized.slice(0, 117).trimEnd()}...`
}

function approvalQuestionForTool(tool: AgentTool, toolInput: unknown): string | undefined {
  if (isShellExecTool(tool.name)) {
    const command = readShellCommandInput(tool.name, toolInput)
    return command ? `Run ${trimQuestionTarget(command)}?` : 'Run this command?'
  }
  if (tool.name === 'edit' || tool.name === 'write' || tool.name === 'apply_patch') {
    const paths = readFileWritePaths(tool.name, toolInput)
    if (paths.length === 0) return 'Edit files?'
    if (paths.length === 1) return `Edit ${trimQuestionTarget(paths[0])}?`
    return `Edit ${paths.length} files?`
  }
  if (tool.name === 'web_search') {
    const query = readStringField(toolInput, 'query')
    return query ? `Search the web for ${trimQuestionTarget(query)}?` : 'Use the internet?'
  }
  if (tool.name === 'image_generate') {
    return 'Generate an image?'
  }
  return undefined
}

function firstUrl(value: string): string | undefined {
  return value.match(/https?:\/\/[^\s'")]+/)?.[0]
}

function referencesLocalAccountCredentials(command: string): boolean {
  return /(?:^|[/"'=\s(,])(?:~\/|\$HOME\/|\$\{HOME\}\/|\/Users\/[^/\s"']+\/)?\.config\/pichu\/(?:token|user)\.json\b/.test(
    command
  )
}

function approvalSubjectForTool(
  tool: AgentTool,
  toolInput: unknown
): ToolApprovalSubject | undefined {
  if (isShellExecTool(tool.name)) {
    const command = readShellCommandInput(tool.name, toolInput)
    if (!command) return { kind: 'shellCommand' }
    const usesLocalCredentials = referencesLocalAccountCredentials(command)
    if (usesLocalCredentials) {
      return {
        kind: 'localCredentials',
        technicalDetails: command
      }
    }
    const target = firstUrl(command)
    if (target) {
      return {
        kind: 'networkAccess',
        target,
        technicalDetails: command
      }
    }
    return {
      kind: 'shellCommand',
      command: trimQuestionTarget(command),
      technicalDetails: command
    }
  }
  if (tool.name === 'edit' || tool.name === 'write' || tool.name === 'apply_patch') {
    const paths = readFileWritePaths(tool.name, toolInput)
    return { kind: 'fileChange', paths, count: paths.length }
  }
  if (tool.name === 'web_search') {
    const query = readStringField(toolInput, 'query')
    return { kind: 'networkAccess', target: query ? `search:${query}` : undefined }
  }
  if (tool.name === 'image_generate') {
    return { kind: 'imageGeneration' }
  }
  return undefined
}

function autoReviewActionForTool(
  tool: AgentTool,
  toolInput: unknown,
  cwd: string | undefined
): ToolApprovalAutoReviewAction | undefined {
  if (isShellExecTool(tool.name)) {
    const command = readShellCommandInput(tool.name, toolInput)
    return command
      ? { type: 'command', command }
      : { type: 'requestPermissions', reason: 'Run a shell command' }
  }
  if (tool.name === 'edit' || tool.name === 'write' || tool.name === 'apply_patch') {
    const files = readFileWritePaths(tool.name, toolInput)
    const changes = readFileChangePreviews(tool.name, toolInput, cwd)
    return files.length > 0
      ? { type: 'applyPatch', files, ...(changes.length > 0 ? { changes } : {}) }
      : { type: 'requestPermissions', reason: 'Edit files' }
  }
  if (tool.name === 'web_search') {
    const query = readStringField(toolInput, 'query')
    return { type: 'networkAccess', target: query ? `search:${query}` : 'web search' }
  }
  return undefined
}

function approvalRequiredByProfile(profile: AgentTrustProfile): boolean {
  return profile !== 'full'
}

function shouldProfilePrompt(
  tool: AgentTool,
  toolInput: unknown,
  cwd: string | undefined
): boolean {
  const profile = getAgentTrustProfile()
  if (profile === 'full') return false
  if (profile === 'ask') return ASK_PROFILE_TOOL_NAMES.has(tool.name)
  if (isShellExecTool(tool.name)) {
    const command = readShellCommandInput(tool.name, toolInput)
    return command ? bashCommandRequiresAutoApproval(command, cwd ?? process.cwd()) : true
  }
  return AUTO_PROFILE_TOOL_NAMES.has(tool.name)
}

function applyProfileApproval(tool: AgentTool, cwd?: string): AgentTool {
  if (!PROFILE_APPROVAL_TOOL_NAMES.has(tool.name)) return tool
  const toolWithJustification = withApprovalJustificationParameter(tool)
  return withToolApproval(toolWithJustification, {
    mode: () => (getAgentTrustProfile() === 'auto' ? 'auto-review' : 'prompt'),
    question: (toolInput) => approvalQuestionForTool(tool, toolInput),
    shouldPrompt: (toolInput) => shouldProfilePrompt(tool, toolInput, cwd),
    describe: (toolInput) => describeAskApprovalTool(tool, toolInput),
    approvalSubject: (toolInput) => approvalSubjectForTool(tool, toolInput),
    autoReviewAction: (toolInput) => autoReviewActionForTool(tool, toolInput, cwd)
  })
}

function applyProfileRequiredApproval(
  tool: AgentTool,
  reason: string,
  describe: (toolInput: unknown) => string | undefined = () => tool.label ?? tool.name
): AgentTool {
  return withToolApproval(withApprovalJustificationParameter(tool), {
    mode: 'prompt',
    reason,
    question: () => (reason.endsWith('?') ? reason : `${reason}?`),
    shouldPrompt: () => approvalRequiredByProfile(getAgentTrustProfile()),
    describe
  })
}

function applyMcpApproval(tool: AgentTool): AgentTool {
  return withToolApproval(tool, {
    mode: 'prompt',
    reason: 'Run a tool provided by an MCP server',
    question: () => `Run MCP tool ${tool.label ?? tool.name}?`,
    shouldPrompt: () => approvalRequiredByProfile(getAgentTrustProfile()),
    describe: () => `Run MCP tool ${tool.label ?? tool.name}`
  })
}

export async function createToolsForCwd(
  cwd: string,
  cronJobCwd = cwd,
  options: {
    getFallbackModelId: () => string | undefined
    getCurrentSessionId: () => string | null
    getCurrentRunId?: () => string | null
    includeCronJobTool?: boolean
    source?: 'chat' | 'automation'
    interactive?: boolean
    onHumanInputSuspended?: HumanInputRuntimeContext['onHumanInputSuspended']
    onHumanInputRequestCreated?: HumanInputRuntimeContext['onHumanInputRequestCreated']
  }
): Promise<AgentTool[]> {
  const pluginBinPaths = await getEnabledPluginBinPathsAsync()
  const pluginMcpServers = await getEnabledPluginMcpServersAsync()
  const customMcpServers = enabledCustomMcpServers().map((server) => ({
    source: 'custom' as const,
    pluginId: `custom:${server.id}`,
    pluginName: 'custom',
    pluginVersion: '1',
    pluginRoot:
      server.type === 'stdio' && server.cwd ? server.cwd : customMcpRuntimeDataPath(server.id),
    pluginDataRoot: customMcpRuntimeDataPath(server.id),
    serverName: server.name,
    server:
      server.type === 'stdio'
        ? {
            type: 'stdio' as const,
            command: server.command,
            args: server.args,
            env: server.env,
            cwd: server.cwd || undefined
          }
        : {
            type: 'streamable-http' as const,
            url: server.url,
            headers: server.headers
          }
  }))
  const pluginMcpTools = (
    await createEnabledPluginMcpToolsAsync(
      [...pluginMcpServers, ...customMcpServers],
      oauthProviderForCustomMcpServer
    )
  ).map(applyMcpApproval)
  const codingTools = createPichuCodingTools(
    cwd,
    undefined,
    pluginBinPaths,
    options.getCurrentSessionId
  ).map((tool) => applyProfileApproval(tool, cwd))
  const usePlugins = await getUsePluginStatusesAsync()

  const computerUseTools = usePlugins.computerUse.enabled
    ? createComputerUseTools({ getCurrentSessionId: options.getCurrentSessionId })
    : []
  // Keep legacy embeddedBrowser* tools typechecked while Browser Use exposes browser* tools.
  void createEmbeddedBrowserTools
  const source = options.source ?? 'chat'
  const interactive = options.interactive ?? source !== 'automation'
  const sopCreatorEnabled = isFeatureGated('sopCreator')
  const cronJobTool = applyProfileRequiredApproval(
    createCronJobTool(cronJobCwd),
    'Create or modify a recurring automation',
    () => 'Create a recurring automation'
  )
  const sopTools = sopCreatorEnabled
    ? createSopTools(cwd).map((tool) =>
        applyProfileRequiredApproval(tool, 'Save an SOP graph in Owls')
      )
    : []
  const imageGenerationTool = createImageGenerationToolIfConfigured(cwd)

  return [
    createAskUserInputTool({
      source,
      interactive,
      getCurrentSessionId: options.getCurrentSessionId,
      getCurrentRunId: options.getCurrentRunId ?? (() => null),
      onHumanInputSuspended: options.onHumanInputSuspended,
      onHumanInputRequestCreated: options.onHumanInputRequestCreated
    }),
    ...codingTools,
    ...createLeadTeamTools({
      // Team agents should share the active session workspace directory,
      // not the app-level default cwd used for cron jobs.
      projectCwd: cwd,
      getFallbackModelId: options.getFallbackModelId
    }),
    ...(options.includeCronJobTool === false ? [] : [cronJobTool]),
    ...(imageGenerationTool ? [applyProfileApproval(imageGenerationTool, cwd)] : []),
    ...pluginMcpTools,
    ...sopTools,
    ...createWorkbenchTools(cwd),
    ...computerUseTools
  ]
}
