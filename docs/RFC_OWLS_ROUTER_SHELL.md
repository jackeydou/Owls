# RFC: 以 Router 为唯一入口的应用壳

状态：M1–M4 已实现。日期：2026-11-04。基线：`6391fb8`。

全局 thread 已替换本文「每个项目一个 Router」的模型和第 8 节的持久化说明，见
[RFC_OWLS_GLOBAL_THREADS.md](RFC_OWLS_GLOBAL_THREADS.md)。

交互原型：`output/router-prototype/`（未入库）。本文替换
[RFC_OWLS_SUPER_AGENT.md](RFC_OWLS_SUPER_AGENT.md) 中「保留直接建任务」相关的决策（第 11 节），
Router/Worker 的运行时设计继续有效。

## 1. 决策摘要

1. **用户只面对 Router。** 应用打开就是 Router 对话。删除任务列表、新建任务和任务页，
   用户不再能直接创建或驱动一个任务会话。
2. **Worker 是 Router 背后的树节点。** 一个 Worker 可以有一个父 Worker，表示「Router 基于
   父节点的结果派出了它」。
3. **全景导图是查看所有工作的唯一视图。** 所有项目和 Worker 画在同一张可缩放的图上，
   「你」在中心，第一层是项目，往外是 Worker。对话和全景是同一空间的两种距离，用缩放过渡连接。
   全景只放查看和控制，发消息仍然是发给 Router。
4. **每个项目一个 Router**，沿用现有模型。首页是对话，左侧只保留窄项目栏。
5. **Worker 没有输入框。** 用户想调整某个 Worker，就在 Router 的输入框里用 `@` 指向它，或在全景中选中它。
6. **定向消息由 Owls 直接投递，不经过 Router 模型**（第 4.4 节），保留追问直通的速度和成本优势。
7. **审批就地处理。** 对话里紧贴编辑行上方并在滚动时吸底，全景里显示在节点上，都不需要进入 Worker 详情。
8. **不做向后兼容的 UI 和 IPC。** 旧入口直接删除。持久化数据按第 8 节处理。

## 2. 目标与非目标

目标：

- 打开应用后，用户看到的只有和 Router 的对话，只有一个说话的对象。
- 一眼看到所有项目里在推进的工作、各自在做什么，并能查看完整过程和改动。
- 需要用户决定的事不会被藏起来。
- 删除只为旧任务模型存在的代码路径，让通信路径只剩一条。

非目标：

- 手动拖动节点、自定义布局。节点位置完全由程序计算。
- Worker 派生 Worker。父子关系仍由 Router 决定，Worker 之间继续互不感知。
- 把 Router 决策过程（批次、Inbox）做成用户功能。第一版的 Router 根节点详情不展示批次列表，
  否则要多一个 IPC，而用户场景尚不明确。
- 详情面板拖动调宽、多窗口。

## 3. 用户模型

| 层级 | 入口 | 内容 |
| --- | --- | --- |
| 对话（首页） | 打开应用，或双击项目节点 | 用户消息、Router 回复、派发组、审批托盘 |
| 全景 | `⌘J` 或左侧栏的全景入口 | 所有项目和 Worker，见第 3.1 节 |
| Worker 详情 | 点 Worker 节点或对话中的引用 | 右侧面板：活动、改动、汇报 |

规则：

- `⌘J` 在对话和全景之间切换。`Esc` 逐级返回：详情、全景、对话。
- 进入全景时，当前对话缩小并落到它的项目节点上；进入对话时反向放大，让用户感觉是同一个东西在远近变化。
- `⌘N` 删除，`⌘,` 保留。

### 3.1 全景导图

**结构。** 「你」在中心，项目分布在左右两侧，向外依次是 Worker 和子 Worker。项目一旦分到某一侧
就不再改变，实时变化不会让分支换边。

**默认只看在推进的内容。** 顶部筛选分「在推进」和「全部」。「在推进」包含运行中、排队、等待、失败、
受阻和需要用户决定的 Worker，其余折叠成每个项目一个「已完成 N」节点。失败和待决定的 Worker
不折叠，它们最需要被看见。子树里还有在推进的节点时，已结束的父节点保留。

