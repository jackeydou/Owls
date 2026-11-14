import { ipcMain } from 'electron'
import { deleteArtifact, listArtifacts, saveArtifact } from '../stores/settings-store.js'

export function registerArtifactIpcHandlers(): void {
  ipcMain.handle('artifacts:list', () => listArtifacts())

  ipcMain.handle('artifacts:save', (_, request: Parameters<typeof saveArtifact>[0]) => {
    return saveArtifact(request)
  })

  ipcMain.handle('artifacts:delete', (_, id: string) => {
    return deleteArtifact(id)
  })
}
