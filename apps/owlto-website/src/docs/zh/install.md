---
title: 在 Mac 上安装 Owlto
navTitle: 安装 Owlto
description: 系统要求、下载 .dmg、更新渠道，以及 Owlto 把文件存放在哪里。
group: start
order: 1
updated: 2026-11-16
related: connect-agents, quickstart, troubleshooting
footer: true
---

## 系统要求

- 搭载 Apple 芯片（M1 及以上）的 Mac。Owlto 只提供 Apple 芯片版本，没有 Intel、Windows 或 Linux 版本。
- macOS 13 Ventura 及以上。
- 至少一个用来运行 Worker 的编程智能体：Claude Code、Codex 或 Cursor，需要你自行安装并登录。见[连接编程智能体](/docs/connect-agents/)。
- `git`。改代码的 Worker 使用 git worktree，所以你的项目最好是至少有一次提交的 git 仓库。没有 git 的文件夹也能用，但 Worker 会共用同一个文件夹。见[项目、Workspace 与 worktree](/docs/projects-and-worktrees/)。

Owlto 本身免费，并以 GNU AGPL-3.0 协议开源。各编程智能体使用你自己的账号和套餐，并遵循各自的条款。

## 下载与安装

1. [下载 Owlto.dmg](https://github.com/jackeydou/Owls/releases/latest/download/Owlto.dmg)，即最新的正式版。历史版本和测试版在 [Releases 页面](https://github.com/jackeydou/Owls/releases)。
2. 打开 `.dmg`，把 **Owlto** 拖进“应用程序”文件夹。
3. 从“应用程序”或启动台打开 Owlto。

应用经过签名并通过 Apple 公证，macOS 会像打开其他下载的应用一样打开它。

首次启动时，Owlto 会自动连接它在本机找到的智能体。如果协调者还没设置好，新对话里会出现**欢迎使用 Owlto** 引导，询问由谁运行协调者。接下来请看[连接编程智能体](/docs/connect-agents/)。

## 更新

Owlto 在启动约 30 秒后检查更新，之后每两小时检查一次。新版本会在后台下载，并在你退出应用时安装；更新就绪后，也可以点击**重启以更新**。

更新渠道有**正式版**和 **Beta** 两种。默认跟随你安装的版本：装的是 Beta 版，就继续收到 Beta 更新。要切换，打开**设置 → 更新**，修改**更新渠道**。

## 文件存放位置

| 位置 | 内容 |
| --- | --- |
| `~/.owlto` | 应用数据：数据库（`owlto.db`）、设置、附件和对话数据 |
| `~/Owlto/Workspace` | 默认的 Workspace 文件夹，存放不属于任何项目的任务 |
| `~/Owlto/projects` | 在 Owlto 里从 GitHub 克隆的仓库 |
| `~/Owlto/worktrees` | Worker 使用的 git worktree，每个 Worker 一个文件夹 |
| `~/Owlto/Notes` | 你的笔记，每条笔记是一个 Markdown 文件 |

可以在**设置 → 协调者与 Worker → 工作目录**中换一个 Workspace 文件夹。你在 Owlto 中填写的 API key（内置协调者引擎或 GitHub token）会通过 macOS 钥匙串加密保存。

## 卸载

退出 Owlto，把它从“应用程序”拖到废纸篓。这样不会删除你的数据。如果也要删除数据，删掉 `~/.owlto`；删除 `~/Owlto` 之前先检查一遍：里面有你的笔记、克隆的项目，以及可能还有未合并工作的 worktree。
