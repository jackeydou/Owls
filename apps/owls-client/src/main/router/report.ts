import { z } from 'zod'
import { WORKER_SUMMARY_LIMIT, type WorkerReport, workerReportSchema } from '../../shared/router.js'

const { $schema: _draft, ...reportJsonSchema } = z.toJSONSchema(
  z
    .object({
      status: z.enum(['done', 'blocked', 'needs_input', 'progress']),
      summary: z.string(),
      artifacts: z.array(
        z.object({ kind: z.enum(['file', 'url', 'note']), ref: z.string() }).strict()
      )
    })
    .strict(),
  { target: 'draft-7' }
) as Record<string, unknown>
/**
 * JSON Schema both CLIs use to constrain a worker's final message. Length limits
 * are applied when parsing instead, because strict structured-output modes
 * reject `maxLength`.
 */
export const WORKER_REPORT_JSON_SCHEMA: Record<string, unknown> = reportJsonSchema

/**
 * Reads a worker's report from the structured output (Claude Code) or the final
 * message text (Codex, Cursor). Agents without an output schema may wrap the
 * JSON in a fence or put text before it, so a trailing JSON object counts too.
 * Anything that does not match becomes a `progress` report holding the raw
 * text, so the Router always gets an event.
 */
export function parseReport(
  structured: unknown,
  text: string
): { report: WorkerReport; degraded: boolean } {
  const candidates: unknown[] = []
  if (structured !== null && structured !== undefined) candidates.push(structured)
  const trimmed = text.trim()
  if (trimmed) {
    try {
      candidates.push(JSON.parse(trimmed))
    } catch {
      const trailing = trailingJson(trimmed)
      if (trailing !== null) candidates.push(trailing)
    }
  }
  for (const candidate of candidates) {
    const parsed = workerReportSchema.safeParse(clamp(candidate))
    if (parsed.success) return { report: parsed.data, degraded: false }
  }
  return {
    report: { status: 'progress', summary: trimmed.slice(0, WORKER_SUMMARY_LIMIT), artifacts: [] },
    degraded: true
  }
}
/** Fence openings and object starts tried from the end; a report is near the end. */
const TRAILING_TRIES = 50

/** The JSON object a message ends with, inside a Markdown fence or not; null when none. */
function trailingJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text)
  const body = fenced ? fenced[1].trim() : text
  if (!body.endsWith('}')) return null
  let start = body.lastIndexOf('{')
  for (let tries = 0; start >= 0 && tries < TRAILING_TRIES; tries++) {
    try {
      const value: unknown = JSON.parse(body.slice(start))
      if (value && typeof value === 'object' && !Array.isArray(value)) return value
    } catch {
      /* Not the start of the trailing object; try an earlier brace. */
    }
    start = body.lastIndexOf('{', start - 1)
  }
  return null
}
function clamp(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  return {
    ...record,
    summary:
      typeof record.summary === 'string'
        ? record.summary.slice(0, WORKER_SUMMARY_LIMIT)
        : record.summary,
    artifacts: Array.isArray(record.artifacts) ? record.artifacts.slice(0, 20) : record.artifacts
  }
}
