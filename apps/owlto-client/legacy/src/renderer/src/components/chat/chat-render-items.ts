import type { ToolWidgetState } from '@renderer/components/tool-widgets/types'
import type { ChatMessage } from '@renderer/stores/session-store'
import {
  isUserVisibleMessage,
  normalizeMessageVisibility
} from '../../../../shared/agent-message-visibility'
import { isInlineToolWidget } from './tool-activity-utils'

export type ToolGroupItem = {
  message: ChatMessage
  widget: ToolWidgetState
}

export type BasicChatRenderItem =
  | { kind: 'message'; message: ChatMessage; showFooter: boolean }
  | { kind: 'toolGroup'; id: string; items: ToolGroupItem[] }

export type WorkedRunRenderItem = {
  kind: 'workedRun'
  id: string
  runId: string | null
  status: ChatMessage['runStatus']
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  error: string | null
  activeStartedAt: string | null
  detailItems: BasicChatRenderItem[]
  promotedDetailItemIds: string[]
}

export type ChatRenderItem = BasicChatRenderItem | WorkedRunRenderItem

export function buildBasicRenderItems({
  messages,
  widgets,
  debugMode
}: {
  messages: ChatMessage[]
  widgets: Map<string, ToolWidgetState>
  debugMode: boolean
}): BasicChatRenderItem[] {
  const renderItems: BasicChatRenderItem[] = []
  let pendingTools: ToolGroupItem[] = []

  const isFollowedByToolGroup = (messageIndex: number): boolean => {
    for (let index = messageIndex + 1; index < messages.length; index += 1) {
      const nextMessage = messages[index]
      if (!nextMessage) continue
      const nextVisibility = normalizeMessageVisibility(nextMessage.visibility, nextMessage.role)
      if (!debugMode && !isUserVisibleMessage(nextVisibility)) continue

      if (nextMessage.role !== 'tool') return false
      if (!nextMessage.toolCallId) return false
      return widgets.has(nextMessage.toolCallId)
    }

    return false
  }

  const flushTools = () => {
    if (pendingTools.length === 0) return
    renderItems.push({
      kind: 'toolGroup',
      id: pendingTools[0]?.message.id ?? pendingTools.map((item) => item.message.id).join(':'),
      items: pendingTools
    })
    pendingTools = []
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message) continue
    const visibility = normalizeMessageVisibility(message.visibility, message.role)
    if (!debugMode && !isUserVisibleMessage(visibility)) continue

    if (message.role === 'tool' && message.toolCallId) {
      const widget = widgets.get(message.toolCallId)
      if (widget) {
        if (shouldPromoteToolWidget(widget)) {
          flushTools()
          renderItems.push({
            kind: 'toolGroup',
            id: message.id,
            items: [{ message, widget }]
          })
          continue
        }
        pendingTools.push({ message, widget })
        continue
      }
    }

    flushTools()
    renderItems.push({
      kind: 'message',
      message,
      showFooter: !(message.role === 'assistant' && isFollowedByToolGroup(index))
    })
  }

  flushTools()
  return renderItems
}

function isRunDetailMessage(message: ChatMessage): boolean {
  if (message.role === 'tool') return true
  if (message.role === 'assistant') {
    return !message.content.trim() || Boolean(message.runId)
  }
  return false
}

function isSteerUserMessage(message: ChatMessage): boolean {
  return message.role === 'user' && message.kind === 'steer' && Boolean(message.runId)
}

function runIdFromRunKey(runKey: string): string | null {
  return runKey.startsWith('run:') ? runKey.slice(4) || null : null
}

function legacySteerBridgeKey({
  message,
  currentRunKey,
  nextRunKey
}: {
  message: ChatMessage
  currentRunKey: string | null
  nextRunKey: string | null
}): string | null {
  if (message.role !== 'user' || message.kind === 'steer') return null
  if (!currentRunKey || nextRunKey !== currentRunKey) return null
  const messageKey = messageRunKey(message)
  if (messageKey && messageKey !== currentRunKey) return null
  return currentRunKey
}

function isLegacySteerBridgeCandidate(message: ChatMessage, currentRunKey: string | null): boolean {
  return Boolean(currentRunKey) && message.role === 'user' && message.kind !== 'steer'
}

function shouldPromoteToolWidget(widget: ToolWidgetState): boolean {
  return widget.toolName === 'streamingUITool' || isInlineToolWidget(widget)
}

function shouldPromoteDetailItem(
  item: BasicChatRenderItem
): item is Extract<BasicChatRenderItem, { kind: 'toolGroup' }> {
  return (
    item.kind === 'toolGroup' && item.items.some(({ widget }) => shouldPromoteToolWidget(widget))
  )
}

function messageAsSteer(message: ChatMessage, runKey: string): ChatMessage {
  if (message.kind === 'steer') return message
  return {
    ...message,
    kind: 'steer',
    runId: message.runId ?? runIdFromRunKey(runKey)
  }
}

function messageRunKey(message: ChatMessage): string | null {
  if (message.runId) return `run:${message.runId}`
  return null
}

function messageTime(message: ChatMessage): number {
  const timestamp = message.createdAt ? Date.parse(message.createdAt) : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : 0
}

