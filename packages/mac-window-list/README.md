# @owls/mac-window-list

Native (Rust + napi-rs) helper that wraps macOS `CGWindowListCopyWindowInfo`,
returning each on-screen window with its **owner application**, title, bounds,
and stable `windowId` — the field Electron's `desktopCapturer` does not provide.

## Why

`desktopCapturer.getSources({ types: ['window'] })` only exposes the window
title (`name`) and an opaque `id` like `window:12345:0`. We want the owning
app name so the agent can say "screenshot Safari" without relying on title
heuristics.

## Build

```bash
pnpm install
pnpm --filter @owls/mac-window-list build
```

The output is `mac-window-list.<platform>-<arch>.node` next to `index.js`.

For a universal mac binary used by `electron-builder`:

```bash
pnpm --filter @owls/mac-window-list build:universal
```

## Usage

```ts
import { listWindows } from '@owls/mac-window-list'

const windows = listWindows({ onScreenOnly: true })
for (const w of windows) {
  console.log(`${w.ownerName} — ${w.title ?? '(untitled)'}  [#${w.windowId}]`)
}
```

## Joining with `desktopCapturer`

Electron's window source id is `window:<windowId>:<displayIndex>`; parse the
middle number and look it up in `listWindows()` output to enrich the source
with `ownerName`.
