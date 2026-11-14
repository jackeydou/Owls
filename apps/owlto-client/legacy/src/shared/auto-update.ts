export type AutoUpdateChannel = 'stable' | 'beta'

export type AutoUpdateStatus =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type AutoUpdateState = {
  status: AutoUpdateStatus
  currentVersion: string
  availableVersion: string | null
  releaseNotes: string | null
  downloadPercent: number | null
  error: string | null
}

export function normalizeAutoUpdateChannel(value: unknown): AutoUpdateChannel {
  return value === 'beta' ? 'beta' : 'stable'
}
