import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { getSettingsForRenderer } from '../stores/settings-store.js'
import { getTeamManager } from './team-manager.js'

const teamCreateSchema = Type.Object({
  teamName: Type.String({
    description: 'Short team name used for the shared task board and mailbox.'
  })
})

const teamSpawnSchema = Type.Object({
  name: Type.String({ description: 'Teammate name used for addressing and status.' }),
  definitionId: Type.String({ description: 'Agent definition id to spawn.' }),
  prompt: Type.String({ description: 'Initial spawn instructions for the teammate.' })
})

const teamAssignTaskSchema = Type.Object({
  teammateName: Type.String({ description: 'Name of the teammate that should own the task.' }),
  subject: Type.String({ description: 'Short task title.' }),
  description: Type.String({ description: 'Detailed task instructions and boundaries.' })
})

const teamSendMessageSchema = Type.Object({
  to: Type.String({ description: 'Recipient teammate name.' }),
  text: Type.String({ description: 'Message body to send.' })
})

const teamBroadcastSchema = Type.Object({
  text: Type.String({ description: 'Message body to broadcast to all teammates.' })
})

const teamStatusSchema = Type.Object({})

const teamShutdownSchema = Type.Object({
  teammateName: Type.Optional(
    Type.String({
      description: 'Optional teammate name. Omit to destroy the entire active team.'
    })
  )
})

const delegateToAgentSchema = Type.Object({
  definitionId: Type.String({ description: 'Agent definition id to delegate the task to.' }),
  task: Type.String({ description: 'Self-contained task description for the delegated agent.' }),
  context: Type.Optional(
    Type.String({ description: 'Additional context for the delegated agent.' })
  )
})

function fallbackProjectCwd(projectCwd?: string): string {
  return projectCwd || getSettingsForRenderer().workingDirectory
}

export function createLeadTeamTools(options: {
  projectCwd?: string
  getFallbackModelId?: () => string | undefined
}): AgentTool[] {
  return [
    {
      name: 'teamCreate',
      label: 'Create Team',
      description:
        'Create a persistent multi-agent team that shares the same project filesystem and can coordinate through tasks and messages.',
      parameters: teamCreateSchema,
      execute: async (_toolCallId, params) => {
        const input = params as { teamName: string }
        const status = getTeamManager().createTeam(
          input.teamName,
          fallbackProjectCwd(options.projectCwd)
        )
        return {
          content: [{ type: 'text', text: `Created team "${status.teamName}".` }],
          details: status
        }
      }
    },
    {
      name: 'teamSpawn',
      label: 'Spawn Teammate',
      description:
        'Spawn a persistent teammate from an agent definition. The teammate keeps its own context window and shares the same project files.',
      parameters: teamSpawnSchema,
      execute: async (_toolCallId, params) => {
        const input = params as { name: string; definitionId: string; prompt: string }
        const teammate = await getTeamManager().spawnTeammate(
          input.name,
          input.definitionId,
          input.prompt,
          options.getFallbackModelId?.()
        )
        return {
          content: [{ type: 'text', text: `Spawned teammate "${teammate.name}".` }],
          details: {
            teammateName: teammate.name,
            definitionId: teammate.definition.id,
            status: teammate.status
          }
        }
      }
    },
    {
      name: 'teamAssignTask',
      label: 'Assign Team Task',
      description: 'Create a task on the shared task board and assign it to a teammate.',
      parameters: teamAssignTaskSchema,
      execute: async (_toolCallId, params) => {
        const input = params as { teammateName: string; subject: string; description: string }
        const task = await getTeamManager().assignTask(
          input.teammateName,
          input.subject,
          input.description
        )
        return {
          content: [{ type: 'text', text: `Assigned task ${task.id} to ${input.teammateName}.` }],
          details: { task }
        }
      }
    },
    {
      name: 'teamSendMessage',
      label: 'Send Team Message',
      description: 'Send a direct message to a teammate and wake it if it is idle.',
      parameters: teamSendMessageSchema,
      execute: async (_toolCallId, params) => {
        const input = params as { to: string; text: string }
        const message = await getTeamManager().sendMessage(input.to, input.text)
        return {
          content: [{ type: 'text', text: `Sent a message to ${input.to}.` }],
          details: { message }
        }
      }
    },
    {
      name: 'teamBroadcast',
      label: 'Broadcast To Team',
      description: 'Broadcast a message to all active teammates.',
      parameters: teamBroadcastSchema,
      execute: async (_toolCallId, params) => {
        const input = params as { text: string }
        const messages = await getTeamManager().broadcast(input.text)
        return {
          content: [{ type: 'text', text: `Broadcast to ${messages.length} teammate(s).` }],
          details: { messages }
        }
      }
    },
    {
      name: 'teamStatus',
      label: 'Team Status',
      description: 'Inspect active teammates, tasks, and current collaboration state.',
      parameters: teamStatusSchema,
      execute: async () => {
        const status = getTeamManager().getStatus()
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
          details: status
        }
      }
    },
    {
      name: 'teamShutdown',
      label: 'Shutdown Team',
      description: 'Shutdown one teammate or destroy the entire active team.',
      parameters: teamShutdownSchema,
      execute: async (_toolCallId, params) => {
        const input = params as { teammateName?: string }
        if (input.teammateName?.trim()) {
          await getTeamManager().shutdownTeammate(input.teammateName.trim())
          return {
            content: [{ type: 'text', text: `Shut down teammate "${input.teammateName}".` }],
            details: { teammateName: input.teammateName.trim() }
          }
        }

        await getTeamManager().destroyTeam()
        return {
          content: [{ type: 'text', text: 'Destroyed the active team.' }],
          details: { destroyed: true }
        }
      }
    },
    {
      name: 'delegateToAgent',
      label: 'Delegate To Agent',
      description:
        'Run a one-shot delegated task in a fresh agent context with its own system prompt and toolset. Use this for focused subtasks that do not need a persistent teammate.',
      parameters: delegateToAgentSchema,
      execute: async (toolCallId, params, signal, onUpdate) => {
        const input = params as { definitionId: string; task: string; context?: string }
        return getTeamManager().runDelegatedAgentTask({
          definitionId: input.definitionId,
          task: input.task,
          context: input.context,
          cwd: fallbackProjectCwd(options.projectCwd),
          fallbackModelId: options.getFallbackModelId?.(),
          toolCallId,
          signal,
          onUpdate
        })
      }
    }
  ]
}
