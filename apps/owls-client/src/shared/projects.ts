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
