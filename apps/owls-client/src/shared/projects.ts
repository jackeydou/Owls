import { z } from 'zod'

/** A GitHub repository named by the user, and the URL to clone it from. */
export type GitHubRepoRef = { owner: string; repo: string; cloneUrl: string }

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/

function repoRef(owner: string, rawRepo: string, ssh: boolean): GitHubRepoRef | null {
  const repo = rawRepo.replace(/\.git$/, '')
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null
  return {
    owner,
    repo,
    cloneUrl: ssh
      ? `git@github.com:${owner}/${repo}.git`
      : `https://github.com/${owner}/${repo}.git`
  }
}

/**
 * Reads what a user pastes for a GitHub repository: a web or clone URL (with
 * or without a scheme, `.git`, or a deeper path such as `/tree/main`), an SSH
 * remote, or `owner/repo`. Null for anything that is not a github.com repository.
 */
export function parseGitHubRepo(input: string): GitHubRepoRef | null {
  const text = input.trim()
  if (!text) return null
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/\s]+)\/([^/\s]+?)\/?$/i.exec(text)
  if (ssh) return repoRef(ssh[1], ssh[2], true)
  if (/^[^/\s:]+\/[^/\s:]+$/.test(text) && !/^(?:www\.)?github\.com\//i.test(text)) {
    const [owner, repo] = text.split('/')
    return repoRef(owner, repo, false)
  }
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (!['https:', 'http:'].includes(url.protocol)) return null
  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return null
  const [owner, repo] = url.pathname.split('/').filter(Boolean)
  return owner && repo ? repoRef(owner, repo, false) : null
}

/** A folder name for a new project: one path segment, not hidden. */
export const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((name) => !/[/\\:\0]/.test(name) && !name.startsWith('.'), 'Invalid project name')

export const cloneProjectSchema = z.object({
  url: z.string().max(500),
  /** The folder the clone goes into; null for the default projects folder. */
  parent: z.string().max(4096).nullable()
})
export const createProjectSchema = z.object({
  name: projectNameSchema,
  /** The folder the project goes into; null for the default projects folder. */
  parent: z.string().max(4096).nullable()
})
export type CloneProject = z.infer<typeof cloneProjectSchema>
export type CreateProject = z.infer<typeof createProjectSchema>

/** A branch or remote-tracking ref such as `main` or `origin/main`; never an option to git. */
const gitRefName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]+(?<![/.])$/, 'Invalid branch name')
const gitRemoteName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^(?!-)[A-Za-z0-9._-]+$/, 'Invalid remote name')
/** Longest text kept for one block of project instructions. */
export const PROJECT_INSTRUCTIONS_LIMIT = 8000
const instructionText = z.string().max(PROJECT_INSTRUCTIONS_LIMIT)

/** How workers' git worktrees behave in one project. */
export const projectGitSettingsSchema = z.object({
  /** The ref new worktrees branch from, such as `origin/main`; null for the checkout's HEAD. */
  baseBranch: gitRefName.nullable(),
  /** Where workers push and pull requests are found; null for `origin`. */
  remote: gitRemoteName.nullable(),
  /**
   * When a worker is removed, also delete its local branch once every commit on it is on
   * the remote. Branches with commits found nowhere else are always kept.
   */
  deletePushedBranches: z.boolean()
})
/** Extra instructions the user gives every worker in one project. */
export const projectInstructionsSchema = z.object({
  general: instructionText,
  codeReview: instructionText,
  pullRequest: instructionText
})
export const projectSettingsSchema = z.object({
  /** What the project is, for the Router choosing where a task belongs. */
  description: z.string().max(500),
  git: projectGitSettingsSchema,
  instructions: projectInstructionsSchema
})
export type ProjectGitSettings = z.infer<typeof projectGitSettingsSchema>
export type ProjectInstructions = z.infer<typeof projectInstructionsSchema>
export type ProjectSettings = z.infer<typeof projectSettingsSchema>
export const defaultProjectSettings: ProjectSettings = {
  description: '',
  git: { baseBranch: null, remote: null, deletePushedBranches: false },
  instructions: { general: '', codeReview: '', pullRequest: '' }
}
/** The remote workers use when the project names none. */
export const DEFAULT_REMOTE = 'origin'

/** A project's name and settings, as the settings page saves them. */
export const saveProjectSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  settings: projectSettingsSchema
})
export type SaveProject = z.infer<typeof saveProjectSchema>
/** A project repository's local branches, remote-tracking branches, and remotes, sorted. */
export type ProjectGitRefs = { branches: string[]; remoteBranches: string[]; remotes: string[] }
