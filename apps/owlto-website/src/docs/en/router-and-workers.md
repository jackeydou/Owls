---
title: How the Router and workers divide the work
navTitle: Router and workers
description: What the Router does and never does, what a worker is, which agents can fill each role, how Owlto picks an agent and model for each task, and the permissions that apply.
group: concepts
order: 1
updated: 2026-11-16
related: connect-agents, projects-and-worktrees, steer-workers
footer: true
---

Owlto has two roles. The **Router** is the one you talk to. **Workers** do the work. Keeping them separate means you can read one conversation while several agents change code.

## The Router

The Router turns your request into tasks, sends each task to a worker, keeps track of them, and sums up the results. It can:

- dispatch a task to a worker, choosing the project, agent, model, permission, and starting branch
- list the workers in the thread, message one, or stop one
- remember things across threads and search that memory, when memory is turned on
- create and manage automations

The Router never does the work itself. It has no tools to edit files or run commands, whichever engine runs it, and it can't approve requests on your behalf.

The Router runs in Claude Code, Codex, or Owlto's built-in engine, which uses a model API key or a local endpoint you provide. Cursor can't run the Router. You choose in **Settings → Router & Workers → Router**. See [Connect coding agents](/docs/connect-agents/#choose-who-runs-the-router).

Workers run in the background. After dispatching, the Router tells you what it started and ends its turn. When a worker finishes, the Router reads its report and either dispatches the next step or reports to you.

## Workers

A worker is one task running in one coding agent on your Mac: Claude Code, Codex, or Cursor. Each worker has:

- its own conversation, which you can open and reply to
- a folder: its own git worktree on an `owlto/w_…` branch, or the project folder itself (see [Projects, Workspace, and worktrees](/docs/projects-and-worktrees/))
- a permission: read only, workspace access, or full access
- a report it writes when it finishes, including the branch it committed to

Workers in the same thread can work in different projects. A follow-up worker can start from the branch of the worker before it.

## How a worker's agent and model are chosen

For each task, Owlto picks:

1. **The agent** the Router asked for. If it named none, the project's first checked agent that is connected. If the project has no agents checked, any connected agent.
2. **The model** the Router asked for. Otherwise the project's first model for that agent, or the agent's default from **Settings → Router & Workers → Workers**.
3. **The permission** the Router asked for, capped by **Highest worker permission**. Otherwise the agent's default permission.

The Router names an agent or model only when you ask for one or the task clearly suits another of the project's choices. To steer it, say so in your request ("use Claude Code for the tests") or set the project's **Coding agents**.

## Roles at a glance

| | Router | Worker |
| --- | --- | --- |
| Who you talk to | Always | When you open it or mention it with `@` |
| Edits files and runs commands | Never | Yes, within its permission |
| Runs in | Claude Code, Codex, or Owlto (built in) | Claude Code, Codex, or Cursor |
| Approvals | Can't approve anything for you | Asks you when an action goes beyond its permission |
| Output | Plans and summaries | Commits on its branch, and a report |
