import { ipcMain } from 'electron'
import { requireFeatureGateEnabled } from '../feature-gates/local-feature-gate-service.js'
import { getSavedSopAsync, listSavedSopsAsync } from './store.js'

function requireSopCreatorFeatureGate(): void {
  requireFeatureGateEnabled('sopCreator', 'SOP Creator')
}

export function registerSopIpcHandlers(): void {
  ipcMain.handle('sop:list', () => {
    requireSopCreatorFeatureGate()
    return listSavedSopsAsync()
  })

  ipcMain.handle('sop:get', (_, sopId: unknown) => {
    requireSopCreatorFeatureGate()
    return getSavedSopAsync(sopId)
  })
}
