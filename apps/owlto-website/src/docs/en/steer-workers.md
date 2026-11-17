---
title: Steer workers and answer approval requests
navTitle: Steer workers and approvals
description: Message a worker directly, queue or steer messages while it works, answer permission requests with Allow once or Decline, and stop or remove workers.
group: guides
order: 2
updated: 2026-11-16
related: router-and-workers, quickstart, shortcuts
---

The Router handles most of the back-and-forth, but you can talk to any worker yourself, and you decide every request that goes beyond a worker's permission.

## Talk to a worker directly

There are two ways:

- **From the thread**: type `@` and pick the worker. The message box shows which worker you're addressing, and the message goes straight to that worker, not through the Router. Press `Backspace` in an empty message box to address the Router again.
- **From the worker panel**: click the worker card and type in the panel's message box. Press `Enter` to send and `Shift+Enter` for a new line.

Either way, the Router sees your message the next time it reviews the thread. Messages can include Markdown, pasted images, and up to 8 files of 20 MB each.

## Send messages while a worker is busy

When a worker is in the middle of a turn, the send button changes to **Add to the queue**. Queued messages are sent when the turn ends. For each queued message you can also:

- **Steer** (Claude Code and Codex): add the message to the running turn so the worker picks it up right away.
- **Interrupt & send** (Cursor): stop the current turn and start a new one with your message.
- **Send now**, when the worker is idle.
- **Remove from the queue**.

Stopping a worker clears its queue.

## Answer approval requests

A worker asks before doing anything its permission doesn't allow. The request appears in three places:

- A tray above the thread's message box, "*Agent* needs you", with **View context** and a count of other waiting requests.
- The worker's own conversation.
- The worker's card on the Overview map. Press `N` on the map to jump to the next worker waiting on you.

For a permission request, choose **Allow once** or **Decline**. For a question or a proposed plan, choose **Continue** or **Cancel**. The Router can't approve anything for you.

There is no "always allow" option. To get fewer requests, raise the agent's permission in **Settings → Router & Workers → Workers**:

- **Read only**: the worker can read and search.
- **Workspace access** (default): the worker can edit files in its task folder and asks before going further.
- **Full access**: the worker acts on its own where its agent allows it.

## Stop or remove a worker

- **Stop worker** ends the current turn. The worktree and branch stay, so you can review what it did or send it a new message.
- **Remove worker** removes it from the thread and cleans up its worktree. Commits on its branch are kept, and so is a worktree with uncommitted changes. See [Review and merge worker results](/docs/review-and-merge/#clean-up-worktrees-and-branches).
