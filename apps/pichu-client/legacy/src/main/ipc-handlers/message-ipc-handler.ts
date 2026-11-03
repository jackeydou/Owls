import { ipcMain } from 'electron'
import type {
  PichuMessageKind,
  PichuMessageVisibility
} from '../../shared/agent-message-visibility.js'
import {
  normalizeMessageKind,
  normalizeMessageVisibility
} from '../../shared/agent-message-visibility.js'
import type { MessageAttachment } from '../../shared/attachments.js'
import type { MessagePart } from '../../shared/message-parts.js'
import { persistSessionUserMessage } from '../agent/session-commands.js'
import {
  addMessage,
  getNextSortOrder,
  getSessionMessages,
  type MessageRow,
  searchSessionMessages,
  stringifyMessageAttachments
} from '../stores/settings-store.js'

type MessageIpcContext = {
  persistPromptInputMessages: (params: {
    sessionId: string
    cwd: string
    content: string
    agentContent: string
    attachments?: MessageAttachment[]
    parts?: MessagePart[]
  }) => Promise<{ userRow: MessageRow }>
}

export function registerMessageIpcHandlers(context: MessageIpcContext): void {
  ipcMain.handle(
    'messages:add',
    async (
      _,
      msg: {
        sessionId: string
        role: 'user' | 'assistant' | 'system' | 'tool'
        content: string
        runId?: string | null
        kind?: PichuMessageKind | null
        agentContent?: string | null
        visibility?: PichuMessageVisibility | null
        toolCallId?: string
        toolName?: string
        attachments?: MessageAttachment[]
        parts?: MessagePart[]
        persistRuntimeContext?: boolean | null
        modelId?: string | null
        modelProvider?: string | null
        modelApi?: string | null
        modelUsageJson?: string | null
      }
    ) => {
      if (msg.role === 'user') {
        return persistSessionUserMessage(context, {
          sessionId: msg.sessionId,
          content: msg.content,
          agentContent: msg.agentContent,
          attachments: msg.attachments,
          parts: msg.parts,
          persistRuntimeContext: msg.persistRuntimeContext,
          kind: msg.kind,
          runId: msg.runId,
          visibility: msg.visibility
        })
      }
      const agentContent = msg.agentContent ?? ''
      const visibility = normalizeMessageVisibility(msg.visibility, msg.role)
      const kind = normalizeMessageKind(msg.kind)
      const row: MessageRow = {
        id: crypto.randomUUID(),
        sessionId: msg.sessionId,
        role: msg.role,
        runId: msg.runId ?? null,
        kind,
        content: msg.content,
        agentContent,
        visibility,
        sortOrder: getNextSortOrder(msg.sessionId),
        createdAt: new Date().toISOString(),
        toolCallId: msg.toolCallId ?? null,
        toolName: msg.toolName ?? null,
        attachmentsJson: stringifyMessageAttachments(msg.attachments),
        modelId: msg.modelId ?? null,
        modelProvider: msg.modelProvider ?? null,
        modelApi: msg.modelApi ?? null,
        modelUsageJson: msg.modelUsageJson ?? null,
        parts: msg.parts ?? []
      }
      addMessage(row)
      return row
    }
  )

  ipcMain.handle('messages:list', (_, sessionId: string) => {
    return getSessionMessages(sessionId)
  })

  ipcMain.handle('messages:search', (_, query: { text: string; limit?: number }) => {
    return searchSessionMessages(query)
  })
}