**颜色。** 分支颜色代表项目，色相避开状态色；节点状态只用绿、黄、红。

**节点内容：**

| 节点 | 显示 | 点击 |
| --- | --- | --- |
| 你 | 在推进的总数 | 适应窗口 |
| 项目 | 名称、待处理或工作数量、Router 最新回复的一句话 | 选中；双击或「进入对话」打开对话 |
| 没有对话的项目 | 只有名称，尺寸缩小 | 同上 |
| Worker | 状态、标题、耗时、实时动态 | 打开详情，高亮到「你」的路径 |
| 待批准的 Worker | 额外显示请求内容和批准、拒绝 | 同上 |
| 已完成 N | 数量 | 展开或折叠 |
| 保留的 worktree | 文字标记 | 打开 Router 详情，在那里丢弃 |

**首页是一篇 thread。** 进入 app 就是编辑行，没有项目时也一样：发送时才询问文件夹。消息从上到下排列，每行左侧是头像，没有底部输入框：用户在 thread 末尾的编辑行直接书写，Enter 换行，Command-Enter 发送。

**全景输入框跟随选中对象。** 全景底部的单行输入框选中项目时发给它的 Router，选中 Worker 时发定向消息（第 4.4 节）。
从全景发送后留在全景，回复显示在项目节点上。

**操作。** 滚动平移，拖动空白处平移，`⌘ + 滚轮`或捏合缩放，`F` 适应窗口，`N` 跳到下一个需要处理的
节点，方向键按空间位置移动焦点，`Enter` 打开。用户没有手动移动过画布时，节点增减后自动适应窗口；
手动移动后不再自动移动。

**远景。** 缩放低于约 60% 时隐藏实时动态和耗时，放大标题，只保留名字和状态。

**信号。** 动效只表示状态变化：运行中的分支上有向外流动的小点；汇报时光点沿分支回到项目节点；
批准操作从「你」传到 Worker；新节点从父节点长出。`prefers-reduced-motion` 时全部关闭，
对话和全景之间改为直接切换。

汇报的信号在 Worker 已折叠时从项目的「已完成 N」节点出发。批准和拒绝都算用户的回答，发同一个
信号。一批状态更新可能跳过 `running` 或 `reported`，所以 `workerSignals` 按前后状态判断，两个信号
都不会漏。

对话和全景的切换用 View Transition：两个视图不需要同时渲染，项目栏和打开的详情面板不参与缩放。
对话缩进项目节点，全景以该节点为中心放大进入；没有对应节点时改为淡入淡出。

Worker 状态到界面的映射：

| `status` | 界面 |
| --- | --- |
| `queued` | 排队中 |
| `starting`、`running` | 运行中，显示实时动态 |
| `waiting` | 等你批准，节点和分支高亮 |
| `reported`、`idle` | 按 `report.status`：完成、受阻、需要你决定、有进展 |
| `stopped` | 已停止 |
| `failed` | 失败 |
| `removed` | 不显示；有 `kept` worktree 时在项目下显示一个标记节点 |

## 4. 契约变更

### 4.1 Worker

`workerSchema`（`src/shared/router.ts`）新增两个字段：

```ts
/** Short label for the map and references; null falls back to the goal's first line. */
title: z.string().nullable().default(null),
/** The worker whose result led the Router to dispatch this one. */
parentId: z.string().nullable().default(null),
```

`goal` 最长 4000 字符，写给 Worker 看，不能直接当节点标题，所以需要单独的 `title`。

两个字段都存在 `workers.value` 的 JSON 里，树在内存中构建，不需要按父节点查询，
**不需要 SQL 迁移**。旧行由 zod 默认值补成 `null`，成为根节点的子节点。

### 4.2 Router 工具

`dispatch_task` 新增两个可选参数：

| 参数 | 约束 | 说明 |
| --- | --- | --- |
| `title` | 1–200 字符，保存时截到 60 | 给用户看的短标题，用用户的语言。模型写长了不报错，否则一次派发会因为标题失败 |
| `parent` | Worker ID | 这个任务基于哪个 Worker 的结果 |

