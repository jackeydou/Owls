---
title: Install Owlto on your Mac
navTitle: Install Owlto
description: System requirements, downloading the .dmg, update channels, and where Owlto keeps its files.
group: start
order: 1
updated: 2026-11-16
related: connect-agents, quickstart, troubleshooting
footer: true
---

## Requirements

- A Mac with Apple silicon (M1 or later). Owlto is built for Apple silicon only; there is no Intel, Windows, or Linux build.
- macOS 13 Ventura or later.
- At least one coding agent to run the workers: Claude Code, Codex, or Cursor. You install and sign in to it yourself. See [Connect coding agents](/docs/connect-agents/).
- `git`. Workers that edit code use git worktrees, so your projects should be git repositories with at least one commit. Owlto still works in folders without git, but workers then share one folder. See [Projects, Workspace, and worktrees](/docs/projects-and-worktrees/).

Owlto itself is free and open source under the GNU AGPL-3.0 license. The coding agents use your own accounts and plans and follow their own terms.

## Download and install

1. [Download Owlto.dmg](https://github.com/jackeydou/Owls/releases/latest/download/Owlto.dmg), the latest stable release. Older versions and beta builds are on the [Releases page](https://github.com/jackeydou/Owls/releases).
2. Open the `.dmg` and drag **Owlto** into your **Applications** folder.
3. Open Owlto from Applications or Launchpad.

The app is signed and notarized by Apple, so macOS opens it like any other downloaded app.

On first launch, Owlto connects to any agents it can find on your Mac. If the Router is not set up yet, a **Welcome to Owlto** guide appears in the new thread and asks who runs the Router. Continue with [Connect coding agents](/docs/connect-agents/).

## Updates

Owlto checks for updates about 30 seconds after launch and then every two hours. It downloads new versions in the background and installs them when you quit. When an update is ready, you can also choose **Restart to update**.

There are two channels, **Stable** and **Beta**. You get the channel of the build you installed: a beta build stays on beta. To switch, open **Settings → Updates** and change **Update channel**.

## Where Owlto keeps files

| Location | What is there |
| --- | --- |
| `~/.owlto` | App data: the database (`owlto.db`), settings, attachments, and thread data |
| `~/Owlto/Workspace` | The default Workspace folder for tasks that don't belong to a project |
| `~/Owlto/projects` | Repositories you clone from GitHub inside Owlto |
| `~/Owlto/worktrees` | The git worktrees workers use, one folder per worker |
| `~/Owlto/Notes` | Your notes, one Markdown file per note |

You can choose another Workspace folder in **Settings → Router & Workers → Workspace folder**. API keys you enter in Owlto (for the built-in Router engine or a GitHub token) are encrypted with the macOS keychain.

## Uninstall

Quit Owlto and drag it from Applications to the Trash. That leaves your data in place. To remove it too, delete `~/.owlto`, then check `~/Owlto` before deleting it: it holds your notes, cloned projects, and any worktrees with unmerged work.