function isTerminalRunStatus(status: ChatMessage['runStatus']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function deriveRunDuration(messages: ChatMessage[], activeStartedAt: string | null): number | null {
  if (activeStartedAt) return null
  const explicit = messages.find(
    (message) => typeof message.runDurationMs === 'number'
  )?.runDurationMs
  if (typeof explicit === 'number') return explicit
  if (messages.length === 0) return null
  return Math.max(0, messageTime(messages[messages.length - 1]) - messageTime(messages[0]))
}

function buildWorkedRunItem({
  groupMessages,
  detailMessages,
  widgets,
  debugMode,
  activeRunStartedAtsByRunId,
  itemId
}: {
  groupMessages: ChatMessage[]
  detailMessages?: ChatMessage[]
  widgets: Map<string, ToolWidgetState>
  debugMode: boolean
  activeRunStartedAtsByRunId: Map<string, string>
  itemId?: string
}): WorkedRunRenderItem | null {
  if (groupMessages.length === 0) return null
  const first = groupMessages[0]
  const runId = groupMessages.find((message) => message.runId)?.runId ?? null
  const persistedStatus = groupMessages.find((message) => message.runStatus)?.runStatus ?? null
  const completedAt =
    groupMessages.find((message) => typeof message.runCompletedAt === 'string')?.runCompletedAt ??
    null
  const activeStartedAt =
    runId && !completedAt && !isTerminalRunStatus(persistedStatus)
      ? (activeRunStartedAtsByRunId.get(runId) ?? null)
      : null
  const startedAt =
    groupMessages.find((message) => typeof message.runStartedAt === 'string')?.runStartedAt ??
    activeStartedAt ??
    first.createdAt ??
    null
  const renderedMessages = detailMessages ?? groupMessages
  const detailItems = buildBasicRenderItems({ messages: renderedMessages, widgets, debugMode })
  return {
    kind: 'workedRun',
    id: itemId ?? runId ?? groupMessages.map((message) => message.id).join(':'),
    runId,
    status: persistedStatus ?? (activeStartedAt ? 'running' : null),
    startedAt,
    completedAt,
    durationMs: deriveRunDuration(groupMessages, activeStartedAt),
    error: groupMessages.find((message) => typeof message.runError === 'string')?.runError ?? null,
    activeStartedAt,
    detailItems,
    promotedDetailItemIds: detailItems
      .filter((detailItem) => shouldPromoteDetailItem(detailItem))
      .map((detailItem) => detailItem.id)
  }
}

export function buildChatRenderItems({
  messages,
  widgets,
  debugMode,
  activeRunStartedAtsByRunId
}: {
  messages: ChatMessage[]
  widgets: Map<string, ToolWidgetState>
  debugMode: boolean
  activeRunStartedAtsByRunId: Map<string, string>
}): ChatRenderItem[] {
  const renderItems: ChatRenderItem[] = []
  let runGroupKey: string | null = null
  let runGroupMessages: ChatMessage[] = []

  const nextRunDetailKey = (startIndex: number): string | null => {
    for (let index = startIndex; index < messages.length; index += 1) {
      const message = messages[index]
      if (!message) continue
      const visibility = normalizeMessageVisibility(message.visibility, message.role)
      if (!debugMode && !isUserVisibleMessage(visibility)) continue
      if (!isRunDetailMessage(message)) continue
      return messageRunKey(message)
    }
    return null
  }

  const flushRunGroup = () => {
    if (runGroupMessages.length === 0) return
    const finalAssistantIndex = runGroupMessages.findLastIndex(
      (message) => message.role === 'assistant' && message.content.trim()
    )
    const finalAssistant = finalAssistantIndex >= 0 ? runGroupMessages[finalAssistantIndex] : null
    const detailMessages = finalAssistant
      ? runGroupMessages.filter((_, index) => index !== finalAssistantIndex)
      : runGroupMessages
    const item = buildWorkedRunItem({
      groupMessages: runGroupMessages,
      detailMessages,
      widgets,
      debugMode,
      activeRunStartedAtsByRunId,
      itemId: runGroupKey ?? undefined
    })
    if (item) renderItems.push(item)

    if (finalAssistant) {
      renderItems.push({
        kind: 'message',
        message: finalAssistant,
        showFooter: true
      })
    }
    runGroupKey = null
    runGroupMessages = []
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message) continue
    const visibility = normalizeMessageVisibility(message.visibility, message.role)
    if (!debugMode && !isUserVisibleMessage(visibility)) continue
    const key = isRunDetailMessage(message) ? messageRunKey(message) : null
    if (key) {
      if (runGroupKey && runGroupKey !== key) flushRunGroup()
      runGroupKey = key
      runGroupMessages.push(message)
      continue
    }
    const explicitSteerKey = isSteerUserMessage(message) ? messageRunKey(message) : null
    const needsLookAhead =
      explicitSteerKey !== null || isLegacySteerBridgeCandidate(message, runGroupKey)
    const nextDetailKey = needsLookAhead ? nextRunDetailKey(index + 1) : null
    const steerKey =
      explicitSteerKey ??
      legacySteerBridgeKey({ message, currentRunKey: runGroupKey, nextRunKey: nextDetailKey })
    if (steerKey && ((runGroupKey && steerKey === runGroupKey) || nextDetailKey === steerKey)) {
      if (runGroupKey && runGroupKey !== steerKey) flushRunGroup()
      runGroupKey = steerKey
      runGroupMessages.push(messageAsSteer(message, steerKey))
      continue
    }
    flushRunGroup()
    renderItems.push(...buildBasicRenderItems({ messages: [message], widgets, debugMode }))
  }

  flushRunGroup()
  return renderItems
}
