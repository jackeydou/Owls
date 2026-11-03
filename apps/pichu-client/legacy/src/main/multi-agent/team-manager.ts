import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult
} from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import {
  buildPichuModel,
  convertAgentMessagesToLlm,
  createPichuStreamFn,
  resolvePichuModelConfig
} from '../agent/pi-models.js'
import { getDataRoot } from '../pichu-paths.js'
import { getSettingsForRenderer } from '../stores/settings-store.js'
import { createPichuCodingTools, createPichuReadOnlyTools } from '../tools/coding.js'
import {
  getAgentDefinitionById,
  listAgentDefinitionSummaries,
  loadAgentDefinitions
} from './agent-loader.js'
import { broadcastMessage, ensureMailbox, pollInbox, sendMessage } from './mailbox.js'
import { claimTask, createTask, ensureTaskQueue, listTasks, updateTask } from './task-queue.js'
import type {
  AgentDefinition,
  AgentDefinitionSummary,
  AgentRuntimeFactoryParams,
  MailboxMessage,
  TaskFile,
  TeamConfig,
  TeamEvent,
  TeammateState,
  TeamState,
  TeamStatusSummary
} from './types.js'

const TEAM_LEAD_NAME = 'team-lead'

const claimTaskSchema = Type.Object({})
const updateTaskSchema = Type.Object({
  taskId: Type.String(),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('in_progress'),
    Type.Literal('completed'),
    Type.Literal('deleted')
  ]),
  note: Type.Optional(Type.String())
})
const sendTeamMessageSchema = Type.Object({
  to: Type.String(),
  text: Type.String()
})
const checkInboxSchema = Type.Object({})
const teamSnapshotSchema = Type.Object({})

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function now(): string {
  return new Date().toISOString()
}

function summarizeAssistantText(messages: AgentMessage[]): string {
  const lastAssistant = [...messages]
    .reverse()
    .find(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        'role' in message &&
        message.role === 'assistant'
    )

  if (!lastAssistant || !('content' in lastAssistant)) {
    return ''
  }

  const content = lastAssistant.content
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .flatMap((block) => {
      if (typeof block !== 'object' || block === null || !('type' in block)) {
        return []
      }
      if (block.type === 'text' && typeof block.text === 'string') {
        return [block.text]
      }
      return []
    })
    .join('')
    .trim()
}

function teamDirFor(teamName: string, dataRoot = getDataRoot()): string {
  return join(dataRoot, 'teams', slugify(teamName))
}

function configPath(teamDir: string): string {
  return join(teamDir, 'config.json')
}

function normalizeModelId(
  modelId: string | undefined,
  fallbackModelId: string | undefined
): string {
  if (!modelId || modelId === 'inherit' || modelId === 'fast') {
    return fallbackModelId || getSettingsForRenderer().model || resolvePichuModelConfig().id
  }
  return modelId
}

function createManagedAgentRuntime(params: AgentRuntimeFactoryParams): Agent {
  const modelConfig = resolvePichuModelConfig(
    normalizeModelId(params.definition.model, params.fallbackModelId)
  )
  const baseTools =
    params.definition.toolFactory?.(params.cwd, { sessionId: params.sessionId }) ??
    (params.definition.readonly
      ? createPichuReadOnlyTools(params.cwd)
      : createPichuCodingTools(params.cwd, undefined, [], () => params.sessionId))

  return new Agent({
    sessionId: params.sessionId,
    streamFn: createPichuStreamFn(),
    convertToLlm: convertAgentMessagesToLlm,
    initialState: {
      model: buildPichuModel(modelConfig),
      systemPrompt: params.definition.systemPrompt,
      thinkingLevel: params.thinkingLevel ?? 'off',
      tools: [...baseTools, ...(params.additionalTools ?? [])],
      messages: []
    }
  })
}

function readTeamConfig(teamDir: string): TeamConfig | null {
  if (!existsSync(configPath(teamDir))) {
    return null
  }
  return JSON.parse(readFileSync(configPath(teamDir), 'utf8')) as TeamConfig
}

