import {
  InspectorApp,
  latestPichuSessionPath,
  type SessionInspectorDataSource
} from '@pichu/session-inspector'
import { useMemo } from 'react'

const electronSessionInspectorDataSource: SessionInspectorDataSource = {
  listSessions: (input) => window.api.sessionInspector.listSessions(input),
  readSessionText: (path) => window.api.sessionInspector.readSessionText(path)
}

const storedSessionInspectorPathKey = 'session-inspector:path'

function initialSessionInspectorPath(): string {
  const storedPath = window.localStorage.getItem(storedSessionInspectorPathKey)?.trim()
  if (!storedPath) {
    return latestPichuSessionPath
  }

  if (storedPath.includes('/.codex/') || storedPath.includes('\\.codex\\')) {
    window.localStorage.removeItem(storedSessionInspectorPathKey)
    return latestPichuSessionPath
  }

  return storedPath
}

export function SessionInspectorPage(): React.JSX.Element {
  const initialPath = useMemo(() => initialSessionInspectorPath(), [])
  return <InspectorApp dataSource={electronSessionInspectorDataSource} initialPath={initialPath} />
}
