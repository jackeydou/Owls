import type { HumanInputRequestForRenderer } from '../../../../shared/human-input'

export type ToolWidgetStatus = 'streaming' | 'running' | 'waiting_for_user' | 'complete' | 'error'

export type ToolWidgetState = {
  toolCallId: string
  toolName: string
  title: string
  args: Record<string, unknown>
  result?: unknown
  humanInput?: HumanInputRequestForRenderer
  status: ToolWidgetStatus
  isError: boolean
}

export type ToolWidgetComponentProps = {
  widget: ToolWidgetState
  expanded: boolean
  isStreaming: boolean
}
