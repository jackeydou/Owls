---
title: 在 Owlto 中连接 Claude Code、Codex 和 Cursor
navTitle: 连接编程智能体
description: 哪些智能体能运行协调者和 Worker，如何安装并连接每个智能体，如何设置内置协调者引擎，以及如何选择 Worker 权限。
group: start
order: 2
updated: 2026-11-16
related: router-and-workers, quickstart, troubleshooting
footer: true
---

Owlto 不自带编程智能体。Worker 运行在你已经在用的智能体里，使用你自己的账号。协调者（Router）可以运行在其中某个智能体里，也可以使用 Owlto 的内置引擎。

## 每个智能体能做什么

| | 运行 Worker | 运行协调者 |
| --- | --- | --- |
| Claude Code | 可以 | 可以，使用你的 Claude Code 账号 |
| Codex | 可以 | 可以，使用你的 Codex 账号 |
| Cursor | 可以 | 不可以 |
| Owlto（内置） | 不可以 | 可以，使用你提供的模型 API key 或本地端点 |

你需要至少一个已连接的智能体来运行 Worker，再加上一种运行协调者的方式：

- **有 Claude Code 或 Codex**：同一个智能体就能同时运行协调者和 Worker。
- **只有 Cursor**：Cursor 运行 Worker，协调者使用内置引擎。Cursor 不能运行协调者。

## 安装智能体

安装智能体，并在终端里登录一次。如果已经安装并登录，可以跳过这一步。

**Claude Code**

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

按提示登录，然后输入 `/exit` 退出。

**Codex**

```bash
brew install --cask codex
codex
```

用 ChatGPT 账号登录。也可以稍后在 Owlto 里点击**使用 ChatGPT 登录**。

**Cursor**

```bash
curl https://cursor.com/install -fsS | bash
cursor-agent login
```

这些命令来自各厂商自己的安装说明，可能会变化。如果某条命令失败，请使用 Owlto 中该智能体标签页上的**查看安装说明**链接。

## 在 Owlto 中连接智能体

1. 按 `⌘,` 打开**设置**，选择 **Agents**。
2. 选择智能体的标签页：**Claude Code**、**Codex** 或 **Cursor**。
3. 点击**连接**。

连接成功后，标签页会显示你当前登录的账号。Owlto 每次启动都会自动重新连接智能体，除非你点过**断开连接**。

要切换账号，先在终端里用另一个账号登录（Claude Code 运行 `claude`，Cursor 运行 `cursor-agent login`），再点击**重新连接**。

### Owlto 如何找到智能体

Owlto 先在 `PATH` 里查找每个智能体的命令，再查找常见安装目录，例如 `~/.local/bin`、`/opt/homebrew/bin` 和 `/usr/local/bin`。对于 Codex，还会检查 Codex 和 ChatGPT 应用内附带的版本。Owlto 使用它启动时拿到的 `PATH`，不会读取你的 shell 配置文件。

如果智能体装在别处，点击**位置**旁边的**选择文件**，选中可执行文件：`claude`、`codex` 或 `cursor-agent`。

## 选择由谁运行协调者

打开**设置 → 协调者与 Worker → 协调者**，选择**协调者引擎**：

- **Claude Code** 或 **Codex**：协调者使用该智能体和你在其中登录的账号。该智能体必须已连接（Codex 还需要已登录）。
- **Owlto（内置）**：协调者使用你配置的模型。选择**模型提供方**（Anthropic、OpenAI、Google、DeepSeek、OpenRouter，或自定义的 OpenAI 兼容端点），填写**模型**和 **API key**。本地端点可以不填 API key。

首次启动的引擎引导问的也是这个问题（**由谁运行协调者？**）。如果你跳过了引导，输入框上方会提示缺少什么，例如**为协调者选择模型**或**为协调者连接 Claude Code**。

无论使用哪种引擎，协调者都不会自己改文件。它只负责规划、派发 Worker 和汇报。见[协调者与 Worker](/docs/router-and-workers/)。

## 设置 Worker 的模型和权限

打开**设置 → 协调者与 Worker → Worker**，可以为每个智能体设置默认模型、推理强度（Reasoning effort）和权限。权限决定 Worker 在需要问你之前能做什么：

| 权限 | Worker 能做什么 |
| --- | --- |
| 只读 | 读取和搜索，不允许修改。 |
| 工作区访问 | 修改任务文件夹里的文件，超出范围的操作会先问你。这是默认值。 |
| 完全访问 | 在智能体允许的范围内自行操作。具体行为因智能体而异，Owlto 会在每个选项下给出简短说明。 |

**协调者**标签页里的 **Worker 最高权限**限制了协调者能授予任何 Worker 的最高权限，默认是“工作区访问”。

要指定某个项目使用哪些智能体，打开该项目的设置，进入**编码 Agent**。勾选的智能体按从上到下的顺序接任务；一个都不勾选时，任何已连接的智能体都可以接。见[跨项目并行运行任务](/docs/parallel-tasks/)。