`parent` 必须属于同一个 Router，否则返回 `worker_not_found`。父节点已移除时返回
`worker_closed`。`list_workers` 和 `recall` 的结果增加 `parent`，保持现有排序。
重复调用的去重键不变，仍然只看 `goal` 和 `context`。

父节点由 Router 显式指定，Owls 不从批次内容推断。一个批次可能同时含多条事件，推断结果不确定，
而 Router 的判断本来就是这条边要表达的含义。没传时挂在根节点下。

### 4.3 对话条目

`itemSchema`（`src/shared/app.ts`）：

- `kind` 增加 `worker`：Router 派出 Worker 的记录。
- 增加可选的 `workerId`：`worker` 条目表示派出的 Worker，`user` 条目表示这条消息指向的 Worker。
  其他条目没有这个字段，所以用 `optional` 而不是 `nullable`，现有构造条目的代码都不用改。

`worker` 条目由 `RouterService` 记录，ID 为 `dispatch:<workerId>`，重复调用不新增。三种引擎不用改，
也不用解析各自的工具结果。处理器成功后先记在批次上，等 `tool` 条目到达或批次结束时才写入
`router.items`：Claude Code 先执行工具，之后才交付工具调用前的文字，立即写入会让派发组排到那段文字前面。

Router 时间线隐藏 `tool` 条目，把相邻的 `worker` 条目合并成一个派发组。升级前的对话没有
`worker` 条目，所以看不到派发组，但文字和 Worker 都还在。

Router 回复里的 Worker 引用用 Markdown 链接 `[标题](#worker-w_xxx)`，由提示要求。renderer 渲染前
把它换成自定义标签 `<owls-worker worker="w_xxx">`，再由 Streamdown 的 `allowedTags` 和 `components`
渲染成引用。不用 `components.a`，是因为覆盖 `a` 会同时失去 Streamdown 对外部链接的确认弹窗。属性名不用
`id`，因为净化时会给 `id` 加前缀。ID 不属于当前 Router 时按普通文字显示。模型漏写时只是少一个可点的
引用，功能不受影响。

### 4.4 `@` 定向消息

`sendRouterSchema` 增加可选的 `workerId`（1–64 字符）。

带 `workerId` 时，`RouterService.send` 不把消息交给模型：

1. 调用 `pool.message(routerId, { workerId, text })`。失败时返回 `request_unavailable`，不写入对话。
2. 成功后写入 `user` 条目（带 `workerId`）。
3. 写入 `user_message` 事件（带 `workerId`），`wake` 为 false，随下一批次到达 Router。

批次事件头增加 `· to w_xxx`。提示说明这类消息已经送达，不要再转发。

这类事件不会单独发起批次，批次结束时也不会因为只剩它们而再跑一轮（`isQuietEvent`）。否则消息恰好在
Router 运行时到达，就会多花一次请求。只有它一条事件时也保留批次包装，让 Router 能看到 `to` 标记。

**为什么不走模型。** M4 基准中，去掉追问直通后 Router 请求增加 18%（316 → 374），追问 p95 从
3.9 分钟变成 5.9 分钟（RFC 14.1 节结论 3）。用户明确指定了 Worker，转发不需要判断，所以由程序完成。

和原直通的区别：用户现在不盯着 Worker 视图，所以这一轮的结果必须回到对话。Worker 汇报照常唤醒
Router，由 Router 告诉用户。`routerTurns` 和 `followUp` 因此可以全部删除，每一轮 Worker 的处理
完全相同。基准结果见第 9 节的 M4 结果：比转给 Router 少 11% 的请求，延迟不再比转给 Router 好。

### 4.5 审批

`worker_waiting` 事件的 `wake` 改为 false，随下一批次到达，也算 `isQuietEvent`，批次结束时不会因为只剩
它而再跑一轮。审批已经直接显示给用户，再唤醒 Router 只会多花一次请求，并产生一条重复提示。Router 不能
代批的规则不变。

renderer 从 `sessions` 派生待处理请求，不需要新事件：取当前 Router 的 Worker，取其会话中
`pending` 或 `answering` 的请求，按 Worker 的 `createdAt` 和 `id` 排序，响应仍走现有的
`window.owls.respond`。

