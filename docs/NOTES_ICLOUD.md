# Notes in iCloud

Settings → Experiments → **Sync notes with iCloud** (experimental) keeps the notes folder in Owlto's iCloud Drive
container, so the user's Macs and the iPhone app read and write the same Markdown files.
Everything else (threads, workers, projects, the Workspace, boards, settings) stays on
the device it belongs to.

## How it works

- Container: `iCloud.dev.owlto.app`. Notes live in `<container>/Documents/Notes`; on a Mac
  that is `~/Library/Mobile Documents/iCloud~dev~owlto~app/Documents/Notes`. The
  `NSUbiquitousContainers` Info.plist key shows `Documents` in iCloud Drive as "Owlto".
- `settings.notesLocation` is `local` or `icloud`, saved only by the switch
  (`window.owlto.cards.setStorage`).
- Turning it on moves the notes from the local folder into the container. A file the
  container already has with the same content counts as moved; one with other content
  arrives under a free name and gets its own id.
- Turning it off copies the notes back and leaves the iCloud files for the other devices.
  It refuses while any note is not downloaded yet (an `.<name>.md.icloud` placeholder or
  a file that fails to read): it asks iCloud to download them and the user tries again.
- `NotesStorageService` (`src/main/cards/storage.ts`) moves the files while the store is
  not watching, then points `CardStore` and the agents (Claude, Cursor, Antigravity read
  access; worker prompts) at the new folder. The index keeps ids, versions, and board places.
- `CardStore` treats a placeholder or a file that fails to read as unchanged, never as
  deleted, and gives files that need an id one derived from the file name, the same on
  every device.
- `@owlto/mac-icloud` (Rust, `packages/mac-icloud`) wraps `NSFileManager`:
  `identityAvailable`, `containerPath` (off the main thread, as Apple asks), and
  `startDownloading`. electron-builder leaves pnpm workspace packages out of the app, so
  `scripts/electron-builder-config.cjs` copies the helper in through `files`, and
  `verify:packaged` loads it from the packaged app so a release without it fails.

## Builds

iCloud is a restricted entitlement: macOS kills a Developer ID app that claims it without
a matching embedded provisioning profile. So only release builds that get a profile carry it.

One-time setup in the Apple Developer account (same team as the iOS app):

1. Create the iCloud container `iCloud.dev.owlto.app`.
2. Turn on iCloud (iCloud Documents) for the App IDs `dev.owlto.app` and
   `app.owlto.mobile`, both with that container.
3. Create a **Developer ID** provisioning profile for `dev.owlto.app`, and save it
   base64-encoded as the repository secret `MAC_PROVISIONING_PROFILE_BASE64`.

The Release macOS workflow then sets `OWLTO_MAC_PROVISIONING_PROFILE`, and
`scripts/mac-icloud-signing.cjs` embeds the profile and adds the iCloud keys to the main
app's entitlements only (never the helpers). Without the secret the build works as before
and Settings → Experiments says the build cannot use iCloud. Debug builds (`dev.owlto.app.debug`)
and `pnpm dev` never carry it.
