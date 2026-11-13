import type { ProjectInstructions } from '../../shared/projects.js'

/** Bumped whenever the Router or Worker instructions change; recorded on each batch. */
export const ROUTER_PROMPT_VERSION = 13

export const WORKER_INSTRUCTIONS = `You are running as a worker for the Owls Router. Work only on the task you were given. Report to the Router with the Owls report tool: call it once when you finish, with status "done" when the task is complete, "blocked" when you cannot continue, or "needs_input" when the user must decide something. On a long task you may also call it with status "progress" to say how far you are; that does not end your turn. Write the summary for the coordinator, in at most a few sentences, about this task only. After the final report, end your turn with a short message for the user. If you have no Owls report tool, make your final message the report instead: only a JSON object with the fields status, summary, and artifacts.`

/** Appended to the worker instructions when the worker runs in the workspace folder, not a project. */
export const WORKSPACE_INSTRUCTIONS = `You are working in the user's general workspace folder, not in one of their projects. Other tasks share this folder, so put any files you create in a subfolder named for this task, unless the task names another place. Report the paths of files you created in your summary.`

/** Appended to the worker instructions when the worker runs in its own worktree (RFC 11.1). */
export function worktreeInstructions(branch: string, remote: string | null = null): string {
  const push = remote
    ? ` If the task asks you to push or open a pull request, push this branch to the ${remote} remote.`
    : ''
  return `You are working in a separate git worktree of this project, on branch ${branch}. It holds only committed files: uncommitted changes, ignored files, and installed dependencies from the user's checkout are not here, so install what you need. Stay on this branch and do not change other worktrees. Do not push unless the task asks you to. When the task is done, commit your changes to this branch and name the branch in your summary.${push}`
}

/**
 * The user's own instructions for workers in one project, in a fixed order; null
 * when there are none. They rank above the worker's defaults but never change
 * the report it must end with.
 */
export function projectInstructions(instructions: ProjectInstructions): string | null {
  const sections = [
    { text: instructions.general, heading: 'For every task in this project:' },
    { text: instructions.codeReview, heading: 'When the task is to review code:' },
    {
      text: instructions.pullRequest,
      heading: 'When the task is to open or update a pull request:'
    }
  ]
    .map(({ text, heading }) => ({ text: text.trim(), heading }))
    .filter(({ text }) => text)
  if (!sections.length) return null
  return [
    'The user set these instructions for this project. Follow them over your default habits where they differ, but still report to the Router as your worker instructions say.',
    ...sections.map(({ text, heading }) => `${heading}\n${text}`)
  ].join('\n\n')
}
