# RFC: 全局 Thread 与 Thread 间转发

状态：已实现。日期：2026-11-06。基线：`e3f59df`。

本文替换 [RFC_OWLS_ROUTER_SHELL.md](RFC_OWLS_ROUTER_SHELL.md) 的两条非目标（全局 Router、一个项目多段对话），
以及「每个项目一个 Router」的决策。Router 引擎、Inbox、批次和 Worker 的设计不变。

## 1. 决策

1. **Thread 是全局的。** 一个 thread 就是一段对话和它自己的 Router，代码里仍叫 `router`、`routerId`。
2. **项目是派发时的参数。** `CodexRouter.projectId` 只是默认项目，可以为空。`dispatch_task` 按
   `project`、父 Worker 的项目、默认项目、唯一项目的顺序决定在哪个项目运行，都没有时返回 `project_required`。
3. **Worker 属于项目。** `RouterWorker.projectId` 必填。同一 checkout 的写入者按项目串行，不按 thread，
   否则同一项目的两个 thread 会同时写一个 checkout。
4. **转发存冻结的副本，不存活引用。** 内容复制到目标 thread，同时记录来源，走 Inbox，所以三个引擎都不用改。
5. **不做向后兼容。** 产品未发布。Drizzle 迁移已重建成一份 `0000_init.sql`，旧数据库不能继续使用，
   也去掉了只为旧数据行存在的 zod 默认值、`workerProvider` 迁移和旧任务过滤。

非目标：thread 改名、归档和删除；thread 之间互相读取；多设备同步和云端 Router 的实现。

## 2. 存储

```text
codex_sync_state    一行，全局递增的版本号
codex_threads       id, rev, updated_at, value（CodexRouter，不含 items）
codex_thread_items  thread_id, item_id, position, rev, value（CodexItem）
```

- `RouterStore.saveThread` 在一个事务里取下一个版本号，写入 thread 和本次变化的条目。写入都走同一个连接，
  所以版本按顺序提交，读者按「上次看到的版本之后」读取不会漏数据。这是以后同步用的游标。
- 条目在 thread 第一次用到时才加载（`ThreadLog`）。`snapshot` 和 `router` 事件不再带条目，
  只带 `itemCount` 和 `preview`，thread 再多也不会拖慢启动。
- 流式中的条目 `rev` 为 null，只通过 `thread-items` 事件发给 renderer，不写库，完成时写一次。
  因此崩溃会丢掉还没完成的那条条目，模型 transcript 不受影响。
- renderer 在 `items` 里按 thread 保存条目。`threadItems` 取到的页面可能比途中到达的事件旧，
  所以合并时不覆盖未保存的条目和更高版本的条目。

暂未加入：条目删除（墓碑）、`codex_workers` 的版本号。多设备同步时再加。

## 3. 项目列表

项目超过一个时，批次开头列出 `Projects:`。列表写在 `router.projectsShown`，只在变化后重复，保持请求前缀稳定。
需要状态摘要的上下文（换引擎、裁剪）从 `stateOf` 读到同样的列表，Worker 行也会带上项目名。
一个 thread 的引擎 `cwd` 创建后不变，因为原生会话按它恢复。没有默认项目时用数据目录下的 `router-threads`。

## 4. 转发

`codex:router-forward` 的来源是一个条目（`user`、`assistant`、`forward`）或一个有汇报的 Worker，
目标是已有 thread 或新 thread。

1. 目标 thread 写入 `forward` 条目：`text` 是冻结的内容，`detail` 是用户的说明，`forward` 记录来源。
2. Inbox 写入 `forwarded` 事件并唤醒 Router。只有说明算用户的指令，转发内容是参考资料（提示 v8）。
3. `commandId` 保证幂等：新 thread 的 ID 就是它，重复调用会找到同一个 thread。

转发了 Worker 结果后，目标 Router 可以把这个 Worker 作为 `parent`，并用 `base: 'parent'` 从它的分支继续。
它不能给这个 Worker 发消息或停止它。父分支已被删除时回退到 HEAD：只有分支上没有 HEAD 缺少的内容时，
Owls 才会删除它。

## 5. 界面

- 侧边栏：新对话（`⌘N`）、全景、thread 列表、项目列表。点项目打开它最近的 thread，没有时进入新对话。
- 新对话在第一条消息发送时才创建，编辑行可以选默认项目。没有任何项目时，发送仍会询问文件夹。
- 全景继续按项目分组，节点显示该项目最近的 thread。
- 转发入口：消息行悬停时的按钮，以及 Worker 详情标题栏。

## 6. 后续

多设备的方向：每台设备只跑自己的 Router，thread 只由所属设备写入，其他设备按 `rev` 拉取后只读显示；
跨设备派 Worker 时，把命令发给目标设备上的 Owls。Router 不上云。
展开设计见 [RFC_OWLS_MULTI_DEVICE.md](RFC_OWLS_MULTI_DEVICE.md)。
