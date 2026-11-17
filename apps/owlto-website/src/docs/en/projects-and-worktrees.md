---
title: Projects, the Workspace, and git worktrees in Owlto
navTitle: Projects, Workspace, and worktrees
description: How projects and the Workspace folder work, how each code-editing worker gets its own git worktree and branch, what is and isn't copied into it, and when workers share your checkout.
group: concepts
order: 2
updated: 2026-11-16
related: review-and-merge, parallel-tasks, troubleshooting
footer: true
---

## Terms

| Term | What it is |
| --- | --- |
| Project | A folder you added to Owlto, usually a git repository. A project can also be a subfolder of a larger repository. |
| Workspace | A folder for tasks that don't belong to a project. Default: `~/Owlto/Workspace`. |
| Checkout | Your own working copy of the project, the folder you added. |
| Worktree | A separate working folder of the same git repository, created for one worker under `~/Owlto/worktrees`. |
| Branch | Each worktree has its own branch, named `owlto/w_` plus eight characters. One worker, one worktree, one branch. |

## Projects

Add a project from the **Projects** sidebar: **Open project** (an existing folder), **Open GitHub project** (clone into `~/Owlto/projects`), or **Quick start** (a new empty git repository).

Cloning first uses your own git setup, so public repositories and SSH or keychain credentials work without a GitHub connection. If an https clone of a private repository fails, Owlto retries with your GitHub connection from **Settings → GitHub**.

Each project has its own settings: name, icon, color, a description that helps the Router pick it, the branch new worktrees start from, the remote, the coding agents it uses, and instructions added to every worker's prompt.

## The Workspace

Tasks that don't belong to a project, like a quick script or research, run in the Workspace folder. These tasks don't get worktrees; each one is told to use a subfolder named for the task. The Workspace is listed first under Projects and on the map.

When a folder directly inside the Workspace becomes a git repository, Owlto offers **Make project** to turn it into its own project. **Merge into Workspace** does the reverse. Change the folder in **Settings → Router & Workers → Workspace folder**.

## How a worker gets its own copy

When a worker that can edit files starts in a git project, Owlto runs `git worktree add` to create a new folder and a new branch for it:

```text
~/Owlto/worktrees/<repository>-<id>/<worker id>     branch: owlto/<worker id>
```

The branch starts from, in order: the parent worker's branch if the task builds on one; the project's **Start from branch** if set (a remote branch such as `origin/main` is fetched first); otherwise the current `HEAD` of your checkout. The Router can also start a task from the remote's default branch, for example for a separate pull request.

Because worktrees share the repository, the worker's commits show up as a normal branch in your checkout.

## What is and isn't in a worktree

A worktree contains **committed files only**. These are not there:

- uncommitted changes in your checkout
- ignored files, such as `.env` files and build output
- installed dependencies, such as `node_modules`

Workers are told this and install what they need. If a task depends on local secrets or uncommitted work, commit it first, tell the worker where to find it, or ask the Router to run that task in your checkout.

## When workers share your checkout

A worker works directly in the project folder, without a worktree, when:

- the folder isn't a git repository, or the repository has no commits yet
- the worker is read-only
- **Run code-editing workers side by side** is turned off in **Settings → Router & Workers**
- the Router chose your checkout on purpose, because the task needs your uncommitted changes or must merge a worker's branch into it

Writers that share the project folder run one at a time per project, so they don't edit the same files at once.

> **Important:** Worktrees isolate work in progress; they are not a security boundary. A worker runs as you, on your Mac, and with enough permission can reach files outside its worktree. Only open projects you trust: coding agents may follow instructions and settings stored inside a project.

## Separate branches and merge conflicts

Separate worktrees stop workers from overwriting each other's files while they work. They don't stop two branches from changing the same lines. That shows up as a conflict when you merge, and resolving it is up to you or a worker you ask. See [Review and merge worker results](/docs/review-and-merge/).
