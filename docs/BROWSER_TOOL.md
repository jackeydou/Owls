# Owlto Browser Tool

Codex and Cursor workers get one Owlto tool, `browser` (`owlto_browser` on
Codex), that drives a real Chrome window by running a Playwright script. It is
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
- `context`: the `BrowserContext` of Owlto's persistent Chrome profile
  (`<dataRoot>/browser/profile`), shared by all workers, so sign-ins persist.
- `console`: its output is returned after the result.

The reply is `Result: <JSON>` (or `Error: <message>`), then console lines, cut
at 20,000 characters. A script that returns bytes, such as
`await page.screenshot()`, gets the path of a PNG saved under
`<dataRoot>/browser/screenshots`; agents open it with their own image viewer.

## Runtime

`main/browser/runner.ts` starts `browser/host.js` as an Electron utility
process on first use. The host launches the installed Google Chrome (then
Microsoft Edge) through `playwright-core` with a visible window, so the user
can watch, and sign in when a site asks. It runs one worker's scripts in order.
Pages idle for 30 minutes close, and the window closes 10 minutes after the
last page. A script that outlives its timeout fails the call; if the host stops
answering 15 s past that, the main process kills it, and the next call starts a
new host and window.

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
