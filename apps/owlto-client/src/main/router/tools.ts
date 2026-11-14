import { z } from 'zod'
import { permissionSchema, providerSchema } from '../../shared/app.js'
import { workerStatusSchema, worktreeBaseSchema } from '../../shared/router.js'
import { type SearchMemoryInput, searchMemoryInput } from '../memory/search-input.js'

/** Model-facing error codes. Messages are short English sentences without paths or secrets. */
export type RouterToolErrorCode =
  | 'invalid_request'
  | 'project_required'
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

/** The `project` value that sends a task to the workspace folder instead of a project. */
export const WORKSPACE_PROJECT = 'workspace'

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
    project: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        `The project to work in, by name or ID, or "${WORKSPACE_PROJECT}" for the user's workspace folder. Omit to use the parent's project, else the thread's default project, else the workspace.`
      ),
    context: z
      .string()
      .max(8000)
      .optional()
      .describe('Background the worker needs that is not in its working folder.'),
    provider: providerSchema
      .optional()
      .describe('Coding agent to run the task. Omit to use the default agent.'),
    permission: permissionSchema
      .optional()
      .describe('Access the worker needs. Omit to use the default.'),
    workspace: z
      .enum(['worktree', 'checkout'])
      .optional()
      .describe(
        "Where a worker that can write runs. Omit for its own git worktree; use checkout only when it must work in the user's checkout."
      ),
    base: worktreeBaseSchema
      .optional()
      .describe(
        "What a worktree starts from: head (the user's current branch, the default), default-branch (the remote default branch), or parent (the parent worker's branch)."
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
  /** Present only while memory is on; the tool is left out otherwise. */
  searchMemory?: (input: SearchMemoryInput) => unknown
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

/** Wraps a handler as a RouterTool that validates its arguments first. */
export function defineTool<T extends z.ZodObject>(
  name: string,
  label: string,
  description: string,
  schema: T,
  run: (input: z.infer<T>) => unknown
): RouterTool {
  return {
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
  }
}

export function routerTools(handlers: RouterToolHandlers): RouterTool[] {
  const tool = defineTool
  // Sorted by name so every engine sees the same tool order.
  return [
    tool(
      'dispatch_task',
      'Dispatch task',
      "Start a background worker (a Codex or Claude Code task in one of the user's projects) for one piece of work. Returns immediately with the worker ID and whether it started or is queued behind other workers; the worker reports back in a later batch.",
      dispatchTaskInput,
      (input) => handlers.dispatchTask(input)
    ),
    tool(
      'list_workers',
      'List workers',
      "List this thread's workers, newest first, with their project, goal, status, parent, and the start of their last report. Do not use it to wait for a worker: reports arrive on their own in a later batch, after your turn ends.",
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
    ...(handlers.searchMemory
      ? [
          tool(
            'search_memory',
            'Search memory',
            "Search memories Owlto saved from the user's earlier threads: personal memories by category, and project memories by project and kind (rule, decision, knowledge, lesson, status). Use it before asking the user something they may have said before, and to find what to pass a worker in context. Returns active memories, best keyword match first.",
            searchMemoryInput,
            handlers.searchMemory
          )
        ]
      : []),
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
