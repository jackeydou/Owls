import { z } from 'zod'

/**
 * In-app feedback becomes an issue in the product's public repository. These pure helpers are
 * shared by the main process (which posts the issue or opens the browser) and the renderer
 * (which previews what gets attached), so both agree on the issue's exact shape.
 */

/** The repository feedback is filed in: the product's public repository. */
export const FEEDBACK_REPOSITORY = { owner: 'jackeydou', name: 'Owls' } as const
/** Applied when the sender can label issues; GitHub silently drops it for everyone else. */
export const FEEDBACK_LABEL = 'feedback'
export const FEEDBACK_TITLE_MAX = 120
export const FEEDBACK_BODY_MAX = 8000
/** A title made from the body's first line keeps to this length. */
const DERIVED_TITLE_MAX = 80
/**
 * Browsers and GitHub accept URLs well past this, but GitHub's new-issue page starts failing
 * around 8 KB, so the prefilled body is cut to keep the whole URL under it.
 */
const ISSUE_URL_MAX = 7000

export const feedbackInputSchema = z.object({
  title: z.string().trim().max(FEEDBACK_TITLE_MAX),
  body: z.string().trim().min(1).max(FEEDBACK_BODY_MAX),
  includeDiagnostics: z.boolean()
})
export type FeedbackInput = z.infer<typeof feedbackInputSchema>

/** Facts about this install that help triage a report; nothing personal. */
export type FeedbackDiagnostics = {
  appVersion: string
  /** For example `macOS 15.1`. */
  os: string
  arch: string
  electron: string
}

export type FeedbackResult =
  /** Posted as the signed-in GitHub user. */
  | { kind: 'created'; number: number; url: string }
  /**
   * Opened GitHub's new-issue page, prefilled, for the user to submit there: they are not
   * connected, or their connection cannot file issues in the repository.
   */
  | { kind: 'browser'; reason: 'signed-out' | 'no-access' }
  /** GitHub could not be reached; nothing was sent or opened. */
  | { kind: 'failed' }

/** The user's title, or the body's first line when they left it empty. */
export function feedbackTitle(input: Pick<FeedbackInput, 'title' | 'body'>): string {
  const title = input.title.trim()
  if (title) return title
  const line = input.body.trim().split('\n')[0]?.trim() ?? ''
  return line.length > DERIVED_TITLE_MAX ? `${line.slice(0, DERIVED_TITLE_MAX - 1)}…` : line
}

/** One line for the dialog's preview and the issue's environment section. */
export function diagnosticsLine(diagnostics: FeedbackDiagnostics): string {
  return [
    `Owlto ${diagnostics.appVersion}`,
    diagnostics.os,
    diagnostics.arch,
    `Electron ${diagnostics.electron}`
  ].join(' · ')
}

/** The issue body: the user's words, then the environment when they chose to attach it. */
export function feedbackIssueBody(body: string, diagnostics: FeedbackDiagnostics | null): string {
  const parts = [body.trim()]
  if (diagnostics) parts.push(`**Environment:** ${diagnosticsLine(diagnostics)}`)
  parts.push('_Sent from Owlto feedback._')
  return parts.join('\n\n')
}

/** GitHub's new-issue page with the title, body, and label filled in. */
export function feedbackIssueUrl(title: string, body: string): string {
  const base = `https://github.com/${FEEDBACK_REPOSITORY.owner}/${FEEDBACK_REPOSITORY.name}/issues/new`
  const url = (text: string) =>
    `${base}?${new URLSearchParams({ title, body: text, labels: FEEDBACK_LABEL })}`
  let text = body
  let full = url(text)
  // Encoding grows unevenly (CJK triples), so trim until the encoded URL fits.
  while (full.length > ISSUE_URL_MAX && text.length > 0) {
    const over = full.length - ISSUE_URL_MAX
    text = text.slice(0, Math.max(0, text.length - Math.max(16, Math.ceil(over / 3))))
    full = url(`${text}\n\n…`)
  }
  return full
}
