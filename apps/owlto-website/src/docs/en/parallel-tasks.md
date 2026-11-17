---
title: Run coding agents in parallel across projects
navTitle: Parallel tasks across projects
description: Send one request that spans several repositories, help the Router pick the right project and agent, and know the limits on how many workers run at once.
group: guides
order: 1
updated: 2026-11-16
related: projects-and-worktrees, router-and-workers, review-and-merge
---

One Router thread can dispatch workers to several projects at once. A typical case: an API change in one repository, followed by matching changes in the web app, the mobile app, and the docs.

## Before you begin

- Add every repository involved as a project. See [Your first task](/docs/quickstart/#step-1-add-your-project).
- Commit what the workers need to see. Each worker starts from committed files.

## Ask for work that spans projects

Mention each project with `@` and say what depends on what:

```text
Add an "invited_by" field to team invites.
1. @api-server: add the column, a migration, and expose it in GET /invites.
2. When that is done, @web-app and @mobile-app: show "Invited by" on the invite screen.
Use the API change as the contract for the clients.
```

The Router splits the request into tasks and sends each to a project. When the next step depends on a result, it waits for that worker's report before dispatching the follow-up. A follow-up worker can also start from the branch of the worker before it, so it builds on that work.

In a new thread, the first project you mention becomes the thread's default project. Tasks that name no project go to the default project, or to the Workspace when there is none. In an existing thread, a mentioned project is a hint the Router takes into account.

## Help the Router choose

Each project's settings shape how the Router uses it:

| Setting | Where | Effect |
| --- | --- | --- |
| Description | General | Helps the Router pick the right project for a task |
| Coding agents | Coding agents | Which agents and models take this project's tasks, top first |
| Start from branch | Git | Which branch new worktrees start from, for example `origin/main` instead of your current branch |
| Instructions | Instructions | General, code review, and pull request instructions added to every worker's prompt in this project |

You can also just say what you want: "Use Codex for the API task" or "Start from origin/main". The Router passes the agent, model, permission, and starting point to each worker it dispatches.

## Limits on parallel work

- Up to **4 workers** run at the same time. Up to 16 more wait in a queue and start as slots free up.
- Workers that edit code run side by side only when each gets its own worktree. That needs a git project with at least one commit, and **Run code-editing workers side by side** turned on in **Settings → Router & Workers** (it's on by default).
- Writers that share the project folder, for example in a folder without git, run one at a time per project. Read-only workers always run in parallel.

## Follow progress

- Press `⌘J` for the Overview map: every project and worker, with who is working, waiting, or done. In the map, `N` jumps to the next worker waiting on you.
- The Router reports when workers finish. Each report names the branch so you can review it. See [Review and merge worker results](/docs/review-and-merge/).

> **Note:** Separate branches keep workers from overwriting each other while they work. They don't prevent merge conflicts later: if two workers change the same lines, you resolve that when you merge.
