import type { AgentTool } from '@earendil-works/pi-agent-core'
import type {
  ToolApprovalAutoReviewAction,
  ToolApprovalMode,
  ToolApprovalSubject,
  ToolApprovalUiSpec
} from '../shared/tool-approval.js'

export type ToolApprovalMetadata = {
  mode: ToolApprovalMode | (() => ToolApprovalMode)
  reason?: string | ((toolInput: unknown) => string | undefined)
  question?: string | ((toolInput: unknown) => string | undefined)
  shouldPrompt?: (toolInput: unknown) => boolean
  describe?: (toolInput: unknown) => string | undefined
  autoReviewAction?: (toolInput: unknown) => ToolApprovalAutoReviewAction | undefined
  approvalSubject?: (toolInput: unknown) => ToolApprovalSubject | undefined
  approvalUi?: ToolApprovalUiSpec
}

export type AgentToolWithApproval = AgentTool & {
  approval?: ToolApprovalMetadata
  hookToolName?: string
  hookMatcherAliases?: string[]
}

export type ToolHookIdentity = {
  toolName: string
  matcherValues: string[]
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function withToolApproval<T extends AgentTool>(
  tool: T,
  approval: ToolApprovalMetadata,
  hookIdentity?: {
    toolName?: string
    matcherAliases?: string[]
  }
): T & AgentToolWithApproval {
  return {
    ...tool,
    approval,
    hookToolName: hookIdentity?.toolName,
    hookMatcherAliases: hookIdentity?.matcherAliases
  }
}

export function withToolHookIdentity<T extends AgentTool>(
  tool: T,
  hookIdentity: {
    toolName?: string
    matcherAliases?: string[]
  }
): T & AgentToolWithApproval {
  return {
    ...tool,
    hookToolName: hookIdentity.toolName,
    hookMatcherAliases: hookIdentity.matcherAliases
  }
}

function defaultMatcherAliases(toolName: string): string[] {
  if (toolName === 'apply_patch') return ['Edit', 'Write']
  if (toolName.startsWith('mcp__')) return [toolName]
  return []
}

export function findToolHookIdentity(
  tools: AgentTool[] | undefined,
  toolName: string
): ToolHookIdentity {
  const tool = tools?.find((candidate) => candidate.name === toolName) as
    | AgentToolWithApproval
    | undefined
  const hookToolName = tool?.hookToolName?.trim() || toolName
  return {
    toolName: hookToolName,
    matcherValues: dedupe([
      hookToolName,
      toolName,
      ...(tool?.hookMatcherAliases ?? []),
      ...defaultMatcherAliases(hookToolName),
      ...defaultMatcherAliases(toolName)
    ])
  }
}

export function findToolApprovalMetadata(
  tools: AgentTool[] | undefined,
  toolName: string
): ToolApprovalMetadata | undefined {
  if (!tools) return undefined
  return (tools.find((tool) => tool.name === toolName) as AgentToolWithApproval | undefined)
    ?.approval
}