| 位置 | 显示 |
| --- | --- |
| 对话 | 编辑行上方的托盘，滚动时吸底，复用 `RequestCard`，四种请求（含密文输入）都走同一个组件。只展开第一个，其余显示数量 |
| 全景节点 | `command`、`files`、`permissions` 显示请求内容和批准、拒绝 |
| 全景节点（`question`） | 问题和密文输入放不进节点，只显示「需要回答」，点击后在详情里作答 |
| Worker 详情 | 活动页显示 `RequestCard` |

托盘只显示当前项目的请求。其他项目的待处理状态由项目栏徽标和全景提示。

Worker 的 `needs_input` 汇报不进托盘：它走 Inbox，由 Router 在对话里问用户；全景上标为需要决定。

### 4.6 IPC

保持 main、`preload/owls.ts`、`shared/app.ts` 和 renderer store 同步。

| 通道 | 变化 |
| --- | --- |
| `owls:create-session` | 删除 |
| `owls:send` | 删除，`host.send` 只留给 Worker 内部使用 |
| `owls:interrupt` | 删除，由下一行替代 |
| `owls:router-stop-worker` | 新增，`{ routerId, workerId }`，走 `pool.stop` |
| `owls:archive` | 删除，由下一行替代 |
| `owls:router-remove-worker` | 新增，`{ routerId, workerId }`，弹确认框后走 `archive` 流程 |
| `owls:router-send` | 增加 `workerId` |
| `owls:respond` | 保留 |

用户停止排队中的 Worker 时，`pool.stop` 现在不产生事件，Router 不会知道。新增处理：写入
`worker_stopped`，`wake` 为 false。

`snapshot.sessions` 过滤为 Worker 的会话，见第 8 节。

## 5. main 改动

| 文件 | 改动 |
| --- | --- |
| `router/tools.ts` | `dispatch_task` 增加 `title`、`parent`，补充工具说明 |
| `router/workers.ts` | 校验并保存 `parentId`、`title`；`describe` 增加 `parent`；`worker_waiting` 不唤醒；删除 `routerTurns`、`followUp`；取消排队时写入事件 |
| `router/service.ts` | `send` 的定向分支；写入 `worker` 条目；新增 `stopWorker`、`removeWorker`；`recall` 增加 `parent` |
| `router/render.ts` | 删除 `origin`；用户消息增加 `· to w_xxx`；`renderState` 增加父节点 |
| `router/events.ts` | 删除 `followUp`；`user_message` 增加可选 `workerId` |
| `router/prompt.ts` | 见下；`ROUTER_PROMPT_VERSION` 在 M1 改为 4，M2 改为 5，M4 删除 follow-up 一句后改为 6，修复 Codex 引擎轮询后改为 7 |
| `codex/host.ts` | `snapshot` 过滤会话；删除公开的 `createSession`；`WorkerHost` 增加 `remove(sessionId)`，由它调用现有 `archive`；新增 Router 入口 |
| `app/ipc.ts`、`preload/owls.ts` | 第 4.6 节 |
| `codex/service.ts`、`claude/service.ts` | 删除 `role: 'task'` 分支，所有会话都是 Worker |
| `router/workers.ts`（`TurnProfile`） | 去掉联合类型，只保留 Worker 形状 |

提示要改的内容：

- 删除「Events marked follow-up」一句。
- 把「When a worker is waiting for approval, tell the user to open that task」改成：用户已经直接
  看到审批，不要重复提醒，也不能代批。
- 增加：派发时写 `title`，基于某个 Worker 的结果继续时传 `parent`；提到 Worker 时写成
  `[title](#worker-<id>)`；标记 `to w_…` 的用户消息已送达。

提示版本变化后，Codex 引擎会按已有逻辑新建 thread 并注入状态摘要（RFC 第 7 节）。

## 6. renderer 改动

`codex/App.tsx` 只保留应用壳，业务组件都在 `router/` 下。

