# Codex Browser Annotation Alignment

## Current Decision

Owls's visible Browser panel uses a renderer-owned Electron `<webview>`, aligned
with Codex's embedded browser architecture. Main process still validates and
tracks the guest `WebContents` through a narrow attach handshake.

Codex can render browser annotation UI in a sibling DOM overlay because its
browser surface is a renderer `<webview>`. Owls now has the same renderer DOM
layering available for cursor and app-owned overlay UI. The current annotation
implementation continues to install a narrow browser annotation runtime from a
dedicated isolated preload. That runtime owns visible hover boxes, draft editors,
and markers. Main process owns mode sync, payload validation, screenshot
capture, and event forwarding to the renderer.

## User Flow

1. A local `.html`/`.htm`, `file://...html`, or `http(s)` link opens the right
   Browser panel.
2. The user clicks the annotation button in the Browser toolbar.
3. The toolbar switches to `Annotating • <url/path>`.
4. The page runtime highlights hover targets.
5. The user clicks an element or drags a region.
6. A compact comment pill appears inside the browser page.
7. Submitting a comment adds a pending browser annotation and keeps the submitted
   marker visible while annotation mode is active.
8. `Send` forwards the pending annotations as structured browser comment
   attachments to the Chat composer and exits annotation mode.
9. Leaving or discarding annotation mode clears pending annotations and page
   annotation UI without adding them to the composer.
10. During the active annotation mode, submitted element markers track their
    selected targets across scroll and resize when the selector can be replayed.

## Data Contract

Browser annotation comments are stored as existing `MessagePart` comment
attachments. No new database table is required for the first version.

The payload carries:

- user comment text
- page URL and title
- selector/path when an element was selected
- viewport point and rect
- selected region text when a dragged region overlaps visible text
- nearby text and compact document context
- optional local screenshot reference

The Browser panel keeps submitted annotations pending until the user clicks
`Send`. The composer then receives each payload through the existing
`pichu:add-chat-comment` event. The prompt path uses existing message part
projection. The implementation must not append full page text into the input
box.

## Runtime Boundary

The browser annotation preload runs in Electron's isolated world and installs the
runtime directly. Host commands are delivered to the preload through a narrow IPC
channel, and runtime events are sent back through a narrow IPC channel. Do not
expose generic script execution or page-main-world message bridges for browser
annotation.

The renderer-created webview is guarded in main before attach:

- only the main app window can attach embedded browser webviews
- the browser partition is forced to the Owls browser profile
- Node integration is disabled, context isolation and sandboxing are enabled
- only the app-owned browser annotation preload is installed

Main process accepts only typed annotation commands:

- `set-mode`
- `discard`
- `commit`

The page runtime emits only:

- `ready`
- `submit`
- `cancel-draft`

Main validates submit payloads before forwarding them to the renderer.

## Non-Goals

- Do not reintroduce streaming UI as the annotation model.
- Do not expose generic script execution to the renderer.
- Do not persist browser annotations in a new table until cross-message replay,
  deletion, or saved-page history needs it.
- Do not show saved markers in ordinary browse mode.

## Follow-Up

Additional Codex-alignment follow-ups:

- Keep annotation UI outside target page DOM with the app-owned overlay above.
- Add first-class text ranges and replayable anchors.
- Persist and replay markers across messages, navigation, and ordinary browse
  mode when saved markers become a product requirement.
