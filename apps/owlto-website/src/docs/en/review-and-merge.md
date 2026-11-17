---
title: Review and merge coding agent changes
navTitle: Review and merge results
description: Read a worker's diff, open its worktree in your editor, merge its branch or open a pull request, follow PR status in Owlto, and clean up worktrees and branches.
group: guides
order: 3
updated: 2026-11-16
related: projects-and-worktrees, quickstart, troubleshooting
footer: true
---

Workers commit their work to their own branches. Owlto shows you what changed, but merging is always your decision, made with git or a pull request.

## What Owlto does and what you do

| Step | Who does it |
| --- | --- |
| Create a worktree and an `owlto/w_…` branch for each code-editing worker | Owlto |
| Make the changes and commit them to that branch | The worker |
| Push the branch or open a pull request | The worker, only when the task asks for it |
| Review the diff | You, in Owlto or your editor |
| Merge the branch or the pull request | You, or a worker you ask to do it |
| Resolve merge conflicts | You, or a worker you ask to do it |
| Remove worktrees and merged branches | Owlto, when you remove the worker or delete the thread |

## Read the diff

Open the worker's panel. When it has changed files, the header shows its added and removed line counts. Click them to see each changed file with its diff, and click again to return to the conversation.

The worker's final report comes first in its conversation and names its branch.

## Open the work in your own tools

Use **Open in** in the worker panel to open the worker's folder in an installed editor or terminal, such as VS Code, Cursor, Zed, Xcode, a JetBrains IDE, Finder, Terminal, iTerm, Ghostty, or Warp. Owlto lists only the apps it finds on your Mac.

For a worktree worker, this opens the worktree under `~/Owlto/worktrees`, so you can run the tests or the app on the worker's branch without touching your checkout. Remember that the worktree has only committed files: install dependencies there before running anything.

## Merge a branch

Because every worktree belongs to the same repository, the worker's branch is already visible in your checkout. Merge it like any local branch:

```bash
git switch main
git merge owlto/w_1a2b3c4d
```

Or ask the Router to do it: "Merge owlto/w_1a2b3c4d into my checkout." It sends a worker to work directly in your checkout. Commit or set aside your own changes first.

If two workers changed the same lines, the second merge stops with a conflict. Resolve it in your editor, or ask the Router for a worker to resolve it.

## Open a pull request

Ask for it in the request ("…then push the branch and open a pull request") or afterwards. The worker pushes to the project's remote using the git credentials on your Mac, and opens the PR with its own tools, such as the `gh` CLI. To push to a different remote, set **Remote** in the project's **Git** settings. Add your team's conventions under **Pull request preferences** in the project's **Instructions**.

To make a separate PR start from the remote default branch instead of your current branch, say so ("start from origin/main"), or set **Start from branch** in the project's Git settings.

## Follow pull requests in Owlto

The **Pull requests** page lists the PRs your workers opened, with state (open, draft, merged, closed), merge conflicts, review decision, check status, and recent comments. Filter by merge state, checks, or project, and sort by **Needs attention**, **Recently updated**, **Newest**, or **Oldest**. It refreshes every minute.

It needs:

- A GitHub connection in **Settings → GitHub**, using the Owlto GitHub app, the `gh` CLI, or a personal access token. With the GitHub app, the app must also be installed on the repository.
- A project remote on github.com.

With **Auto follow-up** on (the default), Owlto watches your workers' open PRs and sends actionable events, such as a merge conflict, back to the worker that opened the PR, at most 8 times per PR per day. You can turn the page off with **Pull requests page** in **Settings → GitHub**.

## Clean up worktrees and branches

Worktrees stay until you remove the worker or delete the thread, so you can come back to them. When you do:

- A worktree with no uncommitted changes is removed. One with uncommitted or untracked files is kept and listed under **Kept worktrees**. **Discard** deletes it for good.
- The branch is deleted only if it has no new commits or its commits are already in your checkout. Otherwise it is kept. Turn on **Delete pushed branches** in the project's Git settings to also delete branches that are fully pushed.

Owlto also tidies stale worktree entries when it starts.
