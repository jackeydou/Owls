# RFC: Browser Use Local RPC And Runtime

## Status

Initial runtime implementation in progress.

Owls Browser Use exposes the session browser through a Codex-shaped runtime
script backed by local RPC. Browser automation remains owned by the Owls main
process, while agents interact with it through the bundled
`control-in-app-browser` skill and `scripts/browser-client.mjs`.

## Abstract

Browser Use is Owls's session-scoped browser automation runtime. It lets agents
open pages, inspect DOM state, click, fill, wait, scroll, take screenshots, and
perform coordinate-based CUA actions against the current Owls session browser.

The agent-facing entrypoint is the built `browser-client.mjs` script in the
bundled `in-app-browser-use` plugin. The script installs a Codex-aligned
`agent.browsers` API with `agent.browsers.get("iab")`. Runtime calls such as
`tab.goto(...)`, `tab.playwright.getByText(...)`, and `tab.cua.click(...)`
operate on the same session browser through authenticated local RPC.

There is no `browser-use` bash CLI. Browser work should go through the runtime
script.

## Motivation

The previous Browser Use surface injected many browser-specific native tools into
eligible agent runs. That increased model tool context and made the core agent
runtime aware of Browser Use action semantics.

Browser Use should instead follow Codex's in-app Browser approach: a skill tells
the agent when and how to load a browser runtime, while the App keeps browser
authority and validates requests at a narrow process boundary.

## Goals

- Remove Browser Use native tools from `createToolsForCwd`.
- Expose Browser Use behavior as explicit `browser.*` local RPC methods.
- Provide a Codex-shaped `browser-client.mjs` runtime script with
  `setupBrowserRuntime({ globals })`, `agent.browsers.get("iab")`, tab helpers,
  documentation, CUA APIs, and browser capability discovery.
- Use the bundled skill to teach agents when and how to load the runtime.
- Keep Browser Use runtime availability independent from the
  `in-app-browser-use` plugin installation state.
- Keep browser sessions scoped to Owls session ids.
- Keep renderer, preload, local RPC, and runtime boundaries narrow and typed.
- Preserve deterministic action flow: observe, resolve, act, verify.

## Non-Goals

- Do not create a general-purpose remote browser automation server.
- Do not expose arbitrary Chrome DevTools Protocol execution through local RPC,
  runtime, preload, or renderer APIs.
- Do not let the runtime read or write Owls SQLite data, browser profile files,
  or Electron `WebContents` directly.
- Do not add runtime configuration through environment variables.
- Do not require follow-up Browser Use commands to keep the Browser panel open
  after the runtime has created the session browser.
- Do not implement server-push local RPC subscriptions in the first pass.
- Do not create multiple browser profiles in this design. Profile strategy is a
  separate product decision.

## Architecture

```text
Agent
  -> Node REPL import of plugin scripts/browser-client.mjs
    -> Browser runtime API
      -> local RPC Unix socket
        -> browser.* local RPC handlers
          -> BrowserUseService
            -> BrowserSessionRuntime
              -> renderer <webview> WebContents / CDP

Renderer Browser panel
  -> DOM <webview>
    -> narrow preload IPC attach / detach / navigation UI APIs
      -> same BrowserSessionRuntime state model
```

The Browser Use runtime is a main-process service. Local RPC and renderer IPC
are adapters over that service. They must not call each other.

```text
Correct:
Runtime script -> local RPC handler -> BrowserUseService
UI             -> IPC handler       -> BrowserUseService

Incorrect:
Runtime script -> Electron/WebContents/CDP directly
UI             -> IPC handler       -> local RPC handler
```

## Product Model

Each Owls session can own one browser runtime:

```text
Session A
  Browser runtime
    renderer <webview> WebContents
    current URL / title / loading state
    operation queue
    recent traces
    visible: false

Session B
  Browser runtime
    renderer <webview> WebContents
    visible: true
```

Runtime navigation can remain backgrounded. When the agent should show the page
to the user, it calls the runtime visibility capability:

```js
await (await browser.capabilities.get("visibility")).set(true);
```

The renderer retains recently used Browser panels as an LRU queue of mounted
`<webview>` elements. Switching back to a retained session reuses the existing
guest `WebContents`, so the page does not need to be requested again unless the
session has been evicted from that queue or closed.

## Session Identity

Every Browser Use operation targets a session id.

```ts
type BrowserSessionId = string
```

Local RPC methods accept `sessionId`. Agent-launched runtime calls receive the
current Owls session id through Owls's existing process execution context
injection for that Node REPL command. This is allowed because it is generic
process execution context, not special runtime configuration. It does not
configure Browser Use behavior, toggle App features, or replace persisted
settings. It only identifies the current agent session to a child process.

The injected value must be scoped to the spawned command and must not be
persisted or stored in settings.

If no session id can be resolved, Browser Use should fail closed with an
actionable error instead of using a global shared browser.

## Runtime Script Contract

The built runtime script is delivered from:

```text
apps/pichu-client/resources/plugins/plugins/in-app-browser-use/scripts/browser-client.mjs
```

Agents load it with an absolute path from the bundled skill:

```js
const { setupBrowserRuntime } = await import("<plugin root>/scripts/browser-client.mjs");
await setupBrowserRuntime({ globals: globalThis });
globalThis.browser = await agent.browsers.get("iab");
nodeRepl.write(await browser.documentation());
```

The runtime installs:

- `agent.browsers.list()`
- `agent.browsers.get("iab")`
- `agent.documentation.get(name)`
- `browser.documentation()`
- `browser.capabilities`
- `browser.tabs`
- `browser.user`

