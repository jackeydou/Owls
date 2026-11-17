---
title: "Quickstart: your first task in Owlto"
navTitle: Your first task
description: Walk one request from start to finish. Add a project, ask the Router, answer approvals, review each worker's changes, merge its branch, and clean up.
group: start
order: 3
updated: 2026-11-16
related: review-and-merge, steer-workers, projects-and-worktrees
footer: true
---

This walkthrough takes about ten minutes plus the time your agents spend on the work. By the end you will have asked the Router for a change, watched two workers do it on separate branches, and merged the result.

## Before you begin

- Owlto is installed. See [Install Owlto](/docs/install/).
- At least one agent is connected and the Router is set up. See [Connect coding agents](/docs/connect-agents/).
- You have a git repository with at least one commit, and everything you want the workers to see is committed. Workers start from committed files only.

Pick a small, low-risk change for your first run, in a repository where a mistake is cheap.

## Step 1: Add your project

Click the add button in the **Projects** sidebar and choose one of:

- **Open project**: an existing folder on your Mac (`⌘O` also works).
- **Open GitHub project**: clones a repository into `~/Owlto/projects`. Private repositories may need a GitHub connection in **Settings → GitHub**.
- **Quick start**: a new empty project, set up as a git repository so workers can use worktrees.

The project now appears in the sidebar and on the Overview map.

## Step 2: Ask the Router

1. Press `⌘N` to start a new thread.
2. Type `@` and pick your project. In a new thread, the first project you mention becomes the thread's default project.
3. Describe the work. Two independent changes show parallel work well, for example:

```text
Two small tasks in this project:
1. Add a "Development" section to README.md that explains how to install
   dependencies and run the tests.
2. Find the test runner config and add a script that runs the tests in watch mode.
Use one worker per task.
```

4. Press `⌘↵` to send. In the thread's message box, `Enter` adds a new line.

## Step 3: Watch the workers start

The Router replies with what it started and ends its turn. Each worker appears as a card in the thread and on the Overview map (`⌘J`). Workers run in the background, and the Router reports back on its own when they finish, so you don't need to keep the window open on the thread.

Each worker that edits code gets its own git worktree on a branch named `owlto/w_` plus eight characters, for example `owlto/w_1a2b3c4d`. Your own checkout is not touched.

## Step 4: Answer approvals

When a worker wants to do something its permission doesn't cover, such as running a command outside its folder, the request waits in a tray above the message box: "*Agent* needs you". It also shows on the worker's card and in the worker's own conversation.

- **Allow once** lets it do this one thing.
- **Decline** refuses. The worker carries on without it or reports that it is blocked.

There is no "always allow" button. To ask less often, raise the worker's permission in **Settings → Router & Workers → Workers**. See [Steer workers and answer approvals](/docs/steer-workers/).

## Step 5: Check in on a worker

Click a worker card to open its panel. You see its conversation: what it read, ran, and changed. Type in the panel's message box to talk to that worker directly. If it is busy, your message waits in a queue until its turn ends, or you can steer it into the running turn.

## Step 6: Review the changes

When a worker has changed files, its panel header shows the added and removed line counts. Click them to open the file changes: each changed file with its diff. Click again to go back to the conversation.

To look closer, use **Open in** to open the worker's folder in your editor or terminal. For a worktree worker, that is the worktree, not your checkout.

## Step 7: Merge the result

When the workers finish, the Router sums up what changed and names each branch. Owlto does not merge for you. Pick one of these:

- **Merge locally.** In your own checkout, run:

```bash
git merge owlto/w_1a2b3c4d
```

- **Open a pull request.** Ask the Router, for example "Push the README branch and open a pull request." The worker pushes with your git credentials and opens the PR with whatever tools its agent has, such as the `gh` CLI. The PR then shows on the **Pull requests** page if GitHub is connected.
- **Ask the Router to merge it into your checkout.** The Router can send a worker to work directly in your checkout to merge a branch. Commit your own changes first.

If two branches touched the same lines, git reports a conflict when you merge the second one. Resolve it as you would any merge conflict, or ask the Router for a worker to do it. See [Review and merge worker results](/docs/review-and-merge/).

## Step 8: Clean up

Open a finished worker and choose **Remove worker**, or delete the whole thread. Owlto removes a worktree with no uncommitted changes and deletes a branch whose commits are already in your checkout. Branches with unmerged commits are kept, and so is any worktree with uncommitted changes. Kept worktrees are listed under **Kept worktrees**, where **Discard** deletes one for good.

## Next steps

- [Run tasks across projects in parallel](/docs/parallel-tasks/): one request that spans several repositories.
- [Router and workers](/docs/router-and-workers/): what each role can and can't do.
- [Troubleshooting](/docs/troubleshooting/): if a step above didn't go as described.
