export const TOOL_APPROVAL_MODES = ['none', 'prompt', 'auto-review', 'deny'] as const

export type ToolApprovalMode = (typeof TOOL_APPROVAL_MODES)[number]

export const AGENT_TRUST_PROFILES = ['ask', 'auto', 'full'] as const

export type AgentTrustProfile = (typeof AGENT_TRUST_PROFILES)[number]

export function isAgentTrustProfile(value: unknown): value is AgentTrustProfile {
  return AGENT_TRUST_PROFILES.some((profile) => profile === value)
}

export function normalizeAgentTrustProfile(
  value: unknown,
  fallback: AgentTrustProfile = 'auto'
): AgentTrustProfile {
  return isAgentTrustProfile(value) ? value : fallback
}

export type ToolApprovalUiSpec = {
  renderer: 'json-render'
  spec: unknown
  state?: Record<string, unknown>
}

export type ToolApprovalParsedCommand = {
  parseStatus: 'parsed' | 'partial' | 'raw'
  command: string
  canonicalArgv?: string[]
  shellScript?: string
  argv: string[]
  executable?: string
  arguments: string[]
  sideEffects?: Array<{
    kind: 'writeFile' | 'createDirectory'
    path?: string
    paths?: string[]
    contentPreview?: string
    byteLength?: number
    truncated?: boolean
  }>
  error?: string
}

export type ToolApprovalAutoReviewFileChange = {
  path: string
  kind: 'write' | 'edit' | 'create' | 'update' | 'delete' | 'move' | 'unknown'
  moveTo?: string
  resolvedPath?: string
  pathScope?: 'insideCwd' | 'outsideCwd' | 'unknown'
  oldTextPreview?: string
  newTextPreview?: string
  contentPreview?: string
  patchPreview?: string
  diffPreview?: string
  diffUnavailableReason?: string
  byteLength?: number
  truncated?: boolean
}

export type ToolApprovalAutoReviewAction =
  | {
      type: 'command'
      command: string
    }
  | {
      type: 'execve'
      program: string
      argv: string[]
    }
  | {
      type: 'applyPatch'
      files: string[]
      changes?: ToolApprovalAutoReviewFileChange[]
    }
  | {
      type: 'networkAccess'
      target: string
    }
  | {
      type: 'mcpToolCall'
      server?: string
      toolName: string
    }
  | {
      type: 'requestPermissions'
      reason: string
    }

export type ToolApprovalAutoReviewRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type ToolApprovalAutoReviewUserAuthorization = 'none' | 'low' | 'medium' | 'high'

export type ToolApprovalAutoReviewStatus =
  | 'inProgress'
  | 'approved'
  | 'denied'
  | 'timedOut'
  | 'aborted'

export type ToolApprovalAutoReviewEvent = {
  id: string
  requestId: string
  sessionId: string
  toolName: string
  toolUseId: string
  action?: ToolApprovalAutoReviewAction
  status: ToolApprovalAutoReviewStatus
  riskLevel?: ToolApprovalAutoReviewRiskLevel
  userAuthorization?: ToolApprovalAutoReviewUserAuthorization
  summary: string
  rationale?: string
  reviewedActionTruncated?: boolean
  createdAt: string
  completedAt?: string
}

export type ToolApprovalRememberRuleProposal = {
  type: 'commandPrefix'
  commandPrefix: string[]
  display: string
}

export type ToolApprovalSubject =
  | {
      kind: 'shellCommand'
      command?: string
      technicalDetails?: string
    }
  | {
      kind: 'networkAccess'
      target?: string
      technicalDetails?: string
    }
  | {
      kind: 'privateAccountData'
      service?: string
      usesLocalCredentials?: boolean
      technicalDetails?: string
    }
  | {
      kind: 'localCredentials'
      technicalDetails?: string
    }
  | {
      kind: 'fileChange'
      paths: string[]
      count: number
    }
  | {
      kind: 'imageGeneration'
    }

export type ToolApprovalRequestForRenderer = {
  id: string
  sessionId: string
  cwd: string
  toolName: string
  toolUseId: string
  toolInput: unknown
  approvalMode: Exclude<ToolApprovalMode, 'none'>
  approvalReason?: string
  description: string
  approvalUi?: ToolApprovalUiSpec
  approvalSubject?: ToolApprovalSubject
  parsedCommand?: ToolApprovalParsedCommand
  autoReviewAction?: ToolApprovalAutoReviewAction
  rememberRule?: ToolApprovalRememberRuleProposal
  source: 'chat' | 'automation'
  createdAt: string
}

export type ToolApprovalResolveBehavior = 'allow' | 'deny'

export type ToolApprovalResolveRequest = {
  id: string
  behavior: ToolApprovalResolveBehavior
  reason?: string
  rememberRule?: boolean
}

export type ToolApprovalResolvedEvent = {
  id: string
  behavior: ToolApprovalResolveBehavior | 'timeout' | 'cancelled' | 'unavailable'
  reason?: string
}

export function isToolApprovalMode(value: unknown): value is ToolApprovalMode {
  return TOOL_APPROVAL_MODES.some((mode) => mode === value)
}
