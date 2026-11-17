---
title: Owlto 故障排查
navTitle: 故障排查
description: 解决 Owlto 找不到智能体、协调者未设置、Worker 不启动或缺文件、合并冲突、Pull requests 页面为空等常见问题。
group: reference
order: 2
updated: 2026-11-16
related: connect-agents, projects-and-worktrees, review-and-merge
footer: true
---

## 快速定位

| 你看到的情况 | 查看 |
| --- | --- |
| “未找到 Claude Code”“未找到 Codex”或“未找到 Cursor CLI” | [找不到智能体](#找不到智能体) |
| 智能体显示**未登录** | [智能体未登录](#智能体未登录) |
| “为协调者选择模型”或“为协调者连接 …” | [协调者未设置](#协调者未设置) |
| “连接一个编码 Agent 以运行 Worker” | [没有可运行 Worker 的智能体](#没有可运行-worker-的智能体) |
| 协调者引擎列表里没有 Cursor | [Cursor 不能运行协调者](#cursor-不能运行协调者) |
| Worker 在排队而不是运行 | [Worker 排队或一次只运行一个](#worker-排队或一次只运行一个) |
| Worker 找不到文件、`.env` 或依赖 | [Worker 缺少文件](#worker-缺少文件) |
| Worker 的改动不在你的工作副本里 | [改动不在我的工作副本里](#改动不在我的工作副本里) |
| 合并时 git 报冲突 | [Worker 之间的合并冲突](#worker-之间的合并冲突) |
| Pull requests 页面是空的 | [Pull requests 页面为空](#pull-requests-页面为空) |
| `~/Owlto/worktrees` 占用的磁盘越来越多 | [旧 worktree 占用空间](#旧-worktree-占用空间) |

## 找不到智能体

Owlto 会在 `PATH` 和常见安装目录（如 `~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`）中查找。它不读取你的 shell 配置文件，所以写在 `~/.zshrc` 里的 `PATH` 修改可能不会生效。

1. 在终端里确认已安装：`claude --version`、`codex --version` 或 `cursor-agent --version`。
2. 找到它的位置：`which claude`（或 `codex`、`cursor-agent`）。
3. 在**设置 → Agents** 中打开该智能体的标签页，点击**位置**旁的**选择文件**，选中这个文件。
4. 点击**连接**。

## 智能体未登录

- **Claude Code**：在终端运行 `claude` 并登录，输入 `/exit` 退出，再在 Owlto 中点击**重新连接**。
- **Codex**：在 Codex 标签页点击**使用 ChatGPT 登录**，或在终端运行 `codex` 登录。
- **Cursor**：在终端运行 `cursor-agent login`，再点击**重新连接**。

已连接但未登录的智能体不能接任务。

## 协调者未设置

输入框上方的提示会说明缺少什么：

- **为协调者选择模型**：内置引擎还没有配置模型。打开**设置 → 协调者与 Worker → 协调者**，添加模型提供方、模型和 API key，或本地 OpenAI 兼容端点。
- **为协调者连接 Claude Code** 或**为协调者连接 Codex**：所选引擎对应的智能体没有连接。连接它，或换一个引擎。如果另一个引擎已就绪，提示里会提供一键切换。

见[连接编程智能体](/docs/connect-agents/#选择由谁运行协调者)。

## 没有可运行 Worker 的智能体

“连接一个编码 Agent 以运行 Worker”表示没有连接任何能运行 Worker 的智能体。在**设置 → Agents** 中连接 Claude Code、Codex 或 Cursor。如果项目在**编码 Agent** 中勾选了特定智能体，其中至少要有一个已连接。

## Cursor 不能运行协调者

这是预期行为。Cursor 只能运行 Worker。协调者请使用 Claude Code、Codex 或内置引擎。

## Worker 排队或一次只运行一个

- 最多同时运行 4 个 Worker，其余的排队，有空位时依次开始。
- 当项目不是 git 仓库、还没有提交，或**改代码的 Worker 并行运行**已关闭时，改代码的 Worker 会共用项目文件夹，因此一次只运行一个。先做一次初始提交，或在**设置 → 协调者与 Worker** 中重新开启该设置。

## Worker 缺少文件

worktree 里只有已提交的文件。未提交的改动、`.env` 等被忽略的文件，以及 `node_modules` 等依赖都不会被复制。

- 提交 Worker 需要的文件，或者
- 在需求里告诉 Worker 如何准备环境（例如“先运行 pnpm install；把 .env.example 复制为 .env”），或者
- 如果任务确实需要你未提交的工作，让协调者在你的工作副本里运行它。

每个 Worker 都要执行的准备步骤，适合写在项目的**任务说明**里。

## 改动不在我的工作副本里

这是设计如此。每个改代码的 Worker 都提交到自己的 `owlto/w_…` 分支。合并这个分支，或创建 Pull Request。见[审阅并合并 Worker 的结果](/docs/review-and-merge/)。

## Worker 之间的合并冲突

独立分支无法阻止两个 Worker 修改同一处代码。在编辑器里解决冲突，或让协调者派一个 Worker 来解决。为了避免冲突，拆分任务时让它们修改不同的文件，或者让第二个任务从第一个 Worker 的分支开始。

## Pull requests 页面为空

- 在**设置 → GitHub** 中连接 GitHub。使用 Owlto GitHub App 时，还要把它安装到该仓库。
- 项目的远程仓库必须在 github.com 上。
- 只会列出来自 Worker 分支、或写在 Worker 汇报里的 PR。
- 确认**设置 → GitHub** 中的 **Pull requests 页面**已开启。

## 旧 worktree 占用空间

worktree 在你移除 Worker 或删除对话时才会删除，而不是在 Worker 完成时。移除已完成的 Worker，并对**保留的 worktree** 中不再需要的条目点击**丢弃**。丢弃会删除该 worktree 中未提交的工作。

## 仍然没解决？

在 Owlto 中选择**帮助 → 反馈问题…**，或[在 GitHub 上提交 issue](https://github.com/jackeydou/Owls/issues)。issue 是公开的：请不要包含密码、令牌、私有代码或其他个人信息。