```text
renderer/src/router/
  RouterShell.tsx        项目栏 + 对话或全景 + 详情面板，全局快捷键
  Sidebar.tsx            全景入口、项目列表、添加、设置；默认展开，可完全隐藏
  RouterChat.tsx         首页：标题栏、引导或时间线、托盘、编辑行
  RouterSetup.tsx        未就绪时的卡片和一键切换
  RouterTimeline.tsx     时间线，合并派发组，隐藏 tool 条目
  DispatchGroup.tsx      派发组
  WorkerLink.tsx         行内引用，含 Streamdown 的 a 组件
  RequestTray.tsx        审批托盘，复用 RequestCard
  RouterComposer.tsx     草稿逻辑、@ 菜单、全景输入框
  RouterGuide.tsx        首次进入的设置引导
  ThreadEditor.tsx       thread 末尾的编辑行
  ThreadRow.tsx          thread 的一行：头像和正文
  WorkerDetail.tsx       活动、改动、汇报
  RouterDetail.tsx       引擎、模型、用量、保留的 worktree
  DiffView.tsx           从 App.tsx 的 Chat 中抽出
  activity.ts            从会话 item 派生实时动态
  motion.ts              对话和全景的缩放过渡
  store.ts               增加视图、选中和详情状态（不持久化），新增 action
  map/
    MapView.tsx          画布、HUD、缩放控件、跟随输入框
    MapNode.tsx          各类节点
    MapEdges.tsx         分支和流动
    useCamera.ts         平移、缩放、适应窗口
    useMapMotion.ts      新节点生长和信号
    projects.ts          项目、Router 和 Worker 的合并视图
shared/
  worker-map.ts          建图、筛选、布局和信号路线，纯函数
```

要点：

- **不引入图形库。** 仓库里没有图形依赖，这里只需要固定的左右树布局，不需要手动连线或拖动节点。
  布局是一个不到 100 行的纯函数，原型已经验证过。节点是 React 元素，分支是一层 SVG。
- **建图和布局是纯函数**，放在 `shared/`，从 `main/app/runtime.ts` 导出供测试使用。输入是项目、
  Router、Worker 和筛选状态，输出节点坐标和分支。排序确定：在推进的子树在前，同组按 `createdAt`
  和 `id`。父节点已移除时，子节点挂到最近的未移除祖先。节点高度按类型固定，不需要测量 DOM。
- **全景的数据都已存在。** `snapshot` 已包含所有项目的 Router 和 Worker，事件也不分项目，
  不需要新 IPC。Router 是打开时才创建的，还没有 Router 的项目显示为无对话节点，首次发送前调用
  `open`。项目节点的一句话取最后一条 `assistant` 条目的末行。
- **相机不走 React。** 平移和缩放只写 `transform`，不触发节点重渲染；相机状态不持久化。
- **实时动态**：`waiting` 显示待批请求，否则取最后一条非用户 item：`command` 显示命令（等宽），
  `files` 显示文件，`assistant` 显示首行。`session` 事件带完整 items，节点只订阅派生出的单行文本，
  避免流式输出时整张图重渲染。
- **活动页**：Worker 会话里的 `user` 条目来自 Router，显示为「Router 下发」或「Router 转告」，
  用户因此能看到 Router 到底让 Worker 做了什么。
- **汇报页**：展示 `artifacts`（当前没有 UI）。`kind: 'file'` 且路径不在项目内时只显示文件名
  （RFC 第 6 节）。`degraded` 时说明内容取自原始输出。
- **启动**：打开 `updatedAt` 最新的 Router，没有时打开第一个项目，都没有时显示选择文件夹。
  不新增设置项，也不需要记住「上次的项目」。
- **未配置时的首页**：thread 为空且 Router 引擎未就绪时，进入 app 先走引导（`RouterGuide`），不显示
  thread 和编辑行；选中已连接的 Claude Code 或 Codex 一步完成，否则新用户必须先有 API key 才能使用。
  引擎就绪但默认 Worker agent 未连接时，引导进入第二步，否则所有派发都会以 `provider_unavailable`
  失败。引导可以跳过，下次启动仍会出现。thread 已有内容或引导被跳过时，同样的提示以一条 Router 消息
  显示在编辑行上方（`RouterSetupNotice`），保留一键切换。
  一键切换后，`RouterService.settingsChanged` 清除旧设置留下的失败，并发出等待中的消息，用户不用重发。
- **设置**：`defaults` 分组改名为「Worker 默认值」，`TaskOptions` 从输入框挪到这里。
- **无障碍**：节点容器使用 `role="tree"`，方向键移动焦点，所有操作都有键盘路径。信号和颜色都不是
  唯一的信息来源，状态同时以文字显示。
