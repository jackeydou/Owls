import { z } from 'zod'
import {
  AUTOMATION_INSTRUCTIONS_LIMIT,
  AUTOMATION_NAME_LIMIT,
  type Automation,
  automationScheduleInput,
  describeSchedule
} from '../../shared/automations.js'
import { defineTool, type RouterTool } from '../router/tools.js'
import { type WorkerTool, workerTool } from '../router/worker-tools.js'

const name = z
  .string()
  .trim()
  .min(1)
  .max(AUTOMATION_NAME_LIMIT)
  .describe("Short name the user sees in the Automation list, in the user's language.")
const instructions = z
  .string()
  .trim()
  .min(1)
  .max(AUTOMATION_INSTRUCTIONS_LIMIT)
  .describe(
    'What to do on each run, complete enough to act on without this conversation: the goal, where to look, and what to report.'
  )
const automationId = z.string().trim().min(1).max(64).describe('The automation ID (au_…).')

export const routerCreateAutomationInput = z
  .object({
    name,
    instructions,
    schedule: automationScheduleInput,
    workerId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe(
        'Send each run to this worker as a follow-up instead of to you. Use it when the same worker should keep checking its own work, such as a pull request it opened.'
      )
  })
  .strict()
export const workerCreateAutomationInput = z
  .object({
    name,
    instructions,
    schedule: automationScheduleInput,
    wake: z
      .enum(['me', 'router'])
      .optional()
      .describe(
        'Who each run wakes: me (you, as a follow-up message, the default) or router (the coordinator, which may dispatch new work).'
      )
  })
  .strict()
export const deleteAutomationInput = z.object({ automationId }).strict()
export const updateAutomationInput = z
  .object({
    automationId,
    name: name.optional(),
    instructions: instructions
      .optional()
      .describe('The full new instructions, replacing the old ones. Leave out to keep them.'),
    schedule: automationScheduleInput
      .optional()
      .describe('The new schedule. Leave out to keep it.'),
    enabled: z
      .boolean()
      .optional()
      .describe('false pauses the automation, true resumes it. Leave out to keep it as it is.')
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.instructions !== undefined ||
      input.schedule !== undefined ||
      input.enabled !== undefined,
    { message: 'Change at least one of name, instructions, schedule, or enabled.' }
  )
export type UpdateAutomationInput = z.infer<typeof updateAutomationInput>
const listAutomationsInput = z.object({}).strict()
export type RouterCreateAutomationInput = z.infer<typeof routerCreateAutomationInput>
export type WorkerCreateAutomationInput = z.infer<typeof workerCreateAutomationInput>

/** How an automation reads in a tool result. */
export function describeAutomation(automation: Automation) {
  return {
    automationId: automation.id,
    name: automation.name,
    schedule: describeSchedule(automation.schedule),
    wakes: automation.target.kind === 'worker' ? `worker ${automation.target.workerId}` : 'router',
    enabled: automation.enabled,
    nextRunAt: automation.nextRunAt,
    lastRun: automation.lastRun
      ? { at: automation.lastRun.at, status: automation.lastRun.status }
      : null,
    instructions:
      automation.instructions.length > 300
        ? `${automation.instructions.slice(0, 300)}…`
        : automation.instructions
  }
}

const CREATE_DESCRIPTION =
  "Create an automation: a task Owlto starts again on a schedule (hourly, daily, weekdays, weekly, or monthly, in the user's local time) while the app is open. Create one only when the user asks for recurring or later work, and tell them the schedule you chose. Runs missed while the app was closed run once at the next start."
const UPDATE_DESCRIPTION =
  "Change one of this thread's automations: its name, instructions, schedule, or whether it is paused. Fields you leave out stay as they are; who each run wakes cannot change. Use it when the user asks to change, pause, or resume recurring work instead of deleting and recreating it."
const LIST_DESCRIPTION = "List this thread's automations with their schedule and next run."
const DELETE_DESCRIPTION =
  "Delete one of this thread's automations. Use it when the user asks, or when the recurring work is clearly finished."

export type AutomationToolHandlers<Create> = {
  create(input: Create): unknown
  list(): unknown
  update(input: UpdateAutomationInput): unknown
  remove(automationId: string): unknown
}

/** The Router's automation tools, sorted by name like the other Router tools. */
export function routerAutomationTools(
  handlers: AutomationToolHandlers<RouterCreateAutomationInput>
): RouterTool[] {
  return [
    defineTool(
      'create_automation',
      'Create automation',
      `${CREATE_DESCRIPTION} Each run arrives in this thread as an automation_run event, or goes to the worker you name.`,
      routerCreateAutomationInput,
      (input) => handlers.create(input)
    ),
    defineTool(
      'delete_automation',
      'Delete automation',
      DELETE_DESCRIPTION,
      deleteAutomationInput,
      (input) => handlers.remove(input.automationId)
    ),
    defineTool('list_automations', 'List automations', LIST_DESCRIPTION, listAutomationsInput, () =>
      handlers.list()
    ),
    defineTool(
      'update_automation',
      'Update automation',
      UPDATE_DESCRIPTION,
      updateAutomationInput,
      (input) => handlers.update(input)
    )
  ]
}

/** A worker's automation tools. Runs come back to this worker unless it asks for the Router. */
export function workerAutomationTools(
  handlers: AutomationToolHandlers<WorkerCreateAutomationInput>
): WorkerTool[] {
  return [
    workerTool(
      'create_automation',
      `${CREATE_DESCRIPTION} Use it for follow-ups you should do later, such as checking CI or review comments on a pull request you opened; each run reaches you as a new message.`,
      workerCreateAutomationInput,
      (input) => handlers.create(input)
    ),
    workerTool('delete_automation', DELETE_DESCRIPTION, deleteAutomationInput, (input) =>
      handlers.remove(input.automationId)
    ),
    workerTool('list_automations', LIST_DESCRIPTION, listAutomationsInput, () => handlers.list()),
    workerTool('update_automation', UPDATE_DESCRIPTION, updateAutomationInput, (input) =>
      handlers.update(input)
    )
  ]
}
