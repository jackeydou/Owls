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

/** The tool workers report through: an MCP tool for Claude Code and Cursor, a dynamic tool for Codex. */
export const REPORT_TOOL_NAME = 'report'
/** Codex dynamic tools share one namespace with the agent's own tools, so this one is prefixed. */
export const CODEX_REPORT_TOOL_NAME = 'owls_report'
/** The MCP server name; Claude Code shows the tool as `mcp__owls__report`. */
export const REPORT_SERVER_NAME = 'owls'
export const REPORT_TOOL_DESCRIPTION =
  'Report to the Owls Router, the coordinator that gave you this task. Call it once when you finish, with status done, blocked, or needs_input. On a long task you may also call it with status progress to say how far you are; that does not end your turn.'

/** The report tool's input, for agents that take a zod schema (the Agent SDK). */
export const REPORT_TOOL_SCHEMA = z
  .object({
    status: z
      .enum(['done', 'blocked', 'needs_input', 'progress'])
      .describe(
        'done: the task is complete. blocked: you cannot continue. needs_input: the user must decide something. progress: an interim note while you keep working.'
      ),
    summary: z
      .string()
      .max(WORKER_SUMMARY_LIMIT)
      .describe('For the coordinator, in at most a few sentences, about this task only.'),
    artifacts: z
      .array(z.object({ kind: z.enum(['file', 'url', 'note']), ref: z.string().max(2000) }))
      .max(20)
      .optional()
      .describe('Files, URLs, or notes the coordinator should know about.')
  })
  .strict()
const { $schema: _toolDraft, ...reportToolJsonSchema } = z.toJSONSchema(REPORT_TOOL_SCHEMA, {
  target: 'draft-7'
}) as Record<string, unknown>
/** The report tool's input schema. Unlike the output schema, tool inputs may carry length limits. */
export const REPORT_TOOL_INPUT_SCHEMA: Record<string, unknown> = reportToolJsonSchema

/** What a worker's agent sees after calling the report tool. */
export type ReportToolResult = { ok: boolean; text: string }

/**
 * Validates a report tool call. Agents do not reliably enforce the schema
 * themselves (F18), so a bad call comes back as an error the agent can fix.
 */
export function parseToolReport(
  input: unknown
): { ok: true; report: WorkerReport } | { ok: false; text: string } {
  const parsed = workerReportSchema.strict().safeParse(input)
  if (parsed.success) return { ok: true, report: parsed.data }
  const issues = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
    .join('; ')
  return { ok: false, text: `Invalid report. ${issues}` }
}

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
