import { parse, type SyntaxSpan } from 'gpu-lexer'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

/** Past this many characters the file is shown plain; lexing it would hold up the viewer. */
const HIGHLIGHT_LIMIT = 300_000
/**
 * Spans the model is less sure of than this stay uncolored, as gpu-lexer suggests: a
 * missing color reads better than a wrong one.
 */
const MIN_CONFIDENCE = 6 / 16

type Segment = { text: string; type: SyntaxSpan['type'] }

/** Splits the source into lines of colored segments; without spans, each line is plain. */
function toLines(text: string, spans: readonly SyntaxSpan[] | null): Segment[][] {
  if (!spans) return text.split('\n').map((line) => [{ text: line, type: 'plain' }])
  const lines: Segment[][] = [[]]
  let at = 0
  const push = (part: string, type: Segment['type']) => {
    const pieces = part.split('\n')
    pieces.forEach((piece, index) => {
      if (index > 0) lines.push([])
      if (piece) lines[lines.length - 1].push({ text: piece, type })
    })
  }
  for (const span of spans) {
    if (span.start > at) push(text.slice(at, span.start), 'plain')
    if (span.end <= at) continue
    const type = span.confidence >= MIN_CONFIDENCE ? span.type : 'plain'
    push(text.slice(Math.max(at, span.start), span.end), type)
    at = span.end
  }
  if (at < text.length) push(text.slice(at), 'plain')
  return lines
}

/**
 * Lexes with gpu-lexer, which runs on WebGPU. Resolves null where WebGPU is missing or the
 * model fails, and the code shows plain.
 */
function useSyntaxSpans(text: string): SyntaxSpan[] | null {
  const [result, setResult] = useState<{ text: string; spans: SyntaxSpan[] | null } | null>(null)
  useEffect(() => {
    if (text.length > HIGHLIGHT_LIMIT || !('gpu' in navigator)) return
    let live = true
    parse(text).then(
      (spans) => live && setResult({ text, spans }),
      () => live && setResult({ text, spans: null })
    )
    return () => {
      live = false
    }
  }, [text])
  return result?.text === text ? result.spans : null
}

/** Source code with line numbers and syntax colors; `line` is scrolled to and marked. */
export function CodeView({ text, line }: { text: string; line: number | null }) {
  const spans = useSyntaxSpans(text)
  const lines = useMemo(() => toLines(text, spans), [text, spans])
  const marked = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    // Scrolls only the viewer: scrollIntoView would also shift the app's overflow-hidden frames.
    const row = marked.current
    const scroller = row?.closest<HTMLElement>('.file-viewer-body')
    if (line === null || !row || !scroller) return
    const offset = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTop += offset - scroller.clientHeight / 2 + row.offsetHeight / 2
  }, [line])
  return (
    <div
      className="file-code"
      style={{ ['--file-gutter' as string]: `${String(lines.length).length}ch` }}
    >
      {lines.map((segments, index) => {
        const number = index + 1
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
            key={index}
            ref={number === line ? marked : undefined}
            className="file-code-line"
            data-marked={number === line || undefined}
          >
            <span className="file-code-number" aria-hidden>
              {number}
            </span>
            <span className="file-code-text">
              {segments.map((segment, at) =>
                segment.type === 'plain' ? (
                  segment.text
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                  <span key={at} data-syntax={segment.type}>
                    {segment.text}
                  </span>
                )
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
