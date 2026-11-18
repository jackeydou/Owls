import { z } from 'zod'
import type { ReportToolResult } from './report.js'

/**
 * A tool Owlto gives a worker besides `report`. Every agent gets the same set:
 * Claude Code through the in-process `owlto` MCP server, Codex as dynamic tools
 * named `owlto_<name>`, and Cursor through the local HTTP MCP server.
 */
export type WorkerTool = {
  name: string
  description: string
  /** For the Agent SDK, which takes a zod schema. */
  schema: z.ZodObject
  /** The same schema as JSON Schema, for Codex and MCP clients. */
  inputSchema: Record<string, unknown>
  /** Owlto's own tools answer at once; the browser tool waits for its run. */
  call(input: unknown): ReportToolResult | Promise<ReportToolResult>
}

/** Codex dynamic tools share a namespace with the agent's own tools, so Owlto's are prefixed. */
export const codexToolName = (name: string) => `owlto_${name}`

/**
 * Wraps a handler as a worker tool that validates its input first. A handler
 * returns the JSON value the agent sees, or throws an Error whose message is a
 * short sentence the agent can act on.
 */
export function workerTool<T extends z.ZodObject>(
  name: string,
  description: string,
  schema: T,
  run: (input: z.infer<T>) => unknown
): WorkerTool {
  const { inputSchema, validate } = toolInput(name, schema)
  return {
    name,
    description,
    schema,
    inputSchema,
    call(input) {
      const parsed = validate(input)
      if (!parsed.ok) return parsed
      try {
        return { ok: true, text: JSON.stringify(run(parsed.data)) }
      } catch (error) {
        return failed(name, error)
      }
    }
  }
}

/**
 * A worker tool whose handler is async and returns the exact text the agent
 * sees. A rejection becomes a failed call carrying the error's message.
 */
export function asyncWorkerTool<T extends z.ZodObject>(
  name: string,
  description: string,
  schema: T,
  run: (input: z.infer<T>) => Promise<ReportToolResult>
): WorkerTool {
  const { inputSchema, validate } = toolInput(name, schema)
  return {
    name,
    description,
    schema,
    inputSchema,
    async call(input) {
      const parsed = validate(input)
      if (!parsed.ok) return parsed
      try {
        return await run(parsed.data)
      } catch (error) {
        return failed(name, error)
      }
    }
  }
}

function failed(name: string, error: unknown): ReportToolResult {
  return { ok: false, text: error instanceof Error ? error.message : `The ${name} call failed.` }
}

function toolInput<T extends z.ZodObject>(name: string, schema: T) {
  const { $schema: _draft, ...inputSchema } = z.toJSONSchema(schema, {
    target: 'draft-7'
  }) as Record<string, unknown>
  const validate = (
    input: unknown
  ): { ok: true; data: z.infer<T> } | { ok: false; text: string } => {
    const parsed = schema.safeParse(input)
    if (parsed.success) return { ok: true, data: parsed.data }
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
      .join('; ')
    return { ok: false, text: `Invalid ${name} input. ${issues}` }
  }
  return { inputSchema, validate }
}
