export type BackgroundTerminalStatusForRenderer = 'running' | 'terminating'

export type BackgroundTerminalForRenderer = {
  id: string
  command: string
  cwd: string
  sessionId: string | null
  pid: number | null
  startedAt: string
  status: BackgroundTerminalStatusForRenderer
}

export type ListBackgroundTerminalsRequest = {
  sessionId?: string | null
  cursor?: string | null
  limit?: number | null
}

export type ListBackgroundTerminalsResult = {
  data: BackgroundTerminalForRenderer[]
  nextCursor: string | null
}

export type TerminateBackgroundTerminalRequest = {
  id: string
  sessionId?: string | null
}

export type TerminateBackgroundTerminalResult = {
  terminated: boolean
}

export type CleanBackgroundTerminalsRequest = {
  sessionId?: string | null
}

export type CleanBackgroundTerminalsResult = {
  terminated: number
}
