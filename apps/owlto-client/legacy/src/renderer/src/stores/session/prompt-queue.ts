import type { MessageAttachment } from '../../../../preload/index.d'
import type { MessagePart } from '../../../../shared/message-parts'
import type { QueuedPrompt, SessionStoreGet, SessionStoreSet } from './types'

export function queuePrompt(
  text: string,
  cwd: string,
  attachments: MessageAttachment[] | undefined,
  set: SessionStoreSet,
  agentText?: string,
  parts?: MessagePart[]
): void {
  set((state) => ({
    queuedPrompts: [
      ...state.queuedPrompts,
      {
        id: crypto.randomUUID(),
        text,
        agentText,
        parts,
        cwd,
        attachments,
        createdAt: new Date().toISOString()
      }
    ]
  }))
}

export function popNextQueuedPrompt(
  get: SessionStoreGet,
  set: SessionStoreSet
): QueuedPrompt | null {
  const next = get().queuedPrompts[0]
  if (!next) return null
  set((state) => ({ queuedPrompts: state.queuedPrompts.slice(1) }))
  return next
}