- **i18n**：`codex/i18n.ts`、`router/i18n.ts` 删除任务相关文案，新增文案同时提供中英文，
  无障碍文本一起覆盖。Tooltip 使用共享组件。

## 7. 删除清单

- renderer：`Sidebar`、`Chat`、`view: 'chat'`、`selectedId`、`draftCwd`、`select`、`newTask`、
  `send`、`interrupt`、`archive`、`useWorktreeProjects`、Router 视图顶部的 Worker 条、
  标题栏的引擎和模型信息（挪到 Router 详情）、对应的 CSS。
- IPC：第 4.6 节标记删除的通道。
- main：`routerTurns`、`followUp`、`role: 'task'`、`createSession` 的公开入口。
- 设置：`workerProvider`。没有普通任务后，它和 `provider` 表示同一件事，只留 `provider`。
- 基准：`no-passthrough` 组保留作对照，`passthrough` 组按第 4.4 节改成走 `RouterService.send`。

## 8. 持久化

| 数据 | 处理 |
| --- | --- |
| SQLite schema | 不变，没有 Drizzle 迁移 |
| `workers.value` | 新字段有默认值 |
| `routers.value` | 新字段有默认值；旧 `tool` 条目保留但不显示 |
| `inbox_events.value` | 旧行的 `followUp` 被 zod 忽略；`user_message.workerId` 可选 |
| 设置 | 读取时，`workerProvider` 非空就写入 `provider`，再丢弃该字段 |
| 用户直接创建的旧任务 | **保留数据，不再显示**：`sessions` 不删，`snapshot` 不返回，原生历史仍在各 CLI 中 |

旧任务不提供入口，这符合不做向后兼容的决定；但删除用户数据不可恢复，这次改造也不需要删除，所以数据保留。

## 9. 实施阶段

每个阶段一个 MR，合入后主干都可用。旧 UI 在 M2 才删除，所以 M1 只做增量。动效单独一个阶段，
可以在不影响功能的情况下调整或推迟。

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| M1 契约 | `title`、`parentId`、`worker` 条目、取消排队事件、`shared/worker-map.ts`、`stop-worker`、`remove-worker`、定向消息、提示 v4（不含审批措辞） | `pnpm --filter owls-client test:admin`；`router-runtime.test.mjs` 增加父节点校验、去重、定向投递、`to` 事件头、取消排队；布局测试覆盖节点不重叠、两侧不换边、结果确定 |
| M2 应用壳和全景 | 第 6 节组件，替换 `App.tsx`，删除任务 UI；全景的布局、相机、节点审批、跟随输入框；`worker_waiting` 不唤醒和审批提示随托盘一起上线（提示 v5） | `typecheck`；`test:ui` 重写任务相关步骤（第 262–320 行等），覆盖首页、全景、详情、审批托盘、节点批准、`@`、中英文；`router-runtime.test.mjs` 新增 `worker_waiting` 不发起批次的用例（目前没有覆盖） |
| M3 动效 | 对话和全景的缩放过渡、分支流动、信号、新节点生长 | 在可见窗口里实际操作；开启减少动态效果后确认全部关闭；4 个 Worker 同时流式输出时确认帧率 |
| M4 收尾 | 删除 `create-session`、`send`、`interrupt`、`archive` 通道，`role: 'task'`、`followUp`、`routerTurns`、`workerProvider`；`snapshot` 过滤；更新基准和 `desktop-smoke.cjs` 中对 `host.createSession` 的调用 | `test:admin`、`test:desktop`、`bench:router`，记录新的追问 p50 / p95 和请求数；`verify:codex`、`verify:claude` 真实 CLI 各跑一次；更新 RFC |

每个 MR 添加 `.changelog/unreleased` 片段。M2 改变了整个用户工作流，需要在发布说明里明确写出。

**M4 结果。**

- 基准（`RFC_OWLS_SUPER_AGENT.md` 14.1 节）：定向消息的 Router 请求 334，转给 Router 374，少 11%；
  追问 p50 / p95 2.7 / 6.0 分钟，转给 Router 2.7 / 5.9 分钟。`@` 消息现在受 `WORKER_LIMIT` 和
  写入串行限制，原直通的延迟优势没有了。
