# Owlto Browser Tool

Codex and Cursor workers get one Owlto tool, `browser` (`owlto_browser` on
Codex), that drives a tab of Owlto's own browser by running a Playwright script.
The tab shows in the right sidebar's Browser panel (see
`docs/RFC_OWLTO_IN_APP_BROWSER.md`), where the user can watch it and take over. It is
served like the other worker tools: Codex as a dynamic tool and Cursor through
the local HTTP MCP server.

Each agent has a Browser switch in Settings → Router & Workers
(`settings.agents.codex.browser`, `settings.agents.cursor.browser`), on by
default. The switch applies at every permission, read only included: a
read-only worker runs scripts in the restricted mode below, which cannot read
or write local files, so browsing does not widen what it can change on disk.
Claude Code workers do not get it; they use Claude in Chrome
(`settings.agents['claude-code'].chrome`).
`workerBrowserEnabled` in `shared/agents.ts` is the one rule both the Router
and Settings read.

## Why a script, not browser MCP tools

A browser MCP server such as Playwright MCP adds twenty or more tools to every
turn, and each step (click, type, snapshot) is a model round trip. One tool
that takes code keeps the tool list small and lets an agent do several steps,
and return only what it needs, in one call. Agents already know the Playwright
API.

## Contract

Input: `code`, the body of an async function, and optional `timeoutMs`
(1 s to 5 min, default 60 s). In scope:

- `page`: the worker's own Playwright `Page`. The same worker keeps the same
  tab between calls; another worker gets another tab.
- `context`: a `BrowserContext` holding only this worker's tabs. All tabs share
  one persistent session (`<dataRoot>/browser/session`), so sign-ins persist and
  are shared by all workers.
- `console`: its output is returned after the result.

The reply is `Result: <JSON>` (or `Error: <message>`), then console lines, cut
at 20,000 characters. A script that returns bytes, such as
`await page.screenshot()`, gets the path of a PNG saved under
`<dataRoot>/browser/screenshots`; agents open it with their own image viewer.

## Runtime

Tabs are `WebContentsView`s that `main/browser/manager.ts` owns and lays over
the Browser panel's page area; a tab the panel does not show is parked off the
window so it keeps painting. Worker tabs attach `webContents.debugger`.

`main/browser/cdp-gate.ts` serves a loopback WebSocket that speaks enough
browser-level CDP for Playwright's `connectOverCDP`, relaying page sessions to
the tabs' debuggers. Each worker gets its own endpoint token, which lists and
opens only that worker's tabs; browser-wide commands are refused, and so is
script input while the user holds the tab. Owlto never opens Electron's
`--remote-debugging-port`, which would expose its own window. The gate starts
on first use.

`main/browser/runner.ts` starts `browser/host.js` as an Electron utility
process on first use. The host connects to the worker's gate endpoint and runs
one worker's scripts in order. While the user holds a worker's tab, a call
waits for the hand-back up to its timeout. Pages idle for 30 minutes close. A
script that outlives its timeout fails the call; if the host stops answering
15 s past that, the main process kills it, and the next call starts a new host.

Because the host runs in Owlto, not in the agent's process, a Codex
`workspace-write` sandbox (no network by default) does not apply to it.

## Run modes

- **Full access** workers run scripts as plain Node (`run-code.ts`): the
  script can reach `process` and the file system, like the agent itself.
- **Every other worker**, read-only included, runs restricted (`sandbox.ts`): a fresh `vm`
  context with string code generation off and no Node globals. `page` and
  `context` come through a membrane: host objects are prototype-less proxies
  that hide `constructor`, `__proto__`, `prototype` and `_` internals; plain
  data is copied into the context's realm; host promises and errors become the
  context's own; functions the script passes in are called with wrapped
  arguments. Calls that read or write local files are refused: `path`-like
  options (`path`, `recordHar`, `recordVideo`, `tracesDir`, `downloadsPath`,
  `executablePath`, `har`), `setInputFiles`, `routeFromHAR`, `tracing`,
  `video`, `saveAs`, `createReadStream`, `newCDPSession`, and launching or
  connecting browsers. Only `setTimeout` is provided as a timer.

`vm` is not a hardened sandbox, and a script that never yields still hangs the
host until the main process restarts it; the restricted mode keeps Node and the
file system out of reach of everything the script is given.
