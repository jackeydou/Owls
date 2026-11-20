---
title: Owlto 支持
navTitle: 支持
description: 获取 Owlto Mac 版和 iPhone 与 iPad 版的帮助：配对手机、连接问题、通知，以及如何联系开发者。
order: 2
updated: 2026-11-20
---

## 联系我们

- **邮箱：** [support@owlto.dev](mailto:support@owlto.dev)。我们通常会在几个工作日内回复。
- **问题反馈和功能建议：** [GitHub Issues](https://github.com/jackeydou/Owls/issues)。issue 是公开的，请不要在那里发布隐私信息。
- **Mac 版使用指南：** 参见[文档](/docs/)，可以从[安装 Owlto](/docs/install/)和[故障排查](/docs/troubleshooting/)开始。

报告问题时，请附上 Mac 上的 Owlto 版本（**Owlto → 关于 Owlto**）、macOS 和 iOS 版本，以及你预期的结果。

## iPhone 与 iPad 版能做什么

Owlto iPhone 与 iPad 版是你 Mac 上 Router 的遥控器。你可以在手机上给 Router 发消息、跟进 Worker、查看改动、回答 Worker 提出的问题，而实际工作由你的 Mac 用你自己的编程智能体完成。

你需要：

- 一台运行 Owlto 的 Mac。Mac 需要保持开机、不休眠，并且 Owlto 处于打开状态。
- 一台运行 iOS 17 或更高版本的 iPhone 或 iPad。

手机应用免费，且不需要账号。

## 配对手机

1. 在 Mac 上打开 Owlto，进入 **设置 → 设备**，打开 **开启设备连接**。
2. 选择手机的连接方式：
   - **同一网络：** 手机和 Mac 连接同一个 Wi-Fi，或在同一个 VPN（如 Tailscale）中。
   - **中继：** 手机可以在任何地方，使用蜂窝网络或任意 Wi-Fi。打开 **允许通过互联网连接**，并按提示在 Mac 上 **用 GitHub 登录**。
3. 在手机上打开 Owlto，点击 **扫描二维码**，扫描 Mac 上显示的二维码。
4. 确认两台设备上显示的六位安全码相同。如果不同，请移除设备后重新配对。

## 故障排查

### 手机连不上 Mac

- 确认 Mac 上的 Owlto 已打开，且 Mac 没有休眠。在 **设置 → 设备** 中打开 **接电时保持这台 Mac 唤醒**，可以让接通电源的 Mac 始终可连接。
- 在同一网络下，请确认手机允许 Owlto 使用本地网络：**iPhone 设置 → 隐私与安全性 → 本地网络 → Owlto**。
- 不在同一网络时，请确认已打开 **允许通过互联网连接**，并且 Mac 上显示 **已连接到中继**。
- 如果仍然不行，请在两边都移除设备，然后重新配对。

### 收不到通知

- 在 **iPhone 设置 → 通知 → Owlto** 中允许通知。
- 通知由你的 Mac 发出，所以 Mac 需要开机、不休眠，并且已连接到中继。

### 扫码时相机打不开

在 **iPhone 设置 → 隐私与安全性 → 相机 → Owlto** 中允许访问相机。相机仅用于扫描配对二维码。

### 提示"中继登录已失效"

在 Mac 上进入 **设置 → 设备**，重新用 GitHub 登录。

## 移除设备

- 在手机上打开 **设备**，选择那台 Mac 并移除。
- 在 Mac 上进入 **设置 → 设备**，移除这部手机，之后它将无法再连接。

## 隐私

你的对话和代码留在你的 Mac 上。手机与 Mac 之间的连接是端到端加密的，手机应用没有统计分析或追踪。完整内容请阅读[隐私政策](/privacy/)。
