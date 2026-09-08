import type { SessionInspectorDataSource, SessionListResult, SessionText } from './InspectorApp'

function decodeHeaderValue(value: string | null): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const httpSessionInspectorDataSource: SessionInspectorDataSource = {
  async listSessions(input = {}): Promise<SessionListResult> {
    const params = new URLSearchParams({ limit: String(input.limit ?? 160) })
    if (input.includeOptional === false) {
      params.set('includeOptional', 'false')
    }
    const response = await fetch(`/api/sessions?${params.toString()}`)
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(body?.error || 'Failed to list sessions')
    }
    return response.json() as Promise<SessionListResult>
  },

  async readSessionText(path: string): Promise<SessionText> {
    if (path.startsWith('pichu://')) {
      const sessionId = path.slice('pichu://'.length)
      const response = await fetch(`/api/pichu/session?id=${encodeURIComponent(sessionId)}`)
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || `Failed to read Owls session ${sessionId}`)
      }
      return {
        body: await response.text(),
        title: ''
      }
    }

    const response = await fetch(`/api/session?path=${encodeURIComponent(path)}`)
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(body?.error || `Failed to read ${path}`)
    }
    return {
      body: await response.text(),
      title: decodeHeaderValue(response.headers.get('x-session-title'))
    }
  }
}
