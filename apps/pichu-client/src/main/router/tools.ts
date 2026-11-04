import { z } from 'zod'
import { permissionSchema, providerSchema } from '../../shared/codex.js'

/** Model-facing error codes. Messages are short English sentences without paths or secrets. */
export type RouterToolErrorCode =
  | 'invalid_request'
  | 'permission_not_allowed'
  | 'provider_unavailable'
  | 'worker_limit_reached'
  | 'dispatch_failed'

export class RouterToolError extends Error {
  constructor(
    readonly code: RouterToolErrorCode,
    message: string
  ) {
    super(message)
  }
}

export const dispatchTaskInput = z
  .object({
    goal: z.string().trim().min(1).max(4000).describe('What the worker should accomplish.'),
    context: z
      .string()
      .max(8000)
      .optional()
      .describe('Background the worker needs that is not in the project itself.'),
    provider: providerSchema
      .optional()
      .describe('Coding agent to run the task. Omit to use the default agent.'),
    permission: permissionSchema
      .optional()
      .describe('Access the worker needs. Omit to use the project default.')
  })
  .strict()
export type DispatchTaskInput = z.infer<typeof dispatchTaskInput>
export type DispatchTaskResult = { workerId: string; status: 'started' | 'queued' }

export type RouterToolHandlers = {
  dispatchTask(input: DispatchTaskInput): Promise<DispatchTaskResult>
}

/** An engine-neutral tool: adapters convert `schema` to their own format. */
export type RouterTool = {
  name: string
  label: string
  description: string
  schema: z.ZodObject
  /** Validates `args` and returns the JSON text the model sees. Throws RouterToolError. */
  execute(args: unknown): Promise<string>
}

export function routerTools(handlers: RouterToolHandlers): RouterTool[] {
  return [
    {
      name: 'dispatch_task',
      label: 'Dispatch task',
      description:
        'Start a background worker (a Codex or Claude Code task in this project) for one piece of work. Returns immediately with the worker ID and whether it started or is queued behind other workers; the worker reports back in a later batch.',
      schema: dispatchTaskInput,
      async execute(args) {
        const parsed = dispatchTaskInput.safeParse(args)
        if (!parsed.success)
          throw new RouterToolError('invalid_request', 'The task arguments are invalid.')
        return JSON.stringify(await handlers.dispatchTask(parsed.data))
      }
    }
  ]
}

export function toolErrorText(error: unknown): string {
  const failure =
    error instanceof RouterToolError
      ? { code: error.code, message: error.message }
      : { code: 'dispatch_failed', message: 'The task could not be started.' }
  return JSON.stringify({ error: failure })
}

export function toolJsonSchema(tool: RouterTool): Record<string, unknown> {
  const { $schema: _draft, ...schema } = z.toJSONSchema(tool.schema, {
    target: 'draft-7'
  }) as Record<string, unknown>
  return schema
}
