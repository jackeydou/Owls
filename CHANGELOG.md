# Changelog

Owls' public release history starts with the current codebase. Earlier
development history is intentionally not carried forward.

## Unreleased

### Highlights

### Changes

### Fixes

## 2026.11.1000-beta.1

### Highlights

- This beta starts with a fresh database: threads, projects, settings, and memories from earlier versions are not carried over.
- Each project can show an initial, an emoji, or an image as its icon, in a color you choose.
- App icons now share one consistent outline style.

### Changes

- Data: the local database tables no longer use a codex_ prefix. Existing threads, projects, settings, and memories are not carried over, so Owls starts as on a fresh install. (#61)
- Icons: every app icon now uses the IconMCP library with a consistent 1.25px outline, and New thread shows a plus. (#57)
- Projects: each project can show an initial, an emoji, or an image as its icon, in a color you choose, across the Projects sidebar, Settings, and the map. (#62)

### Fixes

- Menus: clicking a menu choice no longer leaves a focus ring on the button that opened it. (#56)

## 2026.11.900-beta.3

### Highlights

- Installing and updating Owls is much faster: the app now ships a few hundred files instead of about 36,000.
- The add-project menu items can be clicked on macOS.

### Changes

- macOS packaging: Keep JavaScript dependencies inside app.asar and stop shipping renderer-only and unused packages, cutting the bundle from about 36,000 files to a few hundred so installing and updating Owls is much faster. (#53)

### Fixes

- Projects: the add-project menu items can be clicked on macOS; the menu no longer sits under the sidebar's window drag region. (#54)

## 2026.11.900-beta.2

### Highlights

- Owls now updates itself: it checks in the background and installs on restart from Settings > Updates, with a stable or beta channel, and most updates download only what changed.
- Projects have their own settings for name, description, worktree branch and remote, branch cleanup, and extra worker instructions.
- The add button opens a menu to open a folder, clone a GitHub repository, or Quick start an empty project.
- Every sidebar resizes by dragging, and Projects move to a right-hand sidebar opened from the title bar.
- Owls now needs macOS 13 or later.

### Changes

- Electron: upgrade to Electron 45 and better-sqlite3 13; Owls now needs macOS 13 or later, and file pickers start from the home folder instead of Downloads. (#51)
- Sidebars: every sidebar resizes by dragging, sidebar actions highlight and show shortcuts only on hover, the logo row is gone, and Projects move to a right-hand sidebar opened from the title bar. Settings get a larger page title, 13px descriptions, and roomier rows. (#47)
- Updates: Owls checks for updates in the background and installs them on restart from Settings > Updates, with a stable or beta channel. Releases ship Sparkle binary delta patches so most updates download only what changed, falling back to the full ZIP. (#51)
- Projects: each project has its own settings for its name and description, the branch and remote its worktrees use, deleting pushed branches when a worker is removed, and extra instructions for workers, including code review and pull request preferences. (#50)
- Projects: the add button opens a menu to open a folder, clone a GitHub repository, or Quick start an empty project, with recent projects below. (#48)

### Fixes

## 2026.11.900-beta.1

### Highlights

- Owls is now a Router you talk to: it sends work to your locally installed Codex or Claude Code as workers, and each worker that changes code gets its own git worktree and branch, so several can work at once.
- Threads are global: start one with Command-N, send work to any project from it, and forward a message or a worker's result to another thread.
- Memory: Owls keeps your preferences and project knowledge from past threads, uses them in new ones, and lets you review, edit, and export them in Settings.
- Worker panels show the pull request and CI checks for a worker's branch.
- This beta starts fresh: data from Owls 2026.9.801 and earlier is not carried over, and it does not update itself.

### Changes

- Runtime: rebuild Owls around locally installed Codex with native account reuse, streaming tasks, approvals, and a fresh workspace database. (#15)
- Runtime: run tasks with your locally installed Claude Code CLI alongside Codex, with an agent picker, native session resume, approvals, and questions. (#16)
- Router: coordinate a project from one conversation with the built-in Owls Router, which dispatches Codex or Claude Code tasks and summarizes their reports, using a model and key you configure in Settings. (#19)
- Router: choose Codex as the Router engine, let the Router follow up with, stop, and list its workers, and stop waking the Router for follow-ups you run in a worker's own task. (#21)
- Router: keep Router messages and worker reports across restarts, offer to resend a batch interrupted by quitting, queue workers beyond the limit, and choose Claude Code as the Router engine. (#20)
- Router: workers that change code now each run in their own git worktree on an owls/<worker> branch, so several can work at once instead of taking turns in your checkout; removed tasks clean up their worktrees, and a worktree with uncommitted changes is kept until you discard it. (#23)
- Router: Owls now opens on your conversation with the Router instead of a task list. Workers appear as a tree behind it: a press of Cmd+J shows every project and worker on one map, with their details, approvals, and direct @ messages one click away. Older tasks stay stored but no longer appear. (#26)
- Router: the overview map now moves with the work. Cmd+J zooms the conversation into its project, dots flow along running branches, reports and your answers travel along the tree, and new workers grow out of their parent. Reduced motion turns all of it off. (#27)
- Router: workers now form a tree under the Router, with titles and parent links; a message to one worker goes straight to it without a Router model call, and workers can be stopped or removed directly. (#25)
- Appearance: Owls has a new sharp owl logo, and Settings lets you switch the Dock icon and in-app logo between the Line, Solid, and Brow styles. (#24)
- Compatibility: flags, the URL scheme, and plugin fallbacks from the app's earliest name are gone. (#34)
- Branding: every Pichu name is now Owls, including the app id, the URL scheme and the data folder. Data in ~/.pichu is not migrated, installed copies need a manual reinstall, and macOS permissions must be granted again. (#33)
- Router: first-run setup is now a guide that picks what runs the Router and its workers, and a thread that needs setup shows a note instead of a card. (#30)
- Router: the home screen is now a thread you write in. The input box is gone, Enter adds a line and Command-Enter sends, projects moved into an expanded sidebar that can hide completely, and the app opens on the editor even with no project. (#30)
- Router: you now reach everything through the Router. Old task entry points are gone, tasks made before the Router stay stored but hidden, every worker report reaches the Router, and the separate worker agent setting is merged into the default agent. (#28)
- Layout: the title bar is shorter, and Settings is more compact, with one control width and tighter rows. (#31)
- Router: the input no longer shows the note about opening only trusted projects. (#36)
- Settings: Settings now fills the window, with tabs on the left and one tab's details on the right, and its links open the tab that fixes the problem. (#36)
- Title bar: the chat title bar no longer shows the Router or project name. (#33)
- Storage: thread items are saved one at a time and load when a thread opens, and the database was reset, so existing local databases must be removed. (#38)
- Sidebar: each project now lists its active workers, and you can fold the list or open a worker from it. (#37)
- Threads: forward a message or a worker's result to another thread to start work from it, and continue on that worker's branch. (#38)
- Threads: threads are now global, you can start a new one with Command-N, and a thread can dispatch work to any project. (#38)
- Worker panels: see the pull request and CI checks for a worker's branch, connecting GitHub through the Owls GitHub app, gh CLI, or a personal access token. (#39)
- Data: the local database is now owls.db; existing owls-codex.db data is not carried over. (#42)
- Memory: Owls now sorts quiet threads into personal and project memories with your Claude Code or Codex, gives new threads the pinned and recent ones, lets the Router search the rest, and adds a Memory tab in Settings to review, edit, pin, delete, and export them. (#40)
- Memory: Dreaming now merges overlapping personal categories and rechecks project knowledge and lessons untouched for 90 days, and Owls archives expired memories and clears old deleted ones on its own each day. (#43)
- Workers: new worker worktrees now live in the visible ~/Owls/worktrees folder instead of the hidden ~/.owls/worktrees; existing worktrees stay where they are. (#44)

### Fixes

- Router: long conversations with the built-in Owls Router keep hitting the model provider's prompt cache instead of resending their full context on every request. (#22)
- Router: the Claude Code Router no longer fails to start workers when a dispatch leaves out optional fields. (#28)
- Router: the Codex Router now ends its turn after dispatching instead of polling for results, and sends one final reply. (#29)
- Title bar: the sidebar toggle works while the sidebar is hidden and stays in one place, lined up with the window controls. (#31)
- Router: writers in the same checkout now wait for each other across threads. (#38)
- Workers: Codex workers in a worktree can now commit to their branch without asking for approval; repository hooks and config stay read-only. (#44)

## 2026.9.801

### Highlights

- Fix a macOS startup crash caused by missing application dependencies.

### Changes

- Branding: use a static waving owl on the home screen and refresh the app icons. (#9)
- Releases: build the selected branch or tagged commit using its app version without requiring an existing tag for manual runs.

### Fixes

- Startup: include required runtime dependencies in macOS releases and reject incomplete app bundles before publishing. (#14)
- macOS packaging: size process and kernel file limits for large app bundles and verify runtime dependencies, signing, and notarization before publishing.
- macOS installers: reserve DMG capacity for signed bundle metadata to prevent out-of-space failures while creating the installer.

## 2026.9.800

### Highlights

- Pichu is now Owls, with existing data and integration identifiers preserved.
- Sign in with your OpenAI subscription and configure local or remote MCP servers.
- Explore token and message usage with daily heatmaps and model comparisons.
- Install signed, notarized macOS releases and choose stable or beta updates in the app.

### Changes

- Branding: rename the app and repository to Owls and refresh the app, home screen, README, and menu bar icons.
- Models: add OpenAI OAuth sign-in, subscription model selection, and GPT Image 2 access without a separate API key.
- Updates: distribute signed and notarized macOS releases through GitHub with in-app stable and beta updates.
- Customize: configure local stdio and remote MCP servers, including protocol-native OAuth support.
- Usage: add token and message analytics with daily heatmaps, model rankings, and bar or line charts.

### Fixes

- Terminals: prevent command polling from ending early when no other event-loop work is active.

## 2026.6.2400

### Highlights

- Initial public release of the Pichu desktop AI workspace.

### Changes

- Ship the current application, website, plugin system, local tooling, and
  documentation as the first version of Pichu.

### Fixes
