---
title: Owlto 中的项目、Workspace 与 git worktree
navTitle: 项目、Workspace 与 worktree
description: 项目和 Workspace 文件夹如何工作，每个改代码的 Worker 如何获得自己的 git worktree 和分支，哪些内容会复制进去、哪些不会，以及 Worker 何时共用你的工作副本。
group: concepts
order: 2
updated: 2026-11-16
related: review-and-merge, parallel-tasks, troubleshooting
footer: true
---

## 术语

| 术语 | 含义 |
| --- | --- |
| 项目 | 你添加到 Owlto 的文件夹，通常是一个 git 仓库。项目也可以是大仓库里的一个子文件夹。 |
| Workspace | 存放不属于任何项目的任务的文件夹，默认是 `~/Owlto/Workspace`。 |
| 工作副本 | 你自己的项目工作目录，也就是你添加的那个文件夹。 |
| worktree | 同一个 git 仓库的另一个工作目录，在 `~/Owlto/worktrees` 下为某个 Worker 单独创建。 |
| 分支 | 每个 worktree 有自己的分支，名为 `owlto/w_` 加 8 个字符。一个 Worker、一个 worktree、一个分支。 |

## 项目

在**项目**侧栏添加项目：**打开项目**（本机已有文件夹）、**打开 GitHub 项目**（克隆到 `~/Owlto/projects`）或**快速创建**（新建一个空的 git 仓库）。

克隆时会先使用你自己的 git 配置，所以公开仓库、SSH 或钥匙串凭据不连接 GitHub 也能用。如果通过 https 克隆私有仓库失败，Owlto 会改用你在**设置 → GitHub** 中的 GitHub 连接重试。

每个项目都有自己的设置：名称、图标、颜色、帮助协调者挑选项目的描述、新 worktree 的起始分支、远程仓库、使用哪些编码 Agent，以及会加到每个 Worker 提示里的任务说明。

## Workspace

不属于任何项目的任务，比如一个小脚本或一次调研，会在 Workspace 文件夹里运行。这些任务不使用 worktree，每个任务会被要求使用一个以任务命名的子文件夹。Workspace 在项目列表和地图上排在最前面。

当 Workspace 下的某个一级文件夹变成 git 仓库时，Owlto 会提供**设为项目**，把它变成独立项目；**并回 Workspace** 则是反向操作。在**设置 → 协调者与 Worker → 工作目录**中可以更换文件夹。

## Worker 如何获得自己的副本

当一个可写的 Worker 在 git 项目中启动时，Owlto 会运行 `git worktree add`，为它创建新文件夹和新分支：

```text
~/Owlto/worktrees/<仓库名>-<id>/<worker id>     分支：owlto/<worker id>
```

分支的起点依次是：如果任务基于父 Worker，则从父 Worker 的分支开始；如果项目设置了**起始分支**，则从该分支开始（远程分支如 `origin/main` 会先拉取）；否则从你工作副本当前的 `HEAD` 开始。协调者也可以让任务从远程默认分支开始，例如为了单独开一个 PR。

由于 worktree 共享同一个仓库，Worker 的提交会作为普通分支出现在你的工作副本中。

## worktree 里有什么、没有什么

worktree 里**只有已提交的文件**。以下内容不在其中：

- 你工作副本里未提交的改动
- 被忽略的文件，例如 `.env` 和构建产物
- 已安装的依赖，例如 `node_modules`

Worker 知道这一点，会自行安装需要的东西。如果任务依赖本地密钥或未提交的工作，请先提交，或告诉 Worker 去哪里找，或者让协调者在你的工作副本里运行这个任务。

## Worker 何时共用你的工作副本

以下情况下，Worker 直接在项目文件夹里工作，不使用 worktree：

- 文件夹不是 git 仓库，或仓库还没有任何提交
- Worker 是只读的
- **设置 → 协调者与 Worker** 中的**改代码的 Worker 并行运行**已关闭
- 协调者有意选择你的工作副本，因为任务需要你未提交的改动，或者要把某个 Worker 的分支合并进来

共用项目文件夹的写入型 Worker 在同一项目中一次只运行一个，避免同时修改同一批文件。

> **重要：** worktree 用来隔离进行中的工作，不是安全边界。Worker 以你的身份在你的 Mac 上运行，权限足够时可以访问 worktree 之外的文件。只打开你信任的项目：编程智能体可能会遵循项目内保存的指令和设置。

## 独立分支与合并冲突

独立的 worktree 能防止 Worker 在工作时互相覆盖文件，但不能防止两个分支修改同一处代码。这种情况会在合并时表现为冲突，需要你或你指派的 Worker 来解决。见[审阅并合并 Worker 的结果](/docs/review-and-merge/)。
