import { z } from 'zod'
import {
  FEEDBACK_LABEL,
  FEEDBACK_REPOSITORY,
  type FeedbackDiagnostics,
  type FeedbackInput,
  type FeedbackResult,
  feedbackIssueBody,
  feedbackIssueUrl,
  feedbackTitle
} from '../../shared/feedback.js'
import type { GitHubHttp } from './auth.js'

const ISSUES_URL = `https://api.github.com/repos/${FEEDBACK_REPOSITORY.owner}/${FEEDBACK_REPOSITORY.name}/issues`
const REQUEST_TIMEOUT_MS = 15_000
const createdSchema = z.object({ number: z.number(), html_url: z.string().url() })

/** What sending feedback needs from the app; `GitHubAuth` provides the first two. */
export type FeedbackDeps = {
  /** The user's GitHub token, or null when they are not connected. */
  token(): Promise<string | null>
  /** GitHub rejected the token, so the user has to connect again. */
  invalidate(): void
  diagnostics(): FeedbackDiagnostics
  /** Opens an https URL in the user's browser. */
  openUrl(url: string): Promise<void>
}

/**
 * Files feedback as an issue. With a GitHub connection it posts as the user, so the shipped app
 * holds no token of its own. Without one, or when the connection cannot file issues there (a
 * GitHub App or fine-grained token that does not cover the repository), it opens GitHub's
 * new-issue page prefilled, and the user submits it in their browser.
 */
export class FeedbackSender {
  constructor(
    private readonly deps: FeedbackDeps,
    private readonly http: GitHubHttp = fetch
  ) {}

  diagnostics(): FeedbackDiagnostics {
    return this.deps.diagnostics()
  }

  async send(input: FeedbackInput): Promise<FeedbackResult> {
    const title = feedbackTitle(input)
    const body = feedbackIssueBody(input.body, input.includeDiagnostics ? this.diagnostics() : null)
    const token = await this.deps.token().catch(() => null)
    if (!token) return this.openInBrowser(title, body, 'signed-out')
    let response: Response
    try {
      response = await this.http(ISSUES_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({ title, body, labels: [FEEDBACK_LABEL] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch {
      return { kind: 'failed' }
    }
    if (response.status === 401) {
      this.deps.invalidate()
      return this.openInBrowser(title, body, 'signed-out')
    }
    // 403: the token lacks issue access (or is rate limited); 404: it cannot see the
    // repository; 410: issues are off; 422: GitHub refused the fields as this user.
    if ([403, 404, 410, 422].includes(response.status))
      return this.openInBrowser(title, body, 'no-access')
    if (!response.ok) return { kind: 'failed' }
    const created = createdSchema.safeParse(await response.json().catch(() => null))
    if (!created.success) return { kind: 'failed' }
    return { kind: 'created', number: created.data.number, url: created.data.html_url }
  }

  private async openInBrowser(
    title: string,
    body: string,
    reason: Extract<FeedbackResult, { kind: 'browser' }>['reason']
  ): Promise<FeedbackResult> {
    try {
      await this.deps.openUrl(feedbackIssueUrl(title, body))
    } catch {
      return { kind: 'failed' }
    }
    return { kind: 'browser', reason }
  }
}
