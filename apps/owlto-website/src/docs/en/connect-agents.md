---
title: Connect Claude Code, Codex, and Cursor to Owlto
navTitle: Connect coding agents
description: Which agents can run the Router and the workers, how to install and connect each one, how to set up the built-in Router engine, and how to choose worker permissions.
group: start
order: 2
updated: 2026-11-16
related: router-and-workers, quickstart, troubleshooting
footer: true
---

Owlto doesn't ship its own coding agent. Workers run in the agents you already use, with your own accounts. The Router can run in one of those agents or in Owlto's built-in engine.

## What each agent can do

| | Run workers | Run the Router |
| --- | --- | --- |
| Claude Code | Yes | Yes, with your Claude Code account |
| Codex | Yes | Yes, with your Codex account |
| Cursor | Yes | No |
| Owlto (built in) | No | Yes, with a model API key or a local endpoint you provide |

You need at least one connected agent for workers, plus one way to run the Router:

- **Claude Code or Codex**: one agent can run both the Router and the workers.
- **Only Cursor**: Cursor runs the workers, and the Router runs on the built-in engine. Cursor can't run the Router.

## Install an agent

Install the agent and sign in once in Terminal. If an agent is already installed and signed in, skip this step.

**Claude Code**

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Follow the prompts to sign in, then quit with `/exit`.

**Codex**

```bash
brew install --cask codex
codex
```

Sign in with your ChatGPT account. You can also sign in later from Owlto with **Sign in with ChatGPT**.

**Cursor**

```bash
curl https://cursor.com/install -fsS | bash
cursor-agent login
```

These commands come from each vendor's own install instructions, which can change. If one fails, use the **Installation guide** link on the agent's tab in Owlto.

## Connect an agent in Owlto

1. Open **Settings** with `⌘,` and choose **Agents**.
2. Pick the agent's tab: **Claude Code**, **Codex**, or **Cursor**.
3. Click **Connect**.

When it works, the tab shows the account you're signed in with. Owlto also reconnects your agents each time it starts, unless you clicked **Disconnect**.

To switch accounts, sign in with the other account in Terminal (`claude` for Claude Code, `cursor-agent login` for Cursor), then click **Reconnect**.

### How Owlto finds an agent

Owlto looks for each agent's command in your `PATH`, then in common install folders such as `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin`. For Codex it also checks the copy inside the Codex and ChatGPT apps. Owlto reads the `PATH` it was launched with; it doesn't read your shell profile.

If the agent lives somewhere else, click **Choose file** next to **Location** and pick the executable: `claude`, `codex`, or `cursor-agent`.

## Choose who runs the Router

Open **Settings → Router & Workers → Router** and pick a **Router engine**:

- **Claude Code** or **Codex**: the Router uses that agent and your account with it. The agent must be connected (and, for Codex, signed in).
- **Owlto (built in)**: the Router uses a model you configure. Choose a **Model provider** (Anthropic, OpenAI, Google, DeepSeek, OpenRouter, or a custom OpenAI-compatible endpoint), a **Model**, and an **API key**. The key is optional for local endpoints.

The first-run guide asks the same question (**Who runs the Router?**). If you skipped it, a notice above the message box tells you what's missing, for example **Choose a model for the Router** or **Connect Claude Code for the Router**.

The Router itself never edits files. Whichever engine runs it, it plans, dispatches workers, and reports. See [Router and workers](/docs/router-and-workers/).

## Set worker models and permissions

Open **Settings → Router & Workers → Workers** to set, for each agent, the default model, effort, and permission. Permissions decide what a worker may do before it has to ask you:

| Permission | What the worker can do |
| --- | --- |
| Read only | Read and search. Edits are not allowed. |
| Workspace access | Edit files in its task folder. Anything beyond that asks you first. This is the default. |
| Full access | Act on its own where the agent allows it. Exact behavior depends on the agent; Owlto shows a short description under each choice. |

**Highest worker permission** on the **Router** tab caps what the Router can grant any worker. The default is Workspace access.

To choose which agents a project uses, open the project's settings and go to **Coding agents**. Checked agents take tasks, top first. With none checked, any connected agent can. See [Run tasks across projects in parallel](/docs/parallel-tasks/).
