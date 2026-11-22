# RFC: In-App Browser For Workers

Status: proposal with a renderer prototype (debug builds only). Nothing in
main, preload, or the worker tools changes yet.

## Problem

Workers browse through the `browser` tool (`docs/BROWSER_TOOL.md`): Owlto
launches the user's installed Chrome or Edge through `playwright-core` in a
separate window and runs the worker's Playwright script against it. It works,
but:

- **It lives outside Owlto.** The Chrome window floats somewhere else. The user
  cannot see which worker drives which tab, and has to find the window to
  watch it.
- **No hand-off.** When a site asks for a sign-in, a captcha, or a 2FA code,
  the worker can only fail or guess. There is no way to say "your turn" and
  wait, and no way for the user to say "stop, let me".
- **It depends on an installed browser.** No Chrome or Edge, no tool. The
  profile is a Chrome profile that Chrome updates can disturb.
- **Agents differ.** Codex and Cursor get `browser`; Claude Code workers use
  Claude in Chrome, which needs the user's own extension setup and signs in
  with the user's personal Chrome profile.

## Goals

1. Browse inside Owlto, in a panel the user can watch, with every tab labeled
   by the worker that drives it.
2. Let a worker hand a step to the user, and let the user take over at any
   moment, then hand back.
3. Keep sign-ins across restarts, in a profile that belongs to Owlto, not to
   the user's personal browser.
4. One browser and one tool contract for Claude Code, Codex, and Cursor.
5. Keep today's permission rules, restricted script mode, and approvals.

Non-goals: a general-purpose browser for the user (bookmarks, extensions,
history UI), and remote control of the user's own Chrome.

## Design

### Where it lives

A fourth tab in the right sidebar, **Browser** (globe icon), next to Projects,
Notes, and File viewer. Like the file viewer it keeps its own, wider width
(`layout.browserWidth`, 400 to 1280 px, default 640). The panel has:

- **Tab strip.** Each tab shows its owner: the worker's owl (typing while it
  drives) or a person icon for the user's own tab. A dot marks a tab that
  needs the user. The tooltip says who opened it.
- **Toolbar.** Back, forward, reload, the address (host bold, rest muted, lock
  or globe for secure or local), and one control button: **Take over** while a
  worker drives, **Hand back** while the user holds a worker's tab.
- **Who-drives line.** "Check settings page is using this page ··· Click
  'Save changes'" while a worker drives; an amber ask with **Done, hand back**
  when the worker asked for the user; a muted note while the user drives.
- **Page.** A worker-driven page gets a 2 px inner ring in the provider's
  color and ignores the user's input; the worker's last click shows as a
  pointer in that color. A hand-off page gets an amber ring and takes input.

When a worker asks for a hand-off, Owlto opens the panel on that tab and
sends the existing approval notification (dock badge, system notification,
click opens the tab). Otherwise opening a tab never steals focus: the panel
stays where the user left it, and tabs keep running in the background.

Worker details get a "View in browser" button when the worker owns a tab, and
the Router's worker row says "needs you" instead of a generic wait.

### Runtime

```
 renderer (BrowserPane)          main                             page
 ─────────────────────           ──────────────────────           ─────────────
 placeholder div  ──bounds──▶    BrowserManager                   WebContentsView
 tab strip, toolbar ◀─events──   ├ one WebContentsView per tab    partition
                                 ├ control state per tab          persist:owlto-browser
                                 └ CdpGate (loopback, token) ◀──  Playwright connectOverCDP
                                        ▲                          (browser host process)
                                        └── webContents.debugger (in-process CDP)
```

- **Views.** Main owns tabs as `WebContentsView`s added to the window's
  `contentView`. The renderer reports the page area's bounds (ResizeObserver,
  device pixels) and main lays the active view over it. Hidden tabs are
  removed from the window but keep running (`backgroundThrottling: false`
  while a worker drives them).
- **Session.** All tabs use `session.fromPartition('persist:owlto-browser')`,
  stored in the data root, so sign-ins persist and stay separate from Owlto's
  own renderer session. Owlto's Chrome profile under `<dataRoot>/browser` is
  no longer used; no migration, the user signs in once more (beta).
- **Web preferences.** `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, no preload. Permission requests (camera, mic,
  geolocation, notifications, MIDI, HID, serial) are denied by default.
  `file://`, `chrome://`, `devtools://`, and Owlto's own origins are blocked.
  Pop-ups open as new tabs owned by the same worker.
- **Downloads** land in `<dataRoot>/browser/downloads/<workerId>/` and the
  path is returned to the worker. Uploads keep today's rule: restricted
  workers cannot pick local files.

### The CDP gate

Electron's `--remote-debugging-port` would expose every target, including
Owlto's own renderer, to any local process: a worker could click its own
approvals. So Owlto never opens it. Instead:

1. Main attaches `webContents.debugger` to each browser tab (in-process CDP,
   no port).
