---
title: Privacy policy
navTitle: Privacy
description: What Owlto for Mac, Owlto for iPhone and iPad, the Owlto relay, and this website collect, why, and how to turn it off or ask for it to be deleted.
order: 1
updated: 2026-11-20
---

Owlto is built so your work stays on your Mac. Your projects, code, threads, and messages are stored on your Mac and are never sent to us. This policy explains the small amount of data that does leave your devices, who receives it, and the choices you have.

This policy covers:

- **Owlto for Mac**, the desktop app.
- **Owlto for iPhone and iPad**, the app that pairs with your Mac (Remote Router).
- **The Owlto relay** at `relay.owlto.dev`, which connects your phone to your Mac over the internet.
- **This website**, `owlto.dev`.

Owlto is developed by the Owlto developers. Questions about this policy go to [support@owlto.dev](mailto:support@owlto.dev).

## The short version

- We do not sell your data, show ads, or track you across other companies' apps or websites.
- Your projects, code, threads, and messages stay on your Mac. When your phone talks to your Mac, the connection is end-to-end encrypted, so even our relay cannot read it.
- The iPhone and iPad app has no analytics, no account, and no tracking.
- The Mac app sends anonymous usage counts so we know which features are used. You can turn this off at any time.
- The relay keeps the minimum it needs to connect your devices, plus your GitHub username if you sign in to use it.

## Owlto for Mac

**Your work stays local.** Projects, threads, worker output, notes, and settings are stored in Owlto's data folder on your Mac. We do not run a server that receives them.

**Coding agents and model providers.** Owlto runs the coding agents you install and sign in to yourself, such as Claude Code, Codex, and Cursor, and, if you set one up, a model provider for the built-in Router engine. What you send to those agents, including your prompts and code, goes to those companies under their own terms and privacy policies. Owlto does not copy your passwords or sign-in tokens for those services.

**Anonymous usage data.** Release builds send anonymous usage events to PostHog, an analytics service, so we can see which features are used and run feature experiments. This is on by default, and you can turn it off in **Settings → Updates → Share anonymous usage data**. While it is off, nothing is sent.

- Events record actions, such as "app opened", "thread created", "message sent", "worker started", "project added", or "agent connected".
- Each event carries a random install ID that is created on your Mac and is not linked to any account, along with the app version, macOS version, processor type, app language, and which kinds of agents are connected.
- Events never include message text, code, file names, paths, project names, or anything else you type.
- PostHog receives your IP address with each request and may use it to estimate an approximate location, such as your country or city.

**GitHub.** If you connect a GitHub account, the token is stored on your Mac and is used only to talk to GitHub on your behalf, for example to clone repositories or file feedback.

**Feedback.** When you send feedback from the app, it is filed as an issue in Owlto's public GitHub repository, either as your GitHub account or through a prefilled page you submit yourself. Anything you write there is public. If you choose to include diagnostics, they add the app version, macOS version, processor type, and Electron version.

**Updates.** The app checks GitHub Releases for new versions. GitHub receives a normal web request from your Mac, including your IP address.

## Owlto for iPhone and iPad

The phone app is a remote control for your Mac. Your Mac keeps all the data and runs every worker. The phone shows what your Mac sends it and does not keep threads after you close them.

- **No analytics or tracking.** The app contains no analytics, advertising, or tracking code, and you do not need an account to use it.
- **Stored on your device.** The list of Macs you paired with (their names and addresses), the encryption keys for those pairings (in the iOS Keychain), and your style setting. Deleting the app removes them.
- **Camera.** Used only to scan the pairing QR code your Mac shows. Camera images are not saved or sent anywhere.
- **Local network.** Used to connect directly to your Mac on your network or over a VPN such as Tailscale.
- **Photos and files.** Only the photos and files you pick to attach are read, and they are sent, encrypted, to your Mac.
- **Notifications.** If you allow notifications, your phone's push token is shared with your paired Mac. Your Mac seals each notification with a key that only your phone holds and sends it through the relay to Apple's push notification service. The relay and Apple cannot read the notification's content. Apple processes the token and delivery under its own privacy policy.

## The Owlto relay

The relay lets your phone reach your Mac when they are not on the same network. It runs on Cloudflare. It is only used if you turn on internet connections in the Mac app.

**What the relay cannot see.** Everything between your phone and your Mac is end-to-end encrypted. The relay passes encrypted data along and cannot read your messages, threads, code, files, or notifications. Pairing codes never reach the relay.

**What the relay processes and keeps:**

- **Account.** To turn on the relay, you sign in with GitHub on your Mac. The relay checks with GitHub who you are, then discards the GitHub token. It keeps a hashed account ID, your GitHub username, how many Macs and sign-in sessions you have, and when the account was created and last used. Sign-in sessions are stored only as hashes and stop working after 180 days without use.
- **Connections.** Hashed secrets for each Mac's mailbox and each paired device, so only your devices can connect.
- **Offline messages.** If your Mac is away, your phone can leave encrypted messages for it. They are deleted when your Mac collects them, or after 7 days.
- **Notifications.** The relay forwards sealed notifications to Apple and does not store push tokens.
- **Network data.** Like any internet service, the relay sees IP addresses, connection times, and the size of the data passing through. IP addresses are used for rate limiting and abuse prevention and are not kept in our records. Cloudflare may keep limited request logs under its own policy.

A Mac's mailbox and its queued messages are deleted automatically after 30 days without that Mac connecting. You can sign out of the relay or remove a Mac in the Mac app's Devices settings, which cuts off access immediately.

## This website

`owlto.dev` is a static website. It sets no cookies and uses no analytics or advertising scripts. Your light or dark theme choice is saved in your browser's local storage and never leaves your device. The site is served by Cloudflare, which processes requests, including IP addresses, to deliver pages and protect against abuse.

## Who receives data

We share data only with the services that run Owlto, and only for the purposes above:

| Service | What for | Data |
| --- | --- | --- |
| Cloudflare | Hosting the relay and website | IP addresses, encrypted relay traffic, the relay account records above |
| PostHog | Anonymous usage data from the Mac app | Install ID, usage events, IP address |
| Apple | Delivering notifications to your phone | Push token, sealed notifications |
| GitHub | Relay sign-in, feedback, updates, and features you connect | As described above |

We do not sell or rent personal information, and we do not share it for advertising. We may disclose information if required by law.

## Your choices and rights

- Turn off usage data in the Mac app: **Settings → Updates → Share anonymous usage data**.
- Unpair your phone, sign out of the relay, or remove a Mac in the Mac app's Devices settings.
- Delete the phone app to remove everything it stored on your phone.
- Email [support@owlto.dev](mailto:support@owlto.dev) to ask what we hold about you, or to delete your relay account record. Depending on where you live, you may have rights to access, correct, delete, or object to the processing of your personal data; we will honor these requests.

## Data location

Our service providers may process data in the United States and other countries where they operate. We rely on their safeguards for international transfers.

## Children

Owlto is a developer tool and is not directed at children under 13. We do not knowingly collect personal information from children.

## Changes to this policy

If this policy changes, we will update this page and the date at the bottom. For significant changes, we will also note them in the [changelog](/changelog/).

## Contact

[support@owlto.dev](mailto:support@owlto.dev)
