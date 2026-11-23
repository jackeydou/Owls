import type { AcpAgent, AcpExtensions } from '../acp/agent.js'
import {
  type AskQuestion,
  askQuestionSchema,
  createPlanSchema,
  cursorMode,
  parseCursorModels,
  parseCursorStatus,
  planRequest,
  questionRequest,
  questionResponse
} from './normalize.js'

/** Cursor's own ACP methods: todos and subagent tasks it reports, questions and plans it asks. */
const cursorExtensions: AcpExtensions = {
  notification(view, session, method, params) {
    if (method === 'cursor/update_todos') return view.updateTodos(session, params)
    if (method === 'cursor/task') return view.task(session, params)
    return false
  },
  request(method, params, turnId, ask, cancelled) {
    if (method === 'cursor/ask_question') {
      const input: AskQuestion = askQuestionSchema.parse(params)
      return ask(questionRequest(input, turnId), {
        answer: (reply) =>
          reply.decision === 'accept'
            ? questionResponse(input, reply.answers ?? {})
            : { outcome: { outcome: 'skipped', reason: 'The user declined to answer.' } },
        cancelled
      })
    }
    if (method === 'cursor/create_plan') {
      const input = createPlanSchema.parse(params)
      return ask(planRequest(input, turnId), {
        answer: (reply) =>
          reply.decision === 'accept'
            ? { outcome: { outcome: 'accepted' } }
            : { outcome: { outcome: 'rejected', reason: 'The user rejected the plan.' } },
        cancelled
      })
    }
    return null
  }
}

/**
 * The Cursor CLI over ACP (`agent [--model id] acp`). The installer links both
 * `agent` and the older `cursor-agent` name; `agent` is generic, so the
 * Cursor-specific name is tried first.
 */
export const cursorAgent: AcpAgent = {
  provider: 'cursor',
  label: 'Cursor',
  codes: { notConnected: 'cursor_not_connected', disconnected: 'cursor_disconnected' },
  search: {
    names: ['cursor-agent', 'agent'],
    notInstalled: {
      code: 'cursor_not_installed',
      message: 'Cursor CLI was not found. Select your local Cursor agent executable in Settings.'
    }
  },
  executablePath: (settings) => settings.cursorExecutablePath,
  connectionEvent: (connection) => ({ type: 'cursor-connection', connection }),
  async probe(run) {
    const account = parseCursorStatus(
      await run(['status', '--format', 'json'], 20_000).catch(() => run(['status'], 20_000))
    )
    // The catalog needs a signed-in account; without one only the default is offered.
    const models =
      account.kind === 'signed-out'
        ? []
        : parseCursorModels(await run(['models'], 30_000).catch(() => ''))
    return { account, models }
  },
  args: (session) => [...(session.model ? ['--model', session.model] : []), 'acp'],
  authMethod: 'cursor_login',
  mode: cursorMode,
  extensions: cursorExtensions
}
