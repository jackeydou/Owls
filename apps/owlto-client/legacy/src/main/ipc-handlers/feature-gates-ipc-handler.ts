import { ipcMain } from 'electron'
import { isLocalFeatureGateKey, type LocalFeatureGateKey } from '../../shared/feature-gates.js'
import {
  listFeatureGates,
  setFeatureGateEnabled
} from '../feature-gates/local-feature-gate-service.js'

function requireFeatureGateKey(value: unknown): LocalFeatureGateKey {
  if (typeof value !== 'string' || !value.trim() || !isLocalFeatureGateKey(value.trim())) {
    throw new Error('featureKey is invalid.')
  }
  return value.trim() as LocalFeatureGateKey
}

export function registerFeatureGatesIpcHandlers(): void {
  ipcMain.handle('feature-gates:list', () => listFeatureGates())

  ipcMain.handle('feature-gates:set-enabled', (_, raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('feature-gates:set-enabled payload must be an object.')
    }
    const payload = raw as { featureKey?: unknown; enabled?: unknown }
    const featureKey = requireFeatureGateKey(payload.featureKey)
    if (typeof payload.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean.')
    }
    return setFeatureGateEnabled(featureKey, payload.enabled)
  })
}