function writeTeamConfig(teamDir: string, config: TeamConfig): void {
  mkdirSync(teamDir, { recursive: true })
  writeFileSync(configPath(teamDir), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

function formatInboxPrompt(messages: MailboxMessage[]): string {
  return [
    'You have new team messages. Process them and continue collaborating in the shared project workspace.',
    '',
    ...messages.map((message) => {
      const header = `From ${message.from} [${message.type}] at ${message.timestamp}`
      const taskLine = message.taskId ? `Task ID: ${message.taskId}` : null
      return [header, taskLine, message.text].filter(Boolean).join('\n')
    })
  ].join('\n\n')
}

function formatEventDetail(event: AgentEvent): string | null {
  switch (event.type) {
    case 'agent_start':
      return 'started'
    case 'turn_start':
      return 'thinking'
    case 'tool_execution_start':
      return `running ${event.toolName}`
    case 'tool_execution_end':
      return event.isError ? `${event.toolName} failed` : `${event.toolName} finished`
    case 'agent_end':
      return 'completed'
    default:
      return null
  }
}

export class TeamManager {
  private team: TeamState | null = null
  private listeners = new Set<(event: TeamEvent) => void>()
  private deps: {
    createAgentRuntime?: (params: AgentRuntimeFactoryParams) => Agent
  }

  constructor(deps: { createAgentRuntime?: (params: AgentRuntimeFactoryParams) => Agent } = {}) {
    this.deps = deps
  }

  subscribe(listener: (event: TeamEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: TeamEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private requireTeam(): TeamState {
    if (!this.team) {
      throw new Error('No active team')
    }
    return this.team
  }

  private saveConfig(): void {
    if (!this.team) return
    const config: TeamConfig = {
      teamName: this.team.teamName,
      cwd: this.team.cwd,
      createdAt: readTeamConfig(this.team.dataDir)?.createdAt ?? now(),
      updatedAt: now(),
      members: [
        {
          name: this.team.lead.name,
          agentId: this.team.lead.agentId,
          definitionId: 'lead',
          role: 'lead'
        },
        ...[...this.team.teammates.values()].map((teammate) => ({
          name: teammate.name,
          agentId: teammate.agentId,
          definitionId: teammate.definition.id,
          role: 'teammate' as const
        }))
      ]
    }
    writeTeamConfig(this.team.dataDir, config)
  }

  listAgentDefinitions(): AgentDefinitionSummary[] {
    return listAgentDefinitionSummaries()
  }

  createTeam(teamName: string, cwd: string): TeamStatusSummary {
    if (this.team) {
      throw new Error(`Team "${this.team.teamName}" is already active`)
    }

    const normalizedName = slugify(teamName)
    if (!normalizedName) {
      throw new Error('Team name is required')
    }

    const dataDir = teamDirFor(normalizedName)
    mkdirSync(dataDir, { recursive: true })
    ensureTaskQueue(dataDir)
    ensureMailbox(dataDir, [TEAM_LEAD_NAME])

    this.team = {
      teamName: normalizedName,
      cwd,
      dataDir,
      lead: {
        name: TEAM_LEAD_NAME,
        agentId: crypto.randomUUID()
      },
      teammates: new Map()
    }
    this.saveConfig()
    this.emit({
      type: 'team-created',
      teamName: normalizedName,
      cwd,
      timestamp: now()
    })
    return this.getStatus()
  }

  getStatus(): TeamStatusSummary {
    const team = this.requireTeam()
    return {
      teamName: team.teamName,
      cwd: team.cwd,
      lead: team.lead,
      teammates: [...team.teammates.values()].map((teammate) => ({
        name: teammate.name,
        agentId: teammate.agentId,
        definitionId: teammate.definition.id,
        description: teammate.definition.description,
        status: teammate.status,
        currentTaskId: teammate.currentTaskId,
        lastActiveAt: teammate.lastActiveAt
      })),
      tasks: listTasks(team.dataDir)
    }
  }

  private createTeammateCoordinationTools(teammateName: string): AgentTool[] {
    return [
      {
        name: 'claimTeamTask',
        label: 'Claim Team Task',
        description:
          'Claim the next pending task assigned to you or unowned in the team task queue.',
        parameters: claimTaskSchema,
        execute: async () => {
          const team = this.requireTeam()
          const task = await claimTask(team.dataDir, teammateName)
          if (!task) {
            return {
              content: [{ type: 'text', text: 'No pending team task is ready to claim.' }],
              details: { task: null }
            }
          }
          this.emit({ type: 'task-claimed', teamName: team.teamName, task, timestamp: now() })
          this.updateTeammateState(teammateName, { currentTaskId: task.id })
          return {
            content: [{ type: 'text', text: `Claimed task ${task.id}: ${task.subject}` }],
            details: { task }
          }
        }
      },
      {
        name: 'updateTeamTask',
        label: 'Update Team Task',
        description: 'Update the status of a team task you own.',
        parameters: updateTaskSchema,
        execute: async (_toolCallId, params) => {
          const input = params as { taskId: string; status: TaskFile['status']; note?: string }
          const team = this.requireTeam()
          const task = await updateTask(team.dataDir, input.taskId, { status: input.status })
          this.emit({
            type: input.status === 'completed' ? 'task-completed' : 'task-updated',
            teamName: team.teamName,
            task,
            timestamp: now()
          })
          if (input.status === 'completed') {
            this.updateTeammateState(teammateName, { currentTaskId: null })
          }
          return {
            content: [{ type: 'text', text: `Updated task ${task.id} to ${task.status}.` }],
            details: { task, note: input.note ?? null }
          }
        }
      },
      {
        name: 'sendTeamMessage',
        label: 'Send Team Message',
        description: 'Send a direct message to another teammate or the lead.',
        parameters: sendTeamMessageSchema,
        execute: async (_toolCallId, params) => {
          const input = params as { to: string; text: string }
          const message = await this.sendMessage(input.to, input.text, teammateName)
          return {
            content: [{ type: 'text', text: `Sent message to ${input.to}.` }],
            details: { message }
          }
        }
      },
      {
        name: 'checkInbox',
        label: 'Check Inbox',
        description: 'Read unread team messages sent to you.',
        parameters: checkInboxSchema,
        execute: async () => {
          const team = this.requireTeam()
          const messages = await pollInbox(team.dataDir, teammateName)
          return {
            content: [
              {
                type: 'text',
                text: messages.length === 0 ? 'No new team messages.' : formatInboxPrompt(messages)
              }
            ],
            details: { messages }
          }
        }
      },
      {
        name: 'teamSnapshot',
        label: 'Team Snapshot',
        description: 'Inspect teammates and tasks in the active team.',
        parameters: teamSnapshotSchema,
        execute: async () => ({
          content: [{ type: 'text', text: JSON.stringify(this.getStatus(), null, 2) }],
          details: this.getStatus()
        })
      }
    ]
  }

  private updateTeammateState(
    teammateName: string,
    patch: Partial<Pick<TeammateState, 'status' | 'currentTaskId' | 'lastActiveAt'>>
  ): void {
    const team = this.requireTeam()
    const teammate = team.teammates.get(teammateName)
    if (!teammate) return
    Object.assign(teammate, patch)
  }

  async spawnTeammate(
    name: string,
    definitionId: string,
    spawnPrompt: string,
    fallbackModelId?: string
  ): Promise<TeammateState> {
    const team = this.requireTeam()
    if (team.teammates.has(name)) {
      throw new Error(`Teammate "${name}" already exists`)
    }
    const definition = getAgentDefinitionById(definitionId)
    if (!definition) {
      throw new Error(`Unknown agent definition: ${definitionId}`)
    }

    ensureMailbox(team.dataDir, [TEAM_LEAD_NAME, name])

    const agent =
      this.deps.createAgentRuntime?.({
        definition,
        cwd: team.cwd,
        sessionId: `${team.teamName}-${name}-${crypto.randomUUID()}`,
        fallbackModelId,
        additionalTools: this.createTeammateCoordinationTools(name)
      }) ??
      createManagedAgentRuntime({
        definition,
        cwd: team.cwd,
        sessionId: `${team.teamName}-${name}-${crypto.randomUUID()}`,
        fallbackModelId,
        additionalTools: this.createTeammateCoordinationTools(name)
      })

    let turnCount = 0
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'turn_end') {
        turnCount += 1
        if (definition.maxTurns && turnCount >= definition.maxTurns) {
          agent.abort()
        }
      }

      const detail = formatEventDetail(event)
      if (event.type === 'agent_start') {
        this.updateTeammateState(name, { status: 'working', lastActiveAt: now() })
        this.emit({
          type: 'teammate-working',
          teamName: team.teamName,
          teammateName: name,
          timestamp: now(),
          detail: 'started'
        })
      } else if (event.type === 'agent_end') {
        this.updateTeammateState(name, { status: 'idle', lastActiveAt: now() })
        void sendMessage(team.dataDir, {
          from: name,
          to: TEAM_LEAD_NAME,
          type: 'idle_notification',
          text: 'Teammate is idle.'
        }).then((message) => {
          this.emit({ type: 'message-sent', teamName: team.teamName, message, timestamp: now() })
        })
        this.emit({
          type: 'teammate-idle',
          teamName: team.teamName,
          teammateName: name,
          timestamp: now(),
          detail: 'idle'
        })
      } else if (detail) {
        this.emit({
          type: 'teammate-working',
          teamName: team.teamName,
          teammateName: name,
          timestamp: now(),
          taskId: team.teammates.get(name)?.currentTaskId,
          detail
        })
      }
    })

    const teammate: TeammateState = {
      name,
      agentId: crypto.randomUUID(),
      definition,
      agent,
      status: 'idle',
      currentTaskId: null,
      lastActiveAt: now(),
      unsubscribe
    }
    team.teammates.set(name, teammate)
    this.saveConfig()
    this.emit({
      type: 'teammate-spawned',
      teamName: team.teamName,
      teammateName: name,
      definitionId,
      timestamp: now()
    })

    if (spawnPrompt.trim()) {
      await agent.prompt(spawnPrompt.trim())
    }

    return teammate
  }

  async assignTask(teammateName: string, subject: string, description: string): Promise<TaskFile> {
    const team = this.requireTeam()
    if (!team.teammates.has(teammateName)) {
      throw new Error(`Unknown teammate: ${teammateName}`)
    }
    const task = await createTask(team.dataDir, {
      subject,
      description,
      owner: teammateName
    })
    this.emit({ type: 'task-created', teamName: team.teamName, task, timestamp: now() })
    await this.sendMessage(
      teammateName,
      `A new task has been assigned to you.\n\nTask ${task.id}: ${task.subject}\n${task.description}`,
      TEAM_LEAD_NAME,
      'task_assignment',
      task.id
    )
    return task
  }

  async sendMessage(
    to: string,
    text: string,
    from = TEAM_LEAD_NAME,
    type: MailboxMessage['type'] = 'message',
    taskId?: string
  ): Promise<MailboxMessage> {
    const team = this.requireTeam()
    const message = await sendMessage(team.dataDir, { from, to, text, type, taskId })
    this.emit({ type: 'message-sent', teamName: team.teamName, message, timestamp: now() })
    const teammate = team.teammates.get(to)
    if (teammate && teammate.status !== 'shutdown') {
      void this.processInbox(to)
    }
    return message
  }

  async broadcast(text: string, from = TEAM_LEAD_NAME): Promise<MailboxMessage[]> {
    const team = this.requireTeam()
    const targets = [TEAM_LEAD_NAME, ...team.teammates.keys()]
    const messages = await broadcastMessage(team.dataDir, {
      from,
      to: targets,
      text,
      excludeSelf: true
    })
    for (const message of messages) {
      this.emit({ type: 'message-sent', teamName: team.teamName, message, timestamp: now() })
    }
    for (const teammateName of team.teammates.keys()) {
      void this.processInbox(teammateName)
    }
    return messages
  }

  async processInbox(teammateName: string): Promise<void> {
    const team = this.requireTeam()
    const teammate = team.teammates.get(teammateName)
    if (!teammate || teammate.status === 'working' || teammate.status === 'shutdown') {
      return
    }

    const messages = await pollInbox(team.dataDir, teammateName)
    if (messages.length === 0) {
      return
    }

    teammate.status = 'working'
    teammate.lastActiveAt = now()
    this.emit({
      type: 'teammate-working',
      teamName: team.teamName,
      teammateName,
      timestamp: now(),
      detail: 'processing inbox'
    })

    try {
      await teammate.agent.prompt(formatInboxPrompt(messages))
    } catch (error) {
      this.emit({
        type: 'error',
        teamName: team.teamName,
        detail: error instanceof Error ? error.message : String(error),
        timestamp: now()
      })
    }
  }

  async shutdownTeammate(name: string): Promise<void> {
    const team = this.requireTeam()
    const teammate = team.teammates.get(name)
    if (!teammate) {
      return
    }

    await sendMessage(team.dataDir, {
      from: TEAM_LEAD_NAME,
      to: name,
      type: 'shutdown_request',
      text: 'Please stop work and shutdown.'
    })
    teammate.unsubscribe()
    teammate.agent.abort()
    teammate.agent.reset()
    teammate.status = 'shutdown'
    teammate.lastActiveAt = now()
    this.emit({
      type: 'teammate-shutdown',
      teamName: team.teamName,
      teammateName: name,
      timestamp: now(),
      detail: 'shutdown'
    })
    this.saveConfig()
  }

  abortAll(): void {
    if (!this.team) {
      return
    }
    for (const teammate of this.team.teammates.values()) {
      teammate.agent.abort()
    }
  }

  async destroyTeam(): Promise<void> {
    if (!this.team) {
      return
    }
    const teamName = this.team.teamName
    for (const teammateName of [...this.team.teammates.keys()]) {
      await this.shutdownTeammate(teammateName)
    }
    rmSync(this.team.dataDir, { recursive: true, force: true })
    this.team = null
    this.emit({
      type: 'team-destroyed',
      teamName,
      timestamp: now()
    })
  }

  async runDelegatedAgentTask(params: {
    definitionId: string
    task: string
    context?: string
    cwd: string
    fallbackModelId?: string
    toolCallId: string
    signal?: AbortSignal
    onUpdate?: (partialResult: AgentToolResult<unknown>) => void
  }): Promise<AgentToolResult<unknown>> {
    const definition = getAgentDefinitionById(params.definitionId)
    if (!definition) {
      throw new Error(`Unknown agent definition: ${params.definitionId}`)
    }

    const agent =
      this.deps.createAgentRuntime?.({
        definition,
        cwd: params.cwd,
        sessionId: `delegate-${params.definitionId}-${crypto.randomUUID()}`,
        fallbackModelId: params.fallbackModelId
      }) ??
      createManagedAgentRuntime({
        definition,
        cwd: params.cwd,
        sessionId: `delegate-${params.definitionId}-${crypto.randomUUID()}`,
        fallbackModelId: params.fallbackModelId
      })

    let timedOut = false
    let turnCount = 0
    const timeoutMs = definition.timeoutMs ?? 300_000
    const timer = setTimeout(() => {
      timedOut = true
      agent.abort()
    }, timeoutMs)

    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'turn_end') {
        turnCount += 1
        if (definition.maxTurns && turnCount >= definition.maxTurns) {
          agent.abort()
        }
      }

      const detail = formatEventDetail(event)
      if (!detail) {
        return
      }

      const partialResult: AgentToolResult<unknown> = {
        content: [{ type: 'text', text: detail }],
        details: {
          agentId: definition.id,
          definitionId: definition.id,
          eventType: event.type,
          detail
        }
      }
      params.onUpdate?.(partialResult)
      this.emit({
        type: 'delegate-update',
        teamName: this.team?.teamName ?? 'detached',
        agentId: definition.id,
        toolCallId: params.toolCallId,
        status:
          event.type === 'agent_end'
            ? 'complete'
            : event.type === 'tool_execution_end' && event.isError
              ? 'error'
              : 'running',
        detail,
        result: partialResult,
        timestamp: now()
      })
    })

    params.signal?.addEventListener('abort', () => agent.abort(), { once: true })

    try {
      const input = params.context?.trim()
        ? `${params.task.trim()}\n\nContext:\n${params.context.trim()}`
        : params.task.trim()
      await agent.prompt(input)
      if (timedOut) {
        throw new Error(`Delegated agent timed out after ${timeoutMs}ms`)
      }
      const output = summarizeAssistantText(agent.state.messages) || 'Task completed.'
      return {
        content: [{ type: 'text', text: output }],
        details: {
          agentId: definition.id,
          definitionId: definition.id,
          output
        }
      }
    } finally {
      clearTimeout(timer)
      unsubscribe()
      agent.abort()
      agent.reset()
    }
  }
}

const teamManager = new TeamManager()

export function getTeamManager(): TeamManager {
  return teamManager
}

export function disposeTeamManager(): void {
  teamManager.abortAll()
}

export function loadPersistedTeamSummaries(): AgentDefinitionSummary[] {
  return listAgentDefinitionSummaries()
}

export function hasActiveTeam(): boolean {
  try {
    getTeamManager().getStatus()
    return true
  } catch {
    return false
  }
}

export function loadAvailableDefinitions(): AgentDefinition[] {
  return loadAgentDefinitions()
}
