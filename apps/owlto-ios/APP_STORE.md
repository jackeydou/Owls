# App Store submission — Owlto for iPhone and iPad

What App Store Connect asks for, with the answers for this app. Keep it current when the
app's data handling, capabilities, or listing change. The privacy answers here must agree
with `Owlto/PrivacyInfo.xcprivacy` and the website's privacy policy
(`apps/owlto-website/src/legal/*/privacy.md`).

## Before the first submission

- [x] Deploy the website so the URLs below are live: `pnpm --filter owlto-website deploy:cf`.
- [x] Set up `support@owlto.dev`: Cloudflare dashboard → `owlto.dev` → Email → Email
      Routing → add a custom address `support` that forwards to your own mailbox. Send a
      test email.
- [x] Add an APNs auth key to the production relay (`packages/owlto-relay/README.md`,
      "Push"), or notifications will not arrive in TestFlight or App Store builds.
- [ ] Set the App Store link in the Mac app's pairing wizard ("Get Owlto on your iPhone")
      once the App Store ID exists.

## App information

| Field | Value |
| --- | --- |
| Bundle ID | `app.owlto.mobile` (cannot change after the first upload) |
| SKU | `app.owlto.mobile` (internal only, cannot change) |
| Primary language | English (U.S.); add Simplified Chinese as a localization |
| Category | Developer Tools (secondary: Productivity) |
| Price | Free, no in-app purchases |
| Privacy Policy URL | https://owlto.dev/privacy/ |
| Support URL | https://owlto.dev/support/ |
| Marketing URL | https://owlto.dev/ |
| Copyright | `2026 Owlto Team` (matches the Mac app's electron-builder `copyright`) |

## App Privacy ("nutrition label")

Answer **"No, we do not collect data from this app"** → label shows **Data Not Collected**.

Why this is accurate under Apple's definition (data sent off the device in a way the
developer or partners can access beyond servicing the request in real time):

- No analytics, ads, crash reporting, or third-party SDKs in the app.
- Messages, attachments, and notifications are end-to-end encrypted between the phone and
  the user's own Mac. The relay forwards ciphertext and cannot read it; sealed offline
  messages are unreadable to us and deleted within 7 days.
- The push token goes to the user's own Mac, not to us; the relay forwards it to APNs
  without storing it.
- The relay's GitHub account records come from the **Mac** app's sign-in, not the phone.
- IP addresses are used only transiently for rate limiting.

If the app ever adds analytics, crash reporting, or an account, update this answer, the
privacy manifest, and the privacy policy together.

Tracking: **No**. No App Tracking Transparency prompt is needed.

## Privacy manifest

