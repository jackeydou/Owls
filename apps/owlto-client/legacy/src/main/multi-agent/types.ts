import type {
  Agent,
  AgentTool,
  AgentToolResult,
  ThinkingLevel
} from '@earendil-works/pi-agent-core'

export type AgentDefinitionSource = 'builtin' | 'project' | 'user'

export type AgentDefinition = {
  id: string
  name: string
  description: string
  systemPrompt: string
  model?: string
  readonly?: boolean
  maxTurns?: number
  timeoutMs?: number
  source: AgentDefinitionSource
  filePath?: string
  color?: string
  toolFactory?: (cwd: string, runtime?: { sessionId: string }) => AgentTool[]
}

export type AgentDefinitionSummary = Omit<AgentDefinition, 'toolFactory'>

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

export type TaskFile = {
  id: string
  subject: string
  description: string
  owner: string | null
  status: TaskStatus
  blocks: string[]
  blockedBy: string[]
  createdAt: string
  updatedAt: string
}

export type TaskCreateInput = {
  subject: string
  description: string
  owner?: string | null
  status?: TaskStatus
  blocks?: string[]
  blockedBy?: string[]
}

export type MailboxMessageType =
  | 'task_assignment'
  | 'message'
  | 'broadcast'
  | 'shutdown_request'
  | 'idle_notification'

export type MailboxMessage = {
  id: string
  from: string
  to: string
  type: MailboxMessageType
  text: string
  timestamp: string
  read: boolean
  taskId?: string
}

export type TeamConfigMember = {
  name: string
  agentId: string
  definitionId: string
  role: 'lead' | 'teammate'
}

export type TeamConfig = {
  teamName: string
  cwd: string
  members: TeamConfigMember[]
  createdAt: string
  updatedAt: string
}

export type TeammateState = {
  name: string
  agentId: string
  definition: AgentDefinition
  agent: Agent
  status: 'working' | 'idle' | 'shutdown'
  currentTaskId: string | null
  lastActiveAt: string
  unsubscribe: () => void
}

export type TeamState = {
  teamName: string
  cwd: string
  dataDir: string
  lead: {
    name: string
    agentId: string
  }
  teammates: Map<string, TeammateState>
}

export type TeamEvent =
  | {
      type: 'team-created'
      teamName: string
      cwd: string
      timestamp: string
    }
  | {
      type: 'team-destroyed'
      teamName: string
      timestamp: string
    }
  | {
      type: 'teammate-spawned'
      teamName: string
      teammateName: string
      definitionId: string
      timestamp: string
    }
  | {
      type: 'teammate-working' | 'teammate-idle' | 'teammate-shutdown'
      teamName: string
      teammateName: string
      timestamp: string
      taskId?: string | null
      detail?: string
    }
  | {
      type: 'task-created' | 'task-claimed' | 'task-updated' | 'task-completed'
      teamName: string
      task: TaskFile
      timestamp: string
    }
  | {
      type: 'message-sent'
      teamName: string
      message: MailboxMessage
      timestamp: string
    }
  | {
      type: 'delegate-update'
      teamName: string
      agentId: string
      toolCallId: string
      status: 'running' | 'complete' | 'error'
      detail: string
      result?: AgentToolResult<unknown>
      timestamp: string
    }
  | {
      type: 'error'
      teamName: string | null
      detail: string
      timestamp: string
    }

export type TeamStatusSummary = {
  teamName: string
  cwd: string
  lead: {
    name: string
    agentId: string
  }
  teammates: Array<{
    name: string
    agentId: string
    definitionId: string
    description: string
    status: 'working' | 'idle' | 'shutdown'
    currentTaskId: string | null
    lastActiveAt: string
  }>
  tasks: TaskFile[]
}

export type AgentRuntimeFactoryParams = {
  definition: AgentDefinition
  cwd: string
  sessionId: string
  fallbackModelId?: string
  additionalTools?: AgentTool[]
  thinkingLevel?: ThinkingLevel
}