2. `CdpGate` serves a loopback WebSocket with a random token per host launch.
   It speaks just enough of the browser-level CDP surface (`Browser.*`,
   `Target.*` for the tab list, auto-attach, create and close) for Playwright's
   `connectOverCDP`, and relays session messages to the tab debuggers.
3. It lists only browser tabs, and only the caller's own tab for a worker
   key. `Target.createTarget` creates a tab owned by the caller.
   `Browser.close`, `Target.exposeDevToolsProtocol`, and other domains that
   reach outside a tab are refused.

This is the same shape as Playwright MCP's extension relay. The browser host
utility process keeps running scripts, but connects with `connectOverCDP` to
the gate instead of launching Chrome, so `run-code.ts` and `sandbox.ts` stay
as they are and the tool's contract does not change.

### Tool contract

One tool for all three agents, served the way each agent already gets worker
tools: Codex as a dynamic tool (`owlto_browser`), Cursor through the local
HTTP MCP server, and Claude Code through the SDK MCP server that serves
`report` today.

- `browser` (unchanged input: `code`, `timeoutMs`). `page` is now the
  worker's tab in the panel. While the user holds the tab, a call waits up to
  its timeout for the hand-back, then fails with "The user is using this tab;
  try again after they hand it back."
- `browser_handoff` (new): `{ reason: string, timeoutMs?: number }`. Marks
  the tab `handoff`, shows the amber ask, notifies the user, and resolves when
  they press **Done, hand back** (`{ status: 'done', url }`), close the tab
  (`closed`), or the timeout passes (`timeout`, default 15 min). The worker
  is told to use it for sign-ins, captchas, 2FA, and payment steps, never to
  type a user's password itself.

Each call also sets the who-drives line: the gate records the last
`Input.dispatchMouseEvent` target and a short action label (from Playwright's
API name and selector) for the pointer and "Click 'Save changes'".

Claude Code: the Claude in Chrome setting stays for users who want their own
Chrome, but defaults off once the in-app browser ships; the Owlto `browser`
tool takes its place by default.

### Concurrency

- One tab per worker key, as today. Two workers never share a page. A worker
  may open more tabs (pop-ups, `context.newPage()`); they are all its own.
- Calls on one tab run in order (the host's per-key queue stays).
- The user's own tabs (the + button) are never visible to workers.
- A tab closes when its worker is removed, and after 30 idle minutes as
  today; a tab the user took over stays until the user closes it.
- Control is a small state machine per tab: `agent → user` (Take over),
  `user → agent` (Hand back), `agent → handoff` (tool), `handoff → agent`
  (Done). Take over during a running call lets the current CDP command
  finish, then holds the queue.

### Security

- Sign-ins are shared by all workers, so a worker can act as the user on any
  site the user signed in to in Owlto's browser. Mitigations: the profile is
  Owlto's, not the user's personal Chrome; every action is visible in the
  panel; read-only workers keep restricted mode and cannot read local files.
- Phase 3 adds per-site rules in Settings → Browser: a site list with
  "Allow", "Ask first", or "Block", and "Ask before a worker submits a form on
  a site you are signed in to" for sensitive hosts. Asks reuse the approval
  card.
- The gate binds 127.0.0.1, checks the token, and dies with the host.
- Settings → Browser gets "Clear sign-ins" (clears the partition storage).

### Risks to check before building

- **Overlays.** A `WebContentsView` draws above all DOM, so menus, tooltips,
  and dialogs that overlap the page area are hidden under it. Plan: while an
  overlay is open over the page, swap the view for a `capturePage()` snapshot.
- **CDP coverage.** `connectOverCDP` needs enough browser-level CDP; verify
  Playwright's handshake against the gate early (spike, phase 1).
- **Hidden tabs.** Confirm screenshots and input work on a view removed from
  the window, or keep background tabs attached at zero size.
- **Window drag regions.** The panel sits in a drag region; the view must not
  break `-webkit-app-region` around it.

## Phases

1. **Panel and gate spike.** `BrowserManager` with views, bounds sync, the
   persistent partition, the gate, and Playwright `connectOverCDP` from the
   host. `browser` tool runs in the panel for Codex and Cursor. Chrome
   fallback removed.
2. **Hand-off and Claude Code.** Take over and hand back, `browser_handoff`,
   notifications, worker-details button, pointer and action line. Serve
   `browser` to Claude Code workers; Claude in Chrome defaults off.
3. **Site rules and polish.** Settings → Browser (site rules, clear sign-ins,
   downloads folder), overlays snapshot, Doodle skin pass.

## Prototype

`apps/owlto-client/src/renderer/src/browser/` holds the panel UI against a
demo store (`store.ts`) with stand-in pages (`PrototypePage.tsx`), shown only
in debug builds. `shared/browser-panel.ts` is the tab model main would send.
