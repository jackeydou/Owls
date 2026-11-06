export type ThinkingTagFilterOptions = {
  stripLeadingCloseTagPrefix?: boolean
}

const THINK_OPEN_TAG_PATTERN = /<think\b[^>]*>/i
const THINK_CLOSE_TAG_PATTERN = /<\/think(?:_[a-z0-9]+)*>/i
const LEADING_CLOSE_PREFIX_MAX_BUFFER_CHARS = 4096

export class ThinkingTagFilter {
  private buffer = ''
  private inThinking = false
  private leadingClosePrefixPending: boolean

  constructor(options: ThinkingTagFilterOptions = {}) {
    this.leadingClosePrefixPending = Boolean(options.stripLeadingCloseTagPrefix)
  }

  consume(input: string): string {
    this.buffer += input
    let output = ''

    for (;;) {
      if (this.leadingClosePrefixPending) {
        const closeMatch = THINK_CLOSE_TAG_PATTERN.exec(this.buffer)
        const openMatch = THINK_OPEN_TAG_PATTERN.exec(this.buffer)
        if (closeMatch && (!openMatch || closeMatch.index < openMatch.index)) {
          this.buffer = this.buffer
            .slice(closeMatch.index + closeMatch[0].length)
            .replace(/^\s+/, '')
          this.leadingClosePrefixPending = false
          continue
        }

        if (!openMatch) {
          if (this.buffer.length <= LEADING_CLOSE_PREFIX_MAX_BUFFER_CHARS) return output
          output += this.buffer
          this.buffer = ''
          this.leadingClosePrefixPending = false
          return output
        }

        this.leadingClosePrefixPending = false
      }

      if (this.inThinking) {
        const closeMatch = THINK_CLOSE_TAG_PATTERN.exec(this.buffer)
        if (!closeMatch) {
          this.buffer = this.buffer.slice(-8)
          return output
        }
        this.buffer = this.buffer.slice(closeMatch.index + closeMatch[0].length)
        this.inThinking = false
        continue
      }

      const openMatch = THINK_OPEN_TAG_PATTERN.exec(this.buffer)
      if (openMatch) {
        output += this.buffer.slice(0, openMatch.index)
        this.buffer = this.buffer.slice(openMatch.index + openMatch[0].length)
        this.inThinking = true
        continue
      }

      const keep = partialThinkTagPrefixLength(this.buffer)
      if (keep > 0) {
        output += this.buffer.slice(0, -keep)
        this.buffer = this.buffer.slice(-keep)
      } else {
        output += this.buffer
        this.buffer = ''
      }
      return output
    }
  }

  flush(): string {
    if (this.inThinking) {
      this.buffer = ''
      return ''
    }
    const output = this.buffer
    this.buffer = ''
    this.leadingClosePrefixPending = false
    return output
  }
}

function partialThinkTagPrefixLength(value: string): number {
  const marker = '<think'
  const lower = value.toLowerCase()
  const max = Math.min(marker.length - 1, lower.length)
  for (let length = max; length > 0; length -= 1) {
    if (marker.startsWith(lower.slice(-length))) {
      return length
    }
  }
  return 0
}

export function stripThinkingTags(value: string, options?: ThinkingTagFilterOptions): string {
  const filter = new ThinkingTagFilter(options)
  return `${filter.consume(value)}${filter.flush()}`
}

export function stripStreamingThinkingTags(
  value: string,
  options?: ThinkingTagFilterOptions
): string {
  const filter = new ThinkingTagFilter(options)
  return filter.consume(value)
}

export function shouldStripLeadingThinkClosePrefix(modelId: string | null | undefined): boolean {
  return /\b(minimax|seed)\b/i.test(modelId ?? '')
}
