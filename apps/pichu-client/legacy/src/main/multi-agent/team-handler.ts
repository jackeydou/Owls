import { ipcMain, type WebContents } from 'electron'
import { getSettingsForRenderer } from '../stores/settings-store.js'
import { listAgentDefinitionSummaries } from './agent-loader.js'
import { disposeTeamManager, getTeamManager } from './team-manager.js'

export const TEAM_EVENT_CHANNEL = 'team:event'

let teamWebContentsGetter: (() => WebContents | null) | null = null
let unsubscribeManagerEvents: (() => void) | null = null

export function setTeamWebContentsGetter(getter: () => WebContents | null): void {
  teamWebContentsGetter = getter
}

function sendTeamEvent(payload: unknown): void {
  teamWebContentsGetter?.()?.send(TEAM_EVENT_CHANNEL, payload)
}

export function registerTeamIpc(): void {
  if (!unsubscribeManagerEvents) {
    unsubscribeManagerEvents = getTeamManager().subscribe((event) => {
      sendTeamEvent(event)
    })
  }

  ipcMain.handle('team:status', async () => {
    try {
      return getTeamManager().getStatus()
    } catch {
      return null
    }
  })

  ipcMain.handle('team:list-agents', async () => {
    return listAgentDefinitionSummaries()
  })

  ipcMain.handle('team:create', async (_, teamName: string, cwd?: string) => {
    return getTeamManager().createTeam(teamName, cwd || getSettingsForRenderer().workingDirectory)
  })

  ipcMain.handle('team:destroy', async () => {
    await getTeamManager().destroyTeam()
    return null
  })

  ipcMain.handle(
    'team:spawn',
    async (_, params: { name: string; definitionId: string; prompt: string }) => {
      const teammate = await getTeamManager().spawnTeammate(
        params.name,
        params.definitionId,
        params.prompt
      )
      return {
        name: teammate.name,
        definitionId: teammate.definition.id,
        status: teammate.status
      }
    }
  )

  ipcMain.handle(
    'team:assign-task',
    async (_, params: { teammateName: string; subject: string; description: string }) => {
      return getTeamManager().assignTask(params.teammateName, params.subject, params.description)
    }
  )

  ipcMain.handle(
    'team:send-message',
    async (_, params: { to: string; text: string; from?: string }) => {
      return getTeamManager().sendMessage(params.to, params.text, params.from)
    }
  )
}

export function disposeTeam(): void {
  unsubscribeManagerEvents?.()
  unsubscribeManagerEvents = null
  disposeTeamManager()
}
