import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk/core'
import type { RuntimeTurn } from '../app/agent-runtime.js'
import { splitAttachments, turnText } from '../app/attachments.js'

/** Keeps the base64 copy under the Messages API's 5 MB image limit. */
const CLAUDE_IMAGE_MAX_BYTES = 3_750_000

/**
 * A turn as Claude Code takes it: images inline as base64 blocks, other files
 * (and images too large to inline) as paths for its Read tool.
 */
export async function claudeContent(turn: RuntimeTurn): Promise<SDKUserMessage['message']> {
  if (!turn.attachments?.length) return { role: 'user', content: turn.text }
  const { images, rest } = await splitAttachments(turn.attachments, CLAUDE_IMAGE_MAX_BYTES)
  const text = turnText(turn.text, rest)
  return {
    role: 'user',
    content: [
      ...images.map((image) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: image.mimeType, data: image.data }
      })),
      ...(text ? [{ type: 'text' as const, text }] : [])
    ]
  }
}

export type InputStream = {
  stream: AsyncIterable<SDKUserMessage>
  push(message: SDKUserMessage): void
  close(): void
}
/**
 * Streaming input keeps the CLI's stdin open for the whole turn. Claude Code
 * only routes permission prompts and interrupts to the host in this mode.
 */
export function inputStream(): InputStream {
  const queue: SDKUserMessage[] = []
  let wake: (() => void) | null = null
  let closed = false
  const notify = () => {
    wake?.()
    wake = null
  }
  async function* stream(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const next = queue.shift()
      if (next) {
        yield next
        continue
      }
      if (closed) return
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  }
  return {
    stream: stream(),
    push(message) {
      queue.push(message)
      notify()
    },
    close() {
      closed = true
      notify()
    }
  }
}
