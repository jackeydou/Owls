# App Store submission — Owlto for iPhone and iPad

What App Store Connect asks for, with the answers for this app. Keep it current when the
app's data handling, capabilities, or listing change. The privacy answers here must agree
with `Owlto/PrivacyInfo.xcprivacy` and the website's privacy policy
(`apps/owlto-website/src/legal/*/privacy.md`).

## Before the first submission

- [ ] Deploy the website so the URLs below are live: `pnpm --filter owlto-website deploy:cf`.
- [ ] Set up `support@owlto.dev`: Cloudflare dashboard → `owlto.dev` → Email → Email
      Routing → add a custom address `support` that forwards to your own mailbox. Send a
      test email.
- [ ] Add an APNs auth key to the production relay (`packages/owlto-relay/README.md`,
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
| Copyright | `2026 The Owlto developers` |

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
regulations" page and the BIS guidance before answering. Once decided, add
`ITSAppUsesNonExemptEncryption` to the build settings (`INFOPLIST_KEY_...`) so each
upload stops asking.

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

### English

- **Name:** Owlto Remote
- **Subtitle:** Your Mac's agent team, anywhere
- **Promotional text:** Message your Mac's Router from your phone, follow every worker,
  and answer their questions, while your own coding agents do the work at home.
- **Keywords:** `ai,agent,coding,remote,developer,router,worker,git,code review,automation,mac,terminal`
- **Description:**

> Owlto Remote puts your Mac's agent team in your pocket.
>
> Owlto is a free, open-source Mac app that runs your coding agents as one team: a Router
> owl plans the work, dispatches workers, and reports back. With Owlto Remote, you can do
> all of that from your iPhone or iPad.
>
> • Message the Router from anywhere and start new work.
> • Follow every worker live and see what changed.
> • Answer the questions and approvals workers ask for, without walking back to your desk.
> • Get notified when a worker finishes or needs you.
>
> Private by design
> Your projects, code, and threads stay on your Mac. Your phone connects to it directly on
> the same network, or through the Owlto relay with end-to-end encryption, so the relay
> cannot read anything. The app has no account, no analytics, and no tracking.
>
> Requirements
> A Mac running Owlto (https://owlto.dev) with Claude Code, Codex, or Cursor installed and
> signed in. The Mac stays on with Owlto open. Pair once by scanning a QR code.

### 简体中文

- **名称：** Owlto Remote
- **副标题：** 随时指挥 Mac 上的智能体团队
- **推广文本：** 在手机上给 Mac 的 Router 发消息、跟进每个 Worker、回答它们的问题，实际工作由你 Mac 上的编程智能体完成。
- **关键词：** `ai,智能体,编程,远程,开发者,代码,router,worker,git,代码审查,自动化,mac`
- **描述：**

> Owlto Remote 把你 Mac 上的智能体团队装进口袋。
>
> Owlto 是一款免费开源的 Mac 应用，把你的编程智能体组织成一个团队：Router 猫头鹰负责规划、派发
> Worker 并汇报结果。有了 Owlto Remote，这一切都可以在 iPhone 或 iPad 上完成。
>
> • 随时随地给 Router 发消息，开始新的工作。
> • 实时跟进每个 Worker，查看改动。
> • 直接回答 Worker 的提问和审批请求，不用回到电脑前。
> • Worker 完成或需要你时收到通知。
>
> 隐私优先
> 你的项目、代码和对话都留在你的 Mac 上。手机在同一网络下直接连接 Mac，或通过端到端加密的 Owlto
> 中继连接，中继无法读取任何内容。应用不需要账号，没有统计分析，也没有追踪。
>
> 使用要求
> 一台运行 Owlto（https://owlto.dev）的 Mac，并已安装和登录 Claude Code、Codex 或 Cursor。Mac
> 需保持开机并打开 Owlto。扫码配对一次即可。

## Screenshots

The target supports iPhone and iPad (`TARGETED_DEVICE_FAMILY = 1,2`), so both sets are
required:

- iPhone 6.9" display: 1320 × 2868 (or 1290 × 2796), portrait, 3–10 images.
- iPad 13" display: 2064 × 2752 (or 2048 × 2732), 3–10 images.

Take them in the simulator against the dev host (`scripts/dev-host.mjs`) so the sample
threads look real and show no private paths: Threads list, a thread with a worker
running, a worker's changes, an approval request, pairing, and Devices. Do English and
Simplified Chinese sets if possible.
