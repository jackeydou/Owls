import { like } from 'drizzle-orm'
import {
  featureGateSettingKey,
  isLocalFeatureGateKey,
  LOCAL_FEATURE_GATE_SETTING_PREFIX,
  LOCAL_FEATURE_GATES,
  type LocalFeatureGateKey,
  type LocalFeatureGateState,
  parseFeatureGateSettingKey
} from '../../shared/feature-gates.js'
import { db } from '../db/index.js'
import { settings } from '../db/schema.js'
import {
  deleteStoredSetting,
  getStoredSetting,
  setStoredSetting
} from '../stores/settings-store.js'

function getFeatureGateDefinition(key: LocalFeatureGateKey) {
  const definition = LOCAL_FEATURE_GATES.find((gate) => gate.key === key)
  if (!definition) {
    throw new Error(`Unknown feature gate: ${key}`)
  }
  return definition
}

function readStoredEnabled(key: LocalFeatureGateKey): boolean | null {
  const stored = getStoredSetting(featureGateSettingKey(key))
  if (stored === 'true') return true
  if (stored === 'false') return false
  return null
}

function toFeatureGateState(key: LocalFeatureGateKey): LocalFeatureGateState {
  const definition = getFeatureGateDefinition(key)
  const storedEnabled = readStoredEnabled(key)
  return {
    key,
    enabled: storedEnabled ?? definition.defaultEnabled,
    defaultEnabled: definition.defaultEnabled,
    hasUserOverride: storedEnabled !== null,
    labelKey: definition.labelKey,
    descriptionKey: definition.descriptionKey
  }
}

export function isFeatureGated(featureKey: LocalFeatureGateKey): boolean {
  return toFeatureGateState(featureKey).enabled
}

export function requireFeatureGateEnabled(
  featureKey: LocalFeatureGateKey,
  featureName: string
): void {
  if (!isFeatureGated(featureKey)) {
    throw new Error(`${featureName} is disabled by a local feature gate.`)
  }
}

export function listFeatureGates(): LocalFeatureGateState[] {
  pruneUnknownFeatureGateSettings()
  return LOCAL_FEATURE_GATES.map((gate) => gate.key)
    .sort()
    .map((key) => toFeatureGateState(key))
}

export function setFeatureGateEnabled(
  featureKey: LocalFeatureGateKey,
  enabled: boolean
): LocalFeatureGateState {
  if (!isLocalFeatureGateKey(featureKey)) {
    throw new Error(`Invalid feature gate key: ${featureKey}`)
  }

  const definition = getFeatureGateDefinition(featureKey)
  const settingKey = featureGateSettingKey(featureKey)
  if (enabled === definition.defaultEnabled) {
    deleteStoredSetting(settingKey)
  } else {
    setStoredSetting(settingKey, enabled ? 'true' : 'false')
  }
  return toFeatureGateState(featureKey)
}

export function pruneUnknownFeatureGateSettings(): number {
  const rows = db()
    .select()
    .from(settings)
    .where(like(settings.key, `${LOCAL_FEATURE_GATE_SETTING_PREFIX}%`))
    .all()

  let removedCount = 0
  for (const row of rows) {
    if (!row.key.startsWith('featureGate.')) continue
    const gateKey = parseFeatureGateSettingKey(row.key)
    if (gateKey) continue
    deleteStoredSetting(row.key)
    removedCount += 1
  }
  return removedCount
}
