import type { ToolWidgetState } from '@renderer/components/tool-widgets/types'
import type {
  ChatMessage,
  ModelReconnectStatus,
  SessionSetupStatus
} from '@renderer/stores/session-store'
import { useMemo } from 'react'
import { buildChatRenderItems, type WorkedRunRenderItem } from './chat-render-items'
import {
  collectGeneratedImagePathsFromResult,
  isImageGenerationWidget
} from './tool-activity-utils'

export function useChatRenderState({
  activeRunIdsBySession,
  activeRunStartedAtsBySession,
  busy,
  debugMode,
  messages,
  pendingReconnectStatus,
  setupStatus,
  streamingAssistant,
  widgets
}: {
  activeRunIdsBySession: Record<string, string>
  activeRunStartedAtsBySession: Record<string, string>
  busy: boolean
  debugMode: boolean
  messages: ChatMessage[]
  pendingReconnectStatus: ModelReconnectStatus | null
  setupStatus: SessionSetupStatus | null
  streamingAssistant: string
  widgets: Map<string, ToolWidgetState>
}) {
  const activeRunStartedAtsByRunId = useMemo(() => {
    const entries = Object.entries(activeRunIdsBySession).flatMap(([activeSessionId, runId]) => {
      const startedAt = activeRunStartedAtsBySession[activeSessionId]
      return startedAt ? [[runId, startedAt] as const] : []
    })
    return new Map(entries)
  }, [activeRunIdsBySession, activeRunStartedAtsBySession])

  const renderItems = useMemo(
    () => buildChatRenderItems({ messages, widgets, debugMode, activeRunStartedAtsByRunId }),
    [messages, widgets, debugMode, activeRunStartedAtsByRunId]
  )

  const generatedImageAttachmentPaths = useMemo(() => {
    const paths = new Set<string>()
    widgets.forEach((widget) => {
      if (isImageGenerationWidget(widget))
        collectGeneratedImagePathsFromResult(paths, widget.result)
    })
    return paths
  }, [widgets])

  const lastRenderItem = renderItems.at(-1)
  const activeToolGroup = busy && lastRenderItem?.kind === 'toolGroup' ? lastRenderItem : null
  const activeWorkedRun = busy
    ? (renderItems.findLast(
        (item): item is WorkedRunRenderItem =>
          item.kind === 'workedRun' && Boolean(item.activeStartedAt)
      ) ?? null)
    : null
  const activeToolGroupId = activeToolGroup?.id ?? null
  const hasRunningToolActivity = Boolean(
    activeToolGroup?.items.some(
      ({ widget }) =>
        widget.toolName !== 'streamingUITool' &&
        (widget.status === 'streaming' ||
          widget.status === 'running' ||
          widget.status === 'waiting_for_user')
    ) ||
      activeWorkedRun?.detailItems.some(
        (detailItem) =>
          detailItem.kind === 'toolGroup' &&
          detailItem.items.some(
            ({ widget }) =>
              widget.toolName !== 'streamingUITool' &&
              (widget.status === 'streaming' ||
                widget.status === 'running' ||
                widget.status === 'waiting_for_user')
          )
      )
  )
  const shouldShowThinkingActivity =
    busy &&
    !setupStatus &&
    !streamingAssistant &&
    !pendingReconnectStatus &&
    !hasRunningToolActivity
  const pendingThinkingAssistantMessageId =
    shouldShowThinkingActivity &&
    lastRenderItem?.kind === 'message' &&
    lastRenderItem.message.role === 'assistant'
      ? lastRenderItem.message.id
      : null

  const persistentCopyMessageIds = useMemo(() => {
    const ids = new Set<string>()

    for (let index = renderItems.length - 1; index >= 0; index -= 1) {
      const item = renderItems[index]
      if (!item || item.kind !== 'message' || !item.showFooter) continue
      if (item.message.id === pendingThinkingAssistantMessageId) continue
      if (item.message.role === 'assistant') {
        ids.add(item.message.id)
        break
      }
    }

    return ids
  }, [renderItems, pendingThinkingAssistantMessageId])

  return {
    activeToolGroupId,
    activeWorkedRun,
    generatedImageAttachmentPaths,
    pendingThinkingAssistantMessageId,
    persistentCopyMessageIds,
    renderItems,
    shouldShowThinkingActivity
  }
}