`Owlto/PrivacyInfo.xcprivacy` (joins the app target automatically): no tracking, no
collected data types, and one required-reason API, `UserDefaults` with reason `CA92.1`
(the app's own settings: paired devices, style). The notification extension uses only
the Keychain, which needs no declaration. If you add file timestamp, disk space, system
boot time, or active keyboard APIs, declare them there.

## Export compliance (encryption)

The app implements its own end-to-end encryption with standard algorithms (X25519,
HKDF-SHA256, AES-256-GCM, scrypt), not only Apple's HTTPS. In App Store Connect:

- "Does your app use encryption?" → **Yes**.
- Choose the option for **standard encryption algorithms** (not proprietary, not only
  Apple's OS encryption).
- Owlto's source, including this encryption, is public under AGPL-3.0, which is relevant
  to US export rules for publicly available encryption source code.
- France distribution may ask for a declaration; the simplest path is to exclude France
  until that is settled, or file it.

This is a legal determination. If unsure, check Apple's "Complying with encryption export
regulations" page and the BIS guidance before answering.

Decided (2026-11-28): the app is **not distributed in France**, so no documentation is
needed, and the app target sets `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO` so
uploads stop asking the encryption and France questions. Keep France out of the app's
availability. To distribute there, file the French declaration in App Store Connect first,
then set the key to `YES` and add `ITSEncryptionExportComplianceCode` with the code App
Store Connect issues.

## Age rating

Answer "None" to every content question (no violence, gambling, mature themes, medical
content), no unrestricted web browser, no user-to-user messaging (the phone only talks to
the user's own Mac). Expected rating: **4+**. If the questionnaire asks about AI-generated
content, answer honestly: the app shows output from coding agents the user runs on their
own Mac.

## App Review

The biggest rejection risk is **Guideline 2.1 (App Completeness)**: the reviewer has no
Mac running Owlto, so they cannot pair. Prepare before submitting:

1. A screen recording (1–3 minutes) on a real iPhone: open Owlto on the Mac → Settings →
   Devices → pair by QR → send the Router a message → follow a worker → answer a request →
   receive a notification. Upload it as an unlisted link or attach it in the review notes.
2. Optionally, a reachable demo host: run `apps/owlto-ios/scripts/dev-host.mjs` on an
   always-on machine with the production relay, and give the reviewer a pairing invite.
   Check how long an invite stays valid before relying on this.

Review notes draft:

> Owlto for iPhone is a companion app for Owlto, a free open-source Mac app
> (https://owlto.dev) that runs AI coding agents. The phone pairs with the user's own Mac
> by scanning a QR code shown in Owlto → Settings → Devices, then lets the user message
> the Mac's Router, follow workers, and answer their questions. All work runs on the
> user's Mac; the connection is end-to-end encrypted. There is no account and no sign-in
> on the phone. A video of the full flow is at: <link>. Camera access is used only to
> scan the pairing QR code; local network access is used to reach the paired Mac.

Sign-in information: **not required** (uncheck "Sign-in required").

## Listing copy

Limits: name 30, subtitle 30, promotional text 170, keywords 100 (comma separated, no
spaces needed), description 4,000 characters. Keep third-party product names (Claude
Code, Codex, Cursor) out of the name, subtitle, and keywords (Guideline 2.3.7); the
description may mention them factually.

This copy is marketing for people who know nothing about how Owlto works inside: lead
with the super agent (stop switching between AI agents) and privacy (end-to-end
encrypted, your work stays on your Mac). Keep internal terms such as Router, Worker,
relay, and worktree out of it; they belong in the review notes, not the listing.

### English

- **Name:** Owlto Remote
- **Subtitle:** Your private AI super agent
- **Promotional text:** Stop switching between AI agents. Owlto turns them into one super agent you can direct from your phone, private by design and end-to-end encrypted.
- **Keywords:** `ai,agent,ai agent,super agent,assistant,automation,productivity,coding,privacy,encrypted,mac`
- **Description:**

> Stop switching between AI agents.
>
> Owlto brings all your AI agents together as one super agent. Say what you want in plain words. Owlto picks the right agent for each part of the job, keeps everything moving, and tells you when it's done.
>
> Owlto Remote puts that super agent in your pocket.
>
> • Just say what you need: start new work from anywhere, in one conversation.
> • See progress at a glance: what's running, what's finished, and what needs you.
> • Decide in a tap: approve or answer when your agent asks, without going back to your desk.
> • Never miss a moment: get notified as soon as something is done or needs your call.
>
> Private by design
> Your work stays on your own Mac. Everything between your phone and your Mac is end-to-end encrypted, so no one in between can read it, not even us. No account, no ads, no tracking.
>
> What you need
> Owlto Remote works with the free Owlto app on your Mac. Install it, scan a QR code once, and you're connected.

### 简体中文

- **名称：** Owlto Remote
- **副标题：** 你的私人 AI 超级智能体
- **推广文本：** 别再在各种 AI 智能体之间来回切换。Owlto 把它们变成一个超级智能体，在手机上随时指挥；端到端加密，隐私优先。
- **关键词：** `ai,智能体,超级智能体,ai助手,自动化,效率,编程,隐私,加密,远程,mac,工作流`
- **描述：**

> 别再在各种 AI 智能体之间来回切换了。
>
> Owlto 把你所有的 AI 智能体整合成一个超级智能体。用一句话说出你想做的事，它会把每件事交给最合适的智能体，全程推进，做完告诉你。
>
> Owlto Remote 把这个超级智能体装进你的口袋。
>
> • 说一句就开工：随时随地，在一个对话里开始新工作。
> • 进度一目了然：哪些在做、哪些完成、哪些在等你，一眼看清。
> • 一点就决定：智能体需要你确认或回答时，在手机上点一下就好，不用回到电脑前。
> • 不错过任何进展：事情做完或需要你拍板时，第一时间通知你。
>
> 隐私优先
> 你的工作始终留在你自己的 Mac 上。手机和 Mac 之间的所有内容都端到端加密，中间任何人都无法读取，包括我们。不需要账号，没有广告，没有追踪。
>
> 使用要求
> Owlto Remote 需要搭配 Mac 上的免费应用 Owlto 使用。安装后扫码配对一次即可连接。

## Screenshots

The target supports iPhone and iPad (`TARGETED_DEVICE_FAMILY = 1,2`), so both sets are
required:

- iPhone: App Store Connect asks for the 6.1"/6.3" set (1206 × 2622); a 6.9" set
  (1320 × 2868) is there too in case the 6.9" tab is offered. Portrait, 3–10 images.
- iPad 13" display: 2064 × 2752, 3–10 images.
- iPhone Duo: `duo-outer-*` is the closed pose's outer screen (1398 × 2034, portrait) and
  `duo-inner-*` the open pose's inner screen (2853 × 2007, landscape, two columns). Upload
  whichever the Duo tab accepts.

Ready-made sets are in `app-store/` (not part of any build):

- `app-store/screenshots/{iphone-6.3,iphone-6.9,ipad,duo-outer,duo-inner}-{en,zh}/` — captioned, upload in file order. English
  goes to the English (U.S.) localization, `zh` to Simplified Chinese.
- `app-store/artwork/artwork-{5244x2950,3840x1646}-{en,zh}.png` — promotional artwork
  for the header and search-result slots (the Creative assets drop zone): the three owls
  from the app icon between two iPhones, no text, so App Store overlays stay readable.
- `app-store/raw/` — the same screens without captions, if you prefer plain screenshots.
- `app-store/app-icon-1024.png` — the 1024 × 1024 icon (no alpha); Xcode uploads it from
  the asset catalog, this copy is for reference. It is the desktop's
  `resources/app-logos/lean-cream.svg` cropped to its tile (`viewBox="100 100 824 824"`),
  with the corner radius and hairline outline removed, rendered opaque: iOS rounds the
  corners itself and rejects icons with transparency.

They were taken in the iOS 27.0 simulator against `scripts/dev-host.mjs` (sample threads
with English copy for the `en` set, device name `MacBook Pro`), with the status bar fixed
at 9:41. The Duo sets need a build from Xcode 27.1 or later and the
`iOS-27-2-iPhone19-4` runtime; the iPhone and iPad sets were taken on iOS 27.0. The Devices tab is left out because it shows the dev host's `127.0.0.1` address.
To retake them, pair a simulator with the dev host and use the `DevLaunch.swift` launch
arguments (`-OwltoDevOpen thread|worker|sheet`, `-OwltoDevTab inbox`, `-skin doodle`).

## Building the upload

The app uses iOS 27.1 SDK APIs (`toolbarVerticalEdge`, `reservedRegions`), so archive
with Xcode 27.1 or later; Xcode 27.0 fails to compile `Adaptive.swift` and
`ThreadsView.swift`. Archive the Release configuration (Product → Archive), then
Distribute App → App Store Connect. `MARKETING_VERSION` is `0.1.0` and
`CURRENT_PROJECT_VERSION` is `1`; bump the build number for each later upload.

### TestFlight in one command

`pnpm ios:testflight` (`scripts/testflight.mjs`) archives, uploads, waits for Apple to
process the build, fills in "What to Test", submits the build for Beta App Review, and adds
it to the external tester group:

```bash
pnpm ios:testflight --notes "What changed in this build"
```

It picks the build number itself (the highest one in App Store Connect plus one, passed to
`xcodebuild`), so the project's `CURRENT_PROJECT_VERSION` stays as it is. `--build <n>`
distributes a build that is already uploaded, `--upload-only` stops after the upload, and
`--no-review` stops before review and the group.

Signing and the upload use the Apple ID that Xcode is signed in to (automatic cloud signing,
as in "By hand" below); cloud-managed distribution certificates are not available to an App
Manager API key. The API key only drives the App Store Connect API.

One-time setup, on the machine that ships (with Xcode signed in to the team's Apple ID):

1. App Store Connect → Users and Access → Integrations → App Store Connect API: create a
   key with the App Manager role and save it as
   `~/.appstoreconnect/private_keys/AuthKey_<KEY ID>.p8`.
2. Write `~/.appstoreconnect/owlto-testflight.json` with the key's ids and the external
   group's name: `{ "keyId": "...", "issuerId": "...", "group": "..." }`.

The script relies on `ITSAppUsesNonExemptEncryption` in the build settings (see "Export
compliance" above). Without that key App Store Connect asks the encryption and France
questions for every build, only its web page can answer them, and the script stops at
"missing export compliance".

### By hand

From the command line (Xcode signed in to the team's Apple ID; automatic signing with
`-allowProvisioningUpdates` creates the distribution signing in the cloud):

```bash
env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin USER="$USER" xcodebuild -project apps/owlto-ios/Owlto.xcodeproj -scheme Owlto -configuration Release -destination 'generic/platform=iOS' -archivePath build/Owlto.xcarchive -allowProvisioningUpdates archive
```

```bash
env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin USER="$USER" xcodebuild -exportArchive -archivePath build/Owlto.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath build/export -allowProvisioningUpdates
```

`ExportOptions.plist` sets `method` = `app-store-connect`, `destination` = `upload`,
`signingStyle` = `automatic`, `teamID` = `9SS2Q95YZN`. The export uploads the build;
it shows up in TestFlight after Apple finishes processing it.
