import { z } from 'zod'
import { type WorkerReport, workerReportSchema } from '../../shared/router.js'

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
 * message text (Codex). Anything that does not match becomes a `progress`
 * report holding the start of the raw text, so the Router always gets an event.
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
      /* Not JSON; fall through to the degraded report. */
    }
  }
  for (const candidate of candidates) {
    const parsed = workerReportSchema.safeParse(clamp(candidate))
    if (parsed.success) return { report: parsed.data, degraded: false }
  }
  return {
    report: { status: 'progress', summary: trimmed.slice(0, 500), artifacts: [] },
    degraded: true
  }
}
function clamp(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  return {
    ...record,
    summary: typeof record.summary === 'string' ? record.summary.slice(0, 1000) : record.summary,
    artifacts: Array.isArray(record.artifacts) ? record.artifacts.slice(0, 20) : record.artifacts
  }
}
