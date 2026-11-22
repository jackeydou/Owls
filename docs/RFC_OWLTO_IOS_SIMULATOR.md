# RFC: iOS Simulator Panel For Workers

Status: built (panel, host process, `simulator_*` tools for all agents,
per-device consent, approvals, Settings toggle). Not yet checked on a real Mac
with Xcode: capture, H.264 decode, touch, the accessibility tree, and signing
of the native addon under the hardened runtime still need a live run.

## Problem

Workers can build iOS apps with `xcodebuild`, but they cannot see or drive the
result. The user has to open Simulator.app, find the right device, and tell
the worker what happened.

## Goals

1. Show a booted iOS simulator live in the right sidebar, and let the user
   touch and type on it.
2. Let a worker attach a device, install and launch its build, look at the
   screen (screenshot plus an element list with tappable refs), tap, swipe,
   type, press buttons, and read logs.
3. One tool contract for Claude Code, Codex, and Cursor.
4. Keep the user in charge: a worker needs the user's OK the first time it
   uses a device, and below full access the user approves installs, launches
   of apps the worker did not install, and URLs.

Non-goals: physical devices, Android, and replacing Simulator.app.

## Design

### Native layer

Owlto depends on [`serve-sim`](https://www.npmjs.com/package/serve-sim)
(Apache-2.0). Only its universal N-API addon is used: `SimCapture` (H.264 or
JPEG frames from the device's framebuffer), `SimHID` (touches, keys, hardware
buttons), and `axDescribe` (the accessibility tree). Its CLI, Swift sources,
and helper binaries are left out of the package.

The addon runs in an Electron utility process (`src/main/simulator/host.ts`),
so a native crash cannot take down the main process. Main talks to it with
typed request/reply messages (`protocol.ts`, `host-client.ts`). Everything
else (listing, booting, installing, launching, URLs, pasteboard, logs) goes
through `xcrun simctl` (`simctl.ts`).

### Live stream

When the panel shows a device, main creates a `MessageChannelMain`, hands one
end to the host and the other to the renderer. The preload re-posts the port
to the page with `window.postMessage`, because a `MessagePort` cannot cross
the context bridge. The host sends AVCC frames on the port; the renderer
decodes them with WebCodecs `VideoDecoder` onto a canvas. Touches and keys go
back on the same port, so input never passes through IPC handlers.

### Service

`SimulatorService` owns devices, leases, and asks:

- **Leases.** A worker holds one device at a time. A lease ends after 10 idle
  minutes, when the worker ends, or when the user detaches.
- **Consent.** The first time a worker attaches a device, the panel opens with
  an ask. Allowing it remembers the device in `settings.simulator.allowedDevices`.
- **Approvals.** Below full access, installs, launches of apps the worker did
  not install, and `simulator_open_url` ask the user first. Each ask times out
  after 10 minutes. A waiting ask also raises a system notification and the
  dock badge.
- **Cleanup.** Devices Owlto booted shut down after 10 idle minutes.

### Worker tools

`simulator_attach`, `simulator_button`, `simulator_devices`,
`simulator_install`, `simulator_launch`, `simulator_logs`,
`simulator_open_url`, `simulator_screen`, `simulator_swipe`, `simulator_tap`,
and `simulator_type` (`tool.ts`). Coordinates are in points. `simulator_screen`
returns one line per element with text or input, such as
`@e3 Button "Sign in" at (200, 720)`, and `simulator_tap` takes the ref.
Text a US keyboard cannot type is pasted through the device pasteboard.

The tools are on when `settings.simulator.enabled` is true (the default) and
only do anything on macOS with Xcode installed.

### Panel

The right sidebar gets a Simulator tab next to Browser, with its own width
(`layout.simulatorWidth`). It reuses the browser panel's toolbar and status
line: a device menu, Home and Lock buttons, Detach and Shut down, a line
saying which worker drives the device, and the ask strip. The panel does not
open when a worker attaches; it opens only when an ask needs the user.

Settings → Browser & Simulator has the enable switch and a button that forgets
the allowed devices.

### Xcode 27 and Device Hub

- Booting runs `simctl boot` and then `simctl bootstatus` without `-b`, falling back to
  the device's listed state: on Xcode 27, `bootstatus -b` can stay blocked after the
  device is booted.
- Device Hub can disconnect the legacy touch and keyboard input the addon uses (guest flag
  `com.apple.coredevice.dtuhidd.active`). After attaching, Owlto checks the flag; the
  panel then says so and offers Repair input, which clears the flag, restarts backboardd
  (SpringBoard restarts and apps close), and reconnects the host. It never runs on its own.
- The addon wraps each H.264 chunk in serve-sim's stream envelope (4-byte length, tag);
  the host strips it (`envelope.ts`) before the panel decodes.

## Open questions

- Whether to keep depending on `serve-sim` or fork the addon once the API
  settles.
- Whether the hardened runtime needs an extra entitlement for the addon.
