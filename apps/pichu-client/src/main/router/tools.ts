import { z } from 'zod'
import { permissionSchema, providerSchema } from '../../shared/codex.js'
import { workerStatusSchema, worktreeBaseSchema } from '../../shared/router.js'

/** Model-facing error codes. Messages are short English sentences without paths or secrets. */
export type RouterToolErrorCode =
  | 'invalid_request'
  | 'permission_not_allowed'
  | 'provider_unavailable'
  | 'worker_limit_reached'
  | 'dispatch_failed'
  | 'worker_not_found'
  | 'worker_closed'
  | 'not_found'
  | 'tool_failed'

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
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Short label the user sees, under 60 characters, in the user's language."),
    parent: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe('The worker whose result this task builds on. Omit for new work.'),
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
      .describe('Access the worker needs. Omit to use the project default.'),
    workspace: z
      .enum(['worktree', 'checkout'])
      .optional()
      .describe(
        "Where a worker that can write runs. Omit for its own git worktree; use checkout only when it must work in the user's checkout."
      ),
    base: worktreeBaseSchema
      .optional()
      .describe(
        "What a worktree starts from: head (the user's current branch, the default) or default-branch (the remote default branch)."
      )
  })
  .strict()
export type DispatchTaskInput = z.infer<typeof dispatchTaskInput>
export type DispatchTaskResult = {
  workerId: string
  status: 'started' | 'queued'
  workspace: 'worktree' | 'checkout'
  /** The worktree's branch, which holds the worker's commits; null in the checkout. */
  branch: string | null
}

const workerId = z.string().trim().min(1).max(64).describe('The worker ID from dispatch_task.')
export const messageWorkerInput = z
  .object({
    workerId,
    text: z.string().trim().min(1).max(8000).describe('What to tell the worker.')
  })
  .strict()
export const stopWorkerInput = z.object({ workerId }).strict()
export const listWorkersInput = z
  .object({ status: workerStatusSchema.optional().describe('Only list workers in this state.') })
  .strict()
export const recallInput = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe(
        'A worker (w_…), event (ev_…), or batch (b_…) ID, or a continuation ID it returned.'
      )
  })
  .strict()
export type MessageWorkerInput = z.infer<typeof messageWorkerInput>
export type ListWorkersInput = z.infer<typeof listWorkersInput>
/** `started` means the message began a new turn; `queued` means it waits for the worker to start. */
export type MessageWorkerResult = { delivered: 'steered' | 'started' | 'queued' }
export type StopWorkerResult = { status: 'stopping' | 'cancelled' | 'already_idle' }

export type RouterToolHandlers = {
  dispatchTask(input: DispatchTaskInput): Promise<DispatchTaskResult>
  messageWorker(input: MessageWorkerInput): Promise<MessageWorkerResult>
  stopWorker(workerId: string): Promise<StopWorkerResult>
  listWorkers(input: ListWorkersInput): unknown
  recall(id: string): unknown
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
  const tool = <T extends z.ZodObject>(
    name: string,
    label: string,
    description: string,
    schema: T,
    run: (input: z.infer<T>) => unknown
  ): RouterTool => ({
    name,
    label,
    description,
    schema,
    async execute(args) {
      const parsed = schema.safeParse(args)
      if (!parsed.success)
        throw new RouterToolError('invalid_request', `The ${name} arguments are invalid.`)
      return JSON.stringify(await run(parsed.data))
    }
  })
  // Sorted by name so every engine sees the same tool order.
  return [
    tool(
      'dispatch_task',
      'Dispatch task',
      'Start a background worker (a Codex or Claude Code task in this project) for one piece of work. Returns immediately with the worker ID and whether it started or is queued behind other workers; the worker reports back in a later batch.',
      dispatchTaskInput,
      (input) => handlers.dispatchTask(input)
    ),
    tool(
      'list_workers',
      'List workers',
      "List this project's workers, newest first, with their goal, status, parent, and the start of their last report. Do not use it to wait for a worker: reports arrive on their own in a later batch, after your turn ends.",
      listWorkersInput,
      (input) => handlers.listWorkers(input)
    ),
    tool(
      'message_worker',
      'Message worker',
      'Send a follow-up to an existing worker instead of dispatching a new one. A running worker gets it in its current turn; an idle worker starts a new turn and reports again.',
      messageWorkerInput,
      (input) => handlers.messageWorker(input)
    ),
    tool(
      'recall',
      'Recall',
      'Read the full details behind an ID: a worker, an Inbox event (for text a batch truncated), or a batch. Long text returns a continuation ID.',
      recallInput,
      (input) => handlers.recall(input.id)
    ),
    tool(
      'stop_worker',
      'Stop worker',
      'Stop a running worker, or cancel one that is still queued. Use it only when the user asks or the work is no longer needed.',
      stopWorkerInput,
      (input) => handlers.stopWorker(input.workerId)
    )
  ]
}

export function toolErrorText(error: unknown): string {
  const failure =
    error instanceof RouterToolError
      ? { code: error.code, message: error.message }
      : { code: 'tool_failed', message: 'The tool call failed.' }
  return JSON.stringify({ error: failure })
}

export function toolJsonSchema(tool: RouterTool): Record<string, unknown> {
  const { $schema: _draft, ...schema } = z.toJSONSchema(tool.schema, {
    target: 'draft-7'
  }) as Record<string, unknown>
  return schema
}
