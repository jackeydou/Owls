import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk/core'

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
