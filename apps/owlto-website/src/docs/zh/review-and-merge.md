---
title: 审阅并合并编程智能体的改动
navTitle: 审阅与合并结果
description: 查看 Worker 的 diff，在编辑器中打开它的 worktree，合并分支或创建 Pull Request，在 Owlto 中跟进 PR 状态，以及清理 worktree 和分支。
group: guides
order: 3
updated: 2026-11-16
related: projects-and-worktrees, quickstart, troubleshooting
footer: true
---

Worker 把工作提交到各自的分支上。Owlto 会告诉你改了什么，但合并始终由你决定，通过 git 或 Pull Request 完成。

## Owlto 做什么，你做什么

| 步骤 | 由谁完成 |
| --- | --- |
| 为每个改代码的 Worker 创建 worktree 和 `owlto/w_…` 分支 | Owlto |
| 修改代码并提交到该分支 | Worker |
| 推送分支或创建 Pull Request | Worker，仅在任务要求时 |
| 审阅 diff | 你，在 Owlto 或你的编辑器里 |
| 合并分支或 Pull Request | 你，或你指派的 Worker |
| 解决合并冲突 | 你，或你指派的 Worker |
| 删除 worktree 和已合并的分支 | Owlto，在你移除 Worker 或删除对话时 |

## 查看 diff

打开 Worker 面板。它改过文件时，标题处会显示新增和删除的行数。点击即可查看每个改动文件的 diff，再点一次回到对话。

Worker 的最终汇报排在它对话的最前面，并写明它使用的分支。

## 用你自己的工具打开

在 Worker 面板中使用**打开方式**，可以用已安装的编辑器或终端打开 Worker 的文件夹，例如 VS Code、Cursor、Zed、Xcode、JetBrains IDE、访达、终端、iTerm、Ghostty 或 Warp。Owlto 只列出它在你 Mac 上找到的应用。

对于使用 worktree 的 Worker，打开的是 `~/Owlto/worktrees` 下的 worktree。你可以在 Worker 的分支上运行测试或应用，而不影响自己的工作副本。注意 worktree 里只有已提交的文件，运行之前要先安装依赖。

## 合并分支

所有 worktree 都属于同一个仓库，所以 Worker 的分支在你的工作副本里本来就能看到。像合并普通本地分支一样合并它：

```bash
git switch main
git merge owlto/w_1a2b3c4d
```

也可以让协调者（Router）来做：“把 owlto/w_1a2b3c4d 合并到我的工作副本。”它会派一个 Worker 直接在你的工作副本里操作。请先提交或另行保存你自己的改动。

如果两个 Worker 改了同一处代码，第二次合并会因冲突而停下。在编辑器里解决，或者让协调者派一个 Worker 来解决。

## 创建 Pull Request

可以在需求里直接说（“……然后推送分支并创建 PR”），也可以事后再说。Worker 会使用你 Mac 上的 git 凭据推送到项目的远程仓库，并用它自己的工具（例如 `gh` CLI）创建 PR。要推送到别的远程仓库，在项目 **Git** 设置中修改**远程仓库**。团队的 PR 规范可以写在项目**任务说明**的 **Pull Request 偏好**里。

如果希望单独的 PR 从远程默认分支开始，而不是你的当前分支，可以在需求里说明（“从 origin/main 开始”），或在项目 Git 设置里设置**起始分支**。

## 在 Owlto 中跟进 Pull Request

**Pull requests** 页面列出 Worker 创建的 PR，包括状态（打开、草稿、已合并、已关闭）、合并冲突、评审结论、检查状态和最近的评论。可以按合并状态、检查结果或项目筛选，并按**需要处理**、**最近更新**、**最新创建**或**最早创建**排序。页面每分钟刷新一次。

它需要：

- 在**设置 → GitHub** 中连接 GitHub，方式可以是 Owlto GitHub App、`gh` CLI 或 Personal access token。使用 GitHub App 时，还需要把 App 安装到该仓库。
- 项目的远程仓库在 github.com 上。

**自动跟进**开启时（默认开启），Owlto 会关注 Worker 创建的未关闭 PR，并把需要处理的事件（例如合并冲突）发回创建该 PR 的 Worker，每个 PR 每天最多 8 次。可以在**设置 → GitHub** 中关闭 **Pull requests 页面**。

## 清理 worktree 和分支

worktree 会一直保留，直到你移除 Worker 或删除对话，方便你随时回来查看。清理时：

- 没有未提交改动的 worktree 会被删除。有未提交或未跟踪文件的 worktree 会保留，并列在**保留的 worktree** 中，点击**丢弃**可彻底删除。
- 只有当分支没有新提交，或者它的提交已经进入你的工作副本时，分支才会被删除，否则保留。在项目 Git 设置中开启**删除已推送的分支**后，已完整推送的分支也会被删除。

Owlto 启动时也会清理失效的 worktree 记录。
