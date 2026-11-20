---
title: Owlto support
navTitle: Support
description: Get help with Owlto for Mac and Owlto for iPhone and iPad: pairing your phone, connection problems, notifications, and how to contact the developers.
order: 2
updated: 2026-11-20
---

## Contact us

- **Email:** [support@owlto.dev](mailto:support@owlto.dev). We usually reply within a few working days.
- **Bug reports and feature requests:** [GitHub Issues](https://github.com/jackeydou/Owls/issues). Please don't post private information there; issues are public.
- **Mac app guides:** the [documentation](/docs/), starting with [Install Owlto](/docs/install/) and [Troubleshooting](/docs/troubleshooting/).

When you report a problem, it helps to include the Owlto version on your Mac (**Owlto → About Owlto**), your macOS and iOS versions, and what you expected to happen.

## What the iPhone and iPad app does

Owlto for iPhone and iPad is a remote control for the Router on your Mac. From your phone you can message the Router, follow workers, look at changes, and answer the questions workers ask, while your Mac does the work with your own coding agents.

You need:

- A Mac running Owlto. The Mac must stay on, awake, and with Owlto open.
- An iPhone or iPad with iOS 17 or later.

The phone app is free and needs no account.

## Pair your phone

1. On your Mac, open Owlto and go to **Settings → Devices**, then turn on **Connect devices**.
2. Choose how the phone connects:
   - **Same network:** the phone and the Mac are on the same Wi-Fi, or on the same VPN such as Tailscale.
   - **Relay:** the phone can be anywhere, on cellular or any Wi-Fi. Turn on **Allow connections over the internet** and sign in with GitHub on the Mac when asked.
3. On your phone, open Owlto, tap **Scan QR code**, and scan the code your Mac shows.
4. Check that the six-digit safety code is the same on both devices. If it is not, remove the device and pair again.

## Troubleshooting

### The phone can't reach my Mac

- Make sure Owlto is open on the Mac and the Mac is awake. In **Settings → Devices**, **Keep this Mac awake on power** keeps a plugged-in Mac reachable.
- On the same network, check that the phone is allowed to use the local network: **iPhone Settings → Privacy & Security → Local Network → Owlto**.
- Away from home, make sure **Allow connections over the internet** is on and the Mac shows **Connected to the relay**.
- If none of that helps, remove the device on both sides and pair again.

### Notifications don't arrive

- Allow notifications for Owlto in **iPhone Settings → Notifications → Owlto**.
- Notifications come from your Mac, so it must be on, awake, and connected to the relay.

### The camera doesn't open when I scan

Allow camera access in **iPhone Settings → Privacy & Security → Camera → Owlto**. The camera is used only to scan the pairing code.

### "The relay sign-in has ended"

On the Mac, go to **Settings → Devices** and sign in with GitHub again.

## Remove a device

- On the phone, open **Devices**, choose the Mac, and remove it.
- On the Mac, go to **Settings → Devices** and remove the phone. It can no longer connect.

## Privacy

Your threads and code stay on your Mac. The connection between your phone and your Mac is end-to-end encrypted, and the phone app has no analytics or tracking. Read the full [privacy policy](/privacy/).
