---
title: Troubleshooting Owlto
navTitle: Troubleshooting
description: Fixes for agents Owlto can't find, Router setup notices, workers that don't start or miss files, merge conflicts, an empty Pull requests page, and update problems.
group: reference
order: 2
updated: 2026-11-16
related: connect-agents, projects-and-worktrees, review-and-merge
footer: true
---

## Find your problem

| What you see | Go to |
| --- | --- |
| "Claude Code was not found", "Codex was not found", or "The Cursor CLI was not found" | [An agent was not found](#an-agent-was-not-found) |
| An agent shows **Not signed in** | [An agent is not signed in](#an-agent-is-not-signed-in) |
| "Choose a model for the Router" or "Connect … for the Router" | [The Router is not set up](#the-router-is-not-set-up) |
| "Connect a coding agent to run workers" | [No agent can run workers](#no-agent-can-run-workers) |
| Cursor is missing from the Router engine list | [Cursor can't run the Router](#cursor-can-t-run-the-router) |
| Workers wait instead of running | [Workers are queued or run one at a time](#workers-are-queued-or-run-one-at-a-time) |
| A worker can't find a file, a `.env`, or dependencies | [A worker is missing files](#a-worker-is-missing-files) |
| A worker's changes aren't in your checkout | [The changes aren't in my checkout](#the-changes-aren-t-in-my-checkout) |
| Git reports a conflict when you merge | [Merge conflicts between workers](#merge-conflicts-between-workers) |
| The Pull requests page is empty | [The Pull requests page is empty](#the-pull-requests-page-is-empty) |
| Disk space is filling up under `~/Owlto/worktrees` | [Old worktrees take up space](#old-worktrees-take-up-space) |

## An agent was not found

Owlto searches your `PATH` and common install folders such as `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin`. It doesn't read your shell profile, so a `PATH` change in `~/.zshrc` may not reach it.

1. In Terminal, check the agent is installed: `claude --version`, `codex --version`, or `cursor-agent --version`.
2. Find where it is: `which claude` (or `codex`, `cursor-agent`).
3. In **Settings → Agents**, open the agent's tab, click **Choose file** next to **Location**, and pick that file.
4. Click **Connect**.

## An agent is not signed in

- **Claude Code**: run `claude` in Terminal, sign in, quit with `/exit`, then click **Reconnect** in Owlto.
- **Codex**: click **Sign in with ChatGPT** on the Codex tab, or run `codex` in Terminal and sign in.
- **Cursor**: run `cursor-agent login` in Terminal, then click **Reconnect**.

An agent that is connected but signed out can't take tasks.

## The Router is not set up

The notice above the message box names what's missing:

- **Choose a model for the Router**: the built-in engine has no model. Open **Settings → Router & Workers → Router** and add a model provider, model, and API key, or a local OpenAI-compatible endpoint.
- **Connect Claude Code for the Router** or **Connect Codex for the Router**: the chosen engine's agent isn't connected. Connect it, or pick another engine. If another engine is ready, the notice offers to switch to it.

See [Connect coding agents](/docs/connect-agents/#choose-who-runs-the-router).

## No agent can run workers

"Connect a coding agent to run workers" means no worker agent is connected. Connect Claude Code, Codex, or Cursor in **Settings → Agents**. If a project lists specific agents under **Coding agents**, at least one of those must be connected.

## Cursor can't run the Router

This is expected. Cursor runs workers only. Use Claude Code, Codex, or the built-in engine for the Router.

## Workers are queued or run one at a time

- At most 4 workers run at once. Others wait in a queue and start as slots free up.
- Code-editing workers share the project folder, and so run one at a time, when the project isn't a git repository, has no commits yet, or **Run code-editing workers side by side** is off. Make an initial commit, or turn the setting back on in **Settings → Router & Workers**.

## A worker is missing files

Worktrees contain committed files only. Uncommitted changes, ignored files such as `.env`, and dependencies such as `node_modules` are not copied.

- Commit the files the worker needs, or
- tell the worker in your request how to set up (for example, "run pnpm install first; copy .env.example to .env"), or
- ask the Router to run the task in your checkout if it really needs your uncommitted work.

Project **Instructions** are a good place for setup steps every worker should follow.

## The changes aren't in my checkout

That's by design. Each code-editing worker commits to its own `owlto/w_…` branch. Merge the branch, or open a pull request. See [Review and merge worker results](/docs/review-and-merge/).

## Merge conflicts between workers

Separate branches don't prevent two workers from changing the same lines. Resolve the conflict in your editor, or ask the Router for a worker to resolve it. To avoid it, split work so tasks touch different files, or have the second task start from the first worker's branch.

## The Pull requests page is empty

- Connect GitHub in **Settings → GitHub**. With the Owlto GitHub app, install it on the repository too.
- The project's remote must be on github.com.
- Only PRs from your workers' branches, or linked in their reports, are listed.
- Check that **Pull requests page** is on in **Settings → GitHub**.

## Old worktrees take up space

Worktrees are removed when you remove a worker or delete its thread, not when a worker finishes. Remove finished workers, and use **Discard** on entries under **Kept worktrees** you no longer need. Discarding deletes uncommitted work in that worktree.

## Still stuck?

Choose **Help → Report an Issue…** in Owlto, or [open an issue on GitHub](https://github.com/jackeydou/Owls/issues). Issues are public: don't include passwords, tokens, private code, or other personal data.
