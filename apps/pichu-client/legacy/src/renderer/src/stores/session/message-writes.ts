import type { MessageAttachment, MessageRow } from '../../../../preload/index.d'
import type { PichuMessageKind } from '../../../../shared/agent-message-visibility'
import { normalizeMessageKind } from '../../../../shared/agent-message-visibility'
import type { MessagePart } from '../../../../shared/message-parts'
import { activeRunIdForSession } from './assistant-flow'
import { parseMessageAttachments } from './attachments'
import { rowRunFields } from './messages'
import type { ChatMessage, SessionStoreGet, SessionStoreSet } from './types'

export function appendUserMessage(
  sid: string,
  text: string,
  agentText: string | undefined,
  attachments: MessageAttachment[] | undefined,
  parts: MessagePart[] | undefined,
  persistRuntimeContext: boolean,
  messageKind: PichuMessageKind,
  runId: string | null,
  set: SessionStoreSet
): Promise<MessageRow> {
  return window.api.messages
    .add({
      sessionId: sid,
      role: 'user',
      runId,
      kind: messageKind,
      content: text,
      agentContent: agentText,
      attachments,
      parts,
      persistRuntimeContext
    })
    .then((row) => {
      const persisted = row as MessageRow
      const userMessage: ChatMessage = {
        id: persisted.id,
        role: 'user',
        kind: normalizeMessageKind(persisted.kind),
        content: persisted.content,
        parts: persisted.parts ?? [],
        visibility: persisted.visibility,
        createdAt: persisted.createdAt,
        ...rowRunFields(persisted),
        attachments: parseMessageAttachments(persisted.attachmentsJson)
      }
      set((state) => ({
        messages: [...state.messages, userMessage],
        streamingAssistant: '',
        streamingThinking: false,
        pendingReconnectStatus: null,
        pendingAssistantAttachments: [],
        pendingRawEvents: [],
        sessionIndex: state.sessionIndex.map((entry) =>
          entry.sessionId === sid ? { ...entry, updatedAt: persisted.createdAt } : entry
        )
      }))
      return persisted
    })
}

export function appendAssistantFailureMessage(
  sid: string,
  content: string,
  get: SessionStoreGet,
  set: SessionStoreSet
): void {
  if (!content.trim()) return
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content,
    runId: activeRunIdForSession(get(), sid),
    visibility: 'shared',
    createdAt: new Date().toISOString()
  }
  set((state) => ({
    messages: [...state.messages, message],
    streamingAssistant: '',
    streamingThinking: false,
    pendingReconnectStatus: null,
    pendingRawEvents: []
  }))
  void window.api.messages.add({ sessionId: sid, role: 'assistant', content }).catch(console.error)
}