- `verify:codex --prompt`、`verify:claude --prompt` 通过。
- 用真实模型跑了一次两步派发加一条 `@` 消息，Claude Code 和 Codex 引擎各一次，都使用只读 Worker。
  两个引擎都写了 `title`、第二步传了 `parent`、回复用了 Worker 链接，也都没有转发 `@` 消息。
  Claude Code 引擎这轮有两次 `worker_waiting`，Router 没有重复提醒审批。
- 这次实测发现 Claude Code 引擎的 `dispatch_task` 不可用：Agent SDK 自带的 zod 会把应用 zod 建的
  raw shape 的可选字段都变成必填。现在把完整的 zod 对象交给 SDK，并用真实 SDK 加了回归测试。
- 这次实测还发现 Codex 引擎的 Router 派发后会反复调用 `list_workers` 等结果（一次场景 9 次），汇报
  到达后还多回复了一次。重复回复也是轮询造成的，与静默事件无关：`list_workers` 在 `worker_report`
  送达前就能看到汇报，Router 据此回复后，这些事件又唤起一个批次。现在提示说明汇报只会在回合结束后
  到达，要求派发后结束回合，依赖结果的下一步也等汇报到达后再派。真实模型复测两步派发两次，
  `list_workers` 都是 0 次，最终回复都是一次。

M1 和 M2 上线之间，追问直通的旧路径和定向消息短暂共存，不影响行为：旧 UI 不会发送 `workerId`。
审批相关的改动放在 M2，因为旧 UI 没有托盘，用户仍然需要 Router 提醒去打开任务。

## 10. 风险

1. **Router 成为强依赖。** 没有任务入口后，Router 不可用就什么都做不了。默认的 Owls 引擎需要
   配置模型，第 6 节的一键切换必须和 M2 一起上线。
2. **对话无限增长。** `router.items` 整个存在一行 JSON 里，`saveRouter` 全量写入，`router` 事件
   全量发送。它现在是唯一的对话，流式输出时每 70 毫秒发生一次。M2 用一段长对话实测；变慢时再把
   条目拆到独立的表，不提前做。Claude Code 和 Codex 引擎的原生上下文增长同样是已知问题（RFC 16 节）。
3. **模型不遵守新约定。** 漏写 `title` 时回退到 goal 首行，漏写 `parent` 时挂在根节点下，漏写
   引用链接时显示普通文字，都只影响展示。第 9 节的实测中，两个引擎都遵守了约定，样本只有一个场景。
4. **链接渲染。** 已验证并解决，见第 4.3 节。
5. **`session` 事件频率。** 全景同时读取所有项目的会话。第 6 节的派生订阅用于控制重渲染。
   已在可见窗口用 4 个 Worker、每个每秒 30 次增量实测，对话和全景都保持 120 fps，p95 约 10 毫秒，
   没有长任务，分支流动不增加可测的开销。
6. **全景的规模。** `WORKER_LIMIT` 是全局 4 个，但排队和已结束的节点会累积。默认筛选能控制大部分
   情况，原型用 20 个节点验证过布局不重叠，缩放到 57%。项目和历史 Worker 很多时可能需要按项目折叠。
7. **动效的手感。** 分支的 CSS `d` 过渡已在 Electron 41 确认生效。可见窗口里用脚本检查过暂停在中途
   的画面，触控板平移、捏合和实际节奏仍需要人工确认。

## 11. 对现有 RFC 的修订

M4 时同步修改 `RFC_OWLS_SUPER_AGENT.md`：

| 章节 | 修订 |
| --- | --- |
| 第 2 节「不使用 Router 的用户体验不变」 | 删除 |
| 3.1 节第三条路径、8.2 节 | 改为第 4.4 节的定向消息 |
| 第 5 节 | 增加 `title`、`parent` |
| 第 7 节提示要点 | 同步提示 v4 |
| 9.4 节末尾两段 | Worker 不再出现在任务列表，`role: 'task'` 已删除 |
| 9.7 节、第 16 节已关闭的第 4 条 | 改为指向本文 |
