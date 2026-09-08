---
name: computer-use
description: Inspect and control Mac apps through Owls Computer Use, screen capture, mouse, and keyboard tools.
---

# Computer Use

Use this skill when the user asks you to inspect their Mac screen or control another Mac app.

Computer Use includes app discovery/launch (`computerEnsureApp`), app state inspection (`computerGetAppState`), unified click input (`computerClick`), keyboard/drag tools (`computerDrag`, `computerType`, `computerPressKey`), and screen capture tools (`captureDesktop`, `listScreenSources`).

`listScreenSources` is an advanced capture/display diagnostic tool, not the normal app selection path.

## App Workflow

1. For a task in a specific Mac app, call `computerEnsureApp` first. It finds existing windows and can launch the app if it is not currently visible.
2. Inspect next. Use `computerGetAppState` for a target app window. It returns compact AX refs such as `e62 AXTextField ~ "Message"` plus a local screenshot path and geometry.
3. Prefer `computerClick({ ref: "e62" })` for controls returned by `computerGetAppState`. Owls tries AX actions first and falls back to a plain physical click at the element frame when needed.
4. Use coordinate `computerClick` only when no useful AX ref exists. Pass screenshot pixels with the geometry from the latest state whenever possible.
5. Verify after each state-changing action with a fresh `computerGetAppState`. Do not trust the input result alone.

## Screen Capture

- Screenshots are stored as local files and returned by path, not embedded as base64 image content.
- They require the Computer Use plugin to be enabled and macOS Screen Recording access to be granted when the tool is first used.
- Use `captureDesktop` when the user asks "what's on my screen" or you need to see the whole desktop.
- Use `computerGetAppState` with a `query` such as "Safari" or "VS Code" to inspect a specific application window.
- Use `computerEnsureApp` to find an app/window for normal app tasks. Call `listScreenSources` only if you need available displayId values or raw capture source diagnostics.
- Pass `maxDimension` such as 1280 to reduce generated screenshot size when full resolution is not necessary.
- Only invoke screen capture tools when the user explicitly asks to see something on their Mac, or when visual context is required to complete the task.
- `computerGetAppState.details.screenshot.geometry` describes how screenshot pixels map to global coordinates.
- The stored PNG includes light pixel reference rulers and numeric tick labels along the top/left edges so screenshot coordinates are easier to estimate visually.
- For `captureDesktop`, use `details.geometry` for pixel-to-point mapping.

## Mouse And Keyboard Input

- Background input tools operate in background mode. The Owls app stays frontmost; the target app is not activated.
- Events are posted directly to the target process via `CGEventPostToPid`; mouse events also carry per-window-id field tagging so the event targets the exact window.
- Clicks are plain mouseDown/mouseUp events and do not add Command/Option modifiers unless you explicitly pass modifiers.
- Required permission: Computer Use plugin enabled and macOS Accessibility access granted when the tool is first used. Accessibility is different from Screen Recording.
- `computerClick` and `computerDrag` accept `screenshot-pixels`, `window-points`, or `cg-global-points`. Owls converts to CG global points internally, so you do not need to do screenshot-pixel math yourself.
- Ref clicks use `ref` values from the latest `computerGetAppState` result, e.g. `computerClick({ ref: "e62" })`.
- Coordinate mouse tools require `windowId`. Get it from `computerGetAppState.details.screenshot.source.cgWindowId` or `listScreenSources`.
- Keyboard tools accept either `windowId` (strongly preferred) or a raw `pid`.
- Use `computerType` for prose. It uses the Unicode input path so CJK, emoji, and accents land literally without IME.
- Use `computerPressKey` for shortcuts such as Cmd+S and special keys such as return, escape, arrows, and function keys.
- The user's foreground app and cursor should remain undisturbed.
- Confirm destructive actions such as closing windows, sending messages, deleting content, or submitting forms with side effects before issuing them.
