export const LOCAL_FEATURE_GATE_SETTING_PREFIX = 'featureGate.' as const

export type LocalFeatureGateDefinition = {
  key: string
  defaultEnabled: boolean
  labelKey: string
  descriptionKey: string
}

export const LOCAL_FEATURE_GATES = [
  {
    key: 'sopCreator',
    defaultEnabled: false,
    labelKey: 'advanced.featureGates.sopCreator.label',
    descriptionKey: 'advanced.featureGates.sopCreator.description'
  }
] as const satisfies readonly LocalFeatureGateDefinition[]

export type LocalFeatureGateKey = (typeof LOCAL_FEATURE_GATES)[number]['key']

export type LocalFeatureGateState = {
  key: LocalFeatureGateKey
  enabled: boolean
  defaultEnabled: boolean
  hasUserOverride: boolean
  labelKey: string
  descriptionKey: string
}

const LOCAL_FEATURE_GATE_KEYS = new Set<string>(LOCAL_FEATURE_GATES.map((gate) => gate.key))

export function isLocalFeatureGateKey(value: string): value is LocalFeatureGateKey {
  return LOCAL_FEATURE_GATE_KEYS.has(value)
}

export function featureGateSettingKey(key: LocalFeatureGateKey): string {
  return `${LOCAL_FEATURE_GATE_SETTING_PREFIX}${key}`
}

export function parseFeatureGateSettingKey(settingKey: string): LocalFeatureGateKey | null {
  if (!settingKey.startsWith(LOCAL_FEATURE_GATE_SETTING_PREFIX)) {
    return null
  }
  const gateKey = settingKey.slice(LOCAL_FEATURE_GATE_SETTING_PREFIX.length)
  return isLocalFeatureGateKey(gateKey) ? gateKey : null
}
