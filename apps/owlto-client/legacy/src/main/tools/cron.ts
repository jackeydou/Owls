import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import { createCronJob } from '../cron/cron-scheduler.js'

const createCronJobSchema = Type.Object({
  name: Type.String({
    description: 'Human-readable name for the scheduled task.'
  }),
  schedule: Type.String({
    description:
      'Cron expression to run on, for example "0 9 * * *" for daily at 9am or "*/30 * * * *" for every 30 minutes.'
  }),
  prompt: Type.String({
    description: 'The task prompt that should be sent to the agent every time this cron job fires.'
  })
})

function createCronJobTool(cwd: string): AgentTool<typeof createCronJobSchema> {
  return {
    name: 'createCronJob',
    label: 'Create Cron Job',
    description:
      'Create a recurring cron job that triggers the agent with a saved task prompt. ' +
      'Choose the schedule and prompt based on the user request. The job runs in the session base working directory.',
    parameters: createCronJobSchema,
    async execute(_toolCallId, params) {
      const job = createCronJob({
        ...params,
        cwd
      })
      return {
        content: [
          {
            type: 'text',
            text: `Created cron job "${job.name}" with schedule "${job.schedule}".`
          }
        ],
        details: job
      }
    }
  }
}

export { createCronJobTool }