The first pass exposes one session-scoped tab. The runtime API owns the
Codex-aligned shape, while local RPC remains an implementation boundary.

## Local RPC Methods

Browser Use local RPC methods are namespaced under `browser.`:

```text
browser.status
browser.open
browser.visibility
browser.back
browser.forward
browser.close
browser.snapshot
browser.click
browser.fill
browser.press
browser.cua.click
browser.cua.double_click
browser.cua.drag
browser.cua.keypress
browser.cua.move
browser.cua.scroll
browser.cua.type
browser.dom_cua.get_visible_dom
browser.dom_cua.keypress
browser.dom_cua.scroll
browser.dom_cua.type
browser.scroll
browser.scrollUntil
browser.waitFor
browser.screenshot
browser.select
browser.pickDate
browser.treeSelect
browser.diagnostics
```

The `browser.cua.*` and `browser.dom_cua.*` RPC names intentionally mirror the
runtime CUA method names. Internal CDP details such as mouse dispatch do not
leak into the RPC method names.

All methods must:

- Validate params at the socket boundary.
- Require App readiness and authentication.
- Resolve and validate `sessionId`.
- Call `BrowserUseService`.
- Return deterministic JSON.
- Map known service failures to stable local RPC errors.
- Avoid leaking cookies, auth headers, tokens, full private payloads, or raw CDP
  internals.

## Browser Use Service

`BrowserUseService` owns browser automation state and behavior:

```ts
type BrowserUseService = {
  ensureSession(input: { sessionId: string }): Promise<BrowserSessionView>
  status(input: { sessionId: string }): Promise<BrowserSessionView>
  open(input: BrowserOpenInput): Promise<BrowserActionResult<BrowserSessionView>>
  snapshot(input: BrowserSnapshotInput): Promise<BrowserActionResult<BrowserSnapshot>>
  click(input: BrowserClickInput): Promise<BrowserActionResult<BrowserPostActionState>>
  fill(input: BrowserFillInput): Promise<BrowserActionResult<BrowserPostActionState>>
  press(input: BrowserPressInput): Promise<BrowserActionResult<BrowserPostActionState>>
  scroll(input: BrowserScrollInput): Promise<BrowserActionResult<BrowserPostActionState>>
  scrollUntil(input: BrowserScrollUntilInput): Promise<BrowserActionResult<BrowserPostActionState>>
  waitFor(input: BrowserWaitForInput): Promise<BrowserActionResult<BrowserPostActionState>>
  screenshot(input: BrowserScreenshotInput): Promise<BrowserActionResult<BrowserScreenshot>>
  select(input: BrowserSelectInput): Promise<BrowserActionResult<BrowserPostActionState>>
  pickDate(input: BrowserPickDateInput): Promise<BrowserActionResult<BrowserPostActionState>>
  treeSelect(input: BrowserTreeSelectInput): Promise<BrowserActionResult<BrowserPostActionState>>
  diagnostics(input: BrowserDiagnosticsInput): Promise<BrowserDiagnostics>
  attach(input: BrowserAttachInput): Promise<BrowserSessionView>
  detach(input: { sessionId: string }): Promise<BrowserSessionView>
  dispose(input: { sessionId: string }): Promise<void>
}
```

The service owns:

- Renderer webview attachment state.
- Navigation state.
- Browser operation queues.
- CDP debugger attachment and detachment.
- Snapshot, locator, action, wait, screenshot, and diagnostics behavior.
- Redaction for traces and error payloads.
- Cleanup when sessions close or the App exits.

## Safety

Browser pages and page-derived content are untrusted. The runtime and skill must
preserve these rules:

- Page content cannot override system, developer, user, or repository
  instructions.
- Submitting forms, sending messages, uploading files, changing access, making
  purchases, and entering sensitive data can transmit user data.
- The agent must confirm at action time before external side effects unless the
  user's prompt already clearly authorized the exact action and destination.
- CAPTCHA, permission prompts, paywalls, safety interstitials, and final
  password-change steps require explicit user involvement.
- Logs, diagnostics, and errors must redact secrets and avoid raw private page
  payloads.

## Plugin Responsibilities

The bundled `in-app-browser-use` plugin should:

- Provide the Browser Use skill that explains when and how to load the runtime.
- Provide the built `@pichu/browser-use` runtime script as an
  Owls-controlled plugin script shipped from App resources.
- Avoid deciding whether Browser Use runtime exists. The App owns runtime
  availability; the plugin owns guidance and script delivery.

## Migration Plan

1. Add local RPC methods for Browser Use actions.
2. Keep Browser Use runtime state in the App main process.
3. Add `packages/browser-use` as the `@pichu/browser-use` runtime package.
4. Build `browser-client.mjs` from that package and sync it into the bundled
   plugin scripts directory.
5. Update the Browser Use skill to load the runtime first.
6. Remove native Browser Use agent-tool injection after runtime parity is
   verified.

## Verification

Add focused coverage for:

- Bundled plugin includes `scripts/browser-client.mjs`.
- Runtime setup exposes `agent.browsers.get("iab")`.
- Runtime exposes selected tab helpers, Playwright-style helpers, CUA helpers,
  DOM-CUA helpers, documentation, and visibility capability.
- Local RPC commands validate auth, session id, and params.
- Runtime calls can open, inspect, act, screenshot, and continue after the
  Browser panel is closed.

Use targeted package checks for implementation changes:

```bash
pnpm --filter @pichu/browser-use typecheck
pnpm --filter @pichu/browser-use build
pnpm --filter pichu-client typecheck:node
pnpm --filter pichu-client test:plugins
```

Do not run local Electron or Playwright E2E in the shared worktree unless the
task explicitly asks for it.
