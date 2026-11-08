# RFC: 多设备

状态：草案。日期：2026-11-08。基线：`e39bbcd`。

本文接替 [RFC_OWLS_GLOBAL_THREADS.md](RFC_OWLS_GLOBAL_THREADS.md) 第 6 节的方向。原来的方向是「账号权威保存全部状态，
Router 批次作为 job 派给设备」，现在改为：每台设备只跑自己的 Router，其他设备只同步显示；
跨设备派 Worker 时，把命令直接发给目标设备上的 Owls。memory 的多设备部分见
[RFC_OWLS_MEMORY.md](RFC_OWLS_MEMORY.md) 第 11 节，本文不重复。

## 1. 需求

1. 每台设备上都能和 Router 对话，并且能看到所有设备上的对话、Worker 和全景。
2. 一台设备下线，只影响这台设备上的 thread、项目和 Worker；其他设备照常工作。
3. 在一台设备上的 Router 里，可以派 Worker 到另一台设备上的项目。
4. 设备只是断网时，本机的 Router 和 Worker 照常工作，恢复联网后补上同步，不丢数据。

非目标：

- 在另一台设备上直接续写同一个 thread。其他设备上的 thread 只读，要接着聊时用「在本机继续」（第 5.2 节）。
- 同一个仓库在多台设备上合并成一个项目。第一版里它们是两个项目，名称后面带上设备名。
- 手机和网页客户端。协议允许以后加，但不设计它们的界面。
- 流式输出的实时跨设备转发。其他设备在条目完成后才看到它。
- 同步设置。第一版的设置都留在各自设备上（第 4 节）。

## 2. 决策摘要

1. **每台设备只跑自己的 Router。** thread 属于创建它的设备，只有这台设备运行它的 Router、写它的条目。
   三个 Router 引擎都不用改，原生会话也不用跨设备迁移。
2. **每条记录只有一个写入者。** thread、条目、项目、Worker、设备，都只由所属设备写入，其他设备只读，
   所以不会有冲突。只有 memory 例外，由同步服务按 `baseRev` 比较版本（第 8.1 节）。
3. **跨设备派发是发给目标设备上 Owls 的命令，不经过它的 Router。** A 的 Router 派发 B 上的项目时，
   A 写一条发给 B 的命令，B 上的 Owls 收到后交给本机的 `WorkerPool`。Worker 记录由 B 写入，
   A 通过同步拿到状态和汇报，转成自己的 Inbox 事件（第 6 节）。
4. **同步服务只存密文、只做转发。** 用 Cloudflare Durable Object 实现，每个账号一个实例。它负责：
   认证设备、校验写入者、分配 `rev`、保存和推送密文记录，以及记录在线状态。
   它不调度任何东西，也没有 job 和租约。
5. **端到端加密。** 内容用账号内容密钥加密，这个密钥只在用户的设备上。同步服务读不到内容，也伪造不了命令（第 8.3 节）。
6. **连接都由设备主动发起。** 设备向同步服务建立一条出站 WebSocket，不需要开入站端口。每台设备一个可撤销的 token。
7. **未登录时不同步。** 行为和今天完全一样，本地数据库就是全部。

## 3. 拓扑

```text
           ┌────────── 同步服务（Durable Object，每个账号一个实例，只存密文） ──────────┐
           │ 各设备的记录（按写入者分）· 设备之间的命令和回执 · memory · 设备公钥 · 在线状态 │
           └──────▲───────────────────────────▲──────────────────────────────────────┘
       出站 WSS   │ push 自己的记录 / pull 全部 │
     ┌────────────┴─────────────┐   ┌─────────┴────────────────┐
     │ MacBook                  │   │ Mac mini                 │
     │ Router：thread 1、2       │   │ Router：thread 3          │
     │ 项目：Owls、周报           │   │ 项目：模型训练              │
     │ 只读显示：thread 3、       │   │ 只读显示：thread 1、2、     │
     │ Mac mini 的 Worker        │   │ MacBook 的 Worker         │
     └──────────────────────────┘   └──────────────────────────┘
     thread 1 派发「模型训练」的任务 → 命令经同步服务送到 Mac mini → Mac mini 的 WorkerPool 运行
```

同步服务的选型理由：

- Durable Object 单个实例里的请求串行执行，`rev` 和写入校验天然有序。
- 用实例自带的 SQLite 保存密文记录、去重序号和设备表。
- 用 WebSocket Hibernation 保持设备连接，没有消息时实例可以休眠。

核心逻辑写成不依赖平台的 TypeScript，只依赖一个 SQLite 存储接口和一个连接接口，Durable Object 只是适配层。
以后要自建服务时，加一个 Node 适配层即可。

## 4. 数据归属

| 数据 | 写入者 | 其他设备 |
|---|---|---|
| thread、thread 条目、Router 状态 | thread 所属的设备 | 只读显示 |
| Inbox 事件、批次、原生会话、Owls 引擎 transcript | thread 所属的设备 | 不同步，只有运行 Router 的设备用得到 |
| 项目 | 项目所在的设备 | 只读显示，可以作为派发目标；`path` 只在所在设备上有意义 |
| Worker 记录（目标、状态、汇报、分支、PR、待处理的审批） | 运行 Worker 的设备 | 只读显示；派出它的 thread 据此产生 Inbox 事件 |
| Worker 会话条目 | 运行 Worker 的设备 | 只同步已完成的条目；diff 只同步改动文件的统计 |
| 设备之间的命令 | 发送方 | 只有接收方执行 |
| 命令回执 | 接收方 | 发送方据此更新状态 |
| 设备记录（名称、平台、版本、已连接的 agent） | 设备自己 | 只读显示 |
| memory 记录和类别 | 任意设备，按 `baseRev` 比较 | 见 RFC_OWLS_MEMORY 第 11 节 |
| 设置、worktree、CLI、可执行文件路径、本地连接状态 | 设备自己 | 不同步 |

设置第一版全部按设备保存：Router 运行在本机，用本机的 CLI，所以引擎、模型、权限这些设置本来就该按设备选；
Dreaming 也只整理本机的 thread（RFC_OWLS_MEMORY 第 11.4 节）。新增的 `device` 设置见第 7 节。

已撤销设备写过的记录保留在同步服务上，作为只读历史。它的 thread 只能「在本机继续」，它的项目不能再作为派发目标。

## 5. Router 与 thread

### 5.1 本机 Router

- `CodexRouter` 增加 `deviceId`，创建时写入本机 id，之后不变。
- 只有 `deviceId` 等于本机的 thread 才会进入 `RouterService` 的调度：唤醒、批次、steer、转发目标。
- Router 引擎、原生会话和 `router.cwd` 都不变。因为 thread 不会换设备运行，不需要迁移上下文。
- 三个引擎在多设备下的行为一致，没有哪个引擎需要特殊对待。

### 5.2 其他设备上的 thread

- 侧边栏照常列出所有 thread，其他设备的带上设备名。全景显示所有设备上的项目和 Worker。
- 打开这类 thread 时只读，输入框换成一行说明：「这个对话在 MacBook 上运行」，以及按钮「在本机继续」。
  所属设备离线时加上「MacBook 离线，显示的是最后同步的内容」。
- **在本机继续** 复用现有的转发：
  - 在本机新建一个 thread，写入一条 `forward` 条目。
  - 转发来源新增一种：整段 thread。冻结的内容是按 token 预算（初始 8000）从末尾截取的对话。
    `forward` 记录来源 thread 和截取到的版本。
  - 和现有的转发一样，内容是参考资料，不是用户的指令（提示 v8 的规则）。
- 已经转发过的 Worker 结果，新的 thread 仍然可以把它作为 `parent`。B 只检查父 Worker 和新任务在同一个项目里，
  不关心派发来自哪个 thread。给这个 Worker 发消息或停止它，仍然只有原来的 thread 可以。
- 以后可以考虑「代发」：在 B 上给 A 的 thread 发消息，作为命令送到 A，A 在线时由它的 Router 处理。第一版不做。

## 6. 跨设备 Worker

### 6.1 命令和回执

```ts
type DeviceCommand = {
  commandId: string          // dispatch 时就是 workerId
  from: string               // 发送方设备
  to: string                 // 接收方设备
  createdAt: string
  expiresAt: string | null   // 只有 dispatch 有，默认 24 小时
} & (
  | {
      kind: 'dispatch'
      workerId: string
      routerId: string
      projectId: string
      goal: string
      provider: 'claude-code' | 'codex'
      model: string | null
      effort: string | null
      permission: 'read-only' | 'workspace-write' | 'full-access'
      parent: string | null
      base: 'head' | 'default-branch' | 'parent'
    }
  | { kind: 'message'; workerId: string; text: string; mode: 'next' | 'steer' }
  | { kind: 'stop'; workerId: string }
  | { kind: 'approval'; workerId: string; requestId: string; decision: 'approve' | 'deny' }
)

type CommandReceipt = {
  commandId: string
  result: 'accepted' | 'rejected'
  reason:
    | null
    | 'remote_dispatch_disabled'
    | 'project_not_found'
    | 'agent_not_connected'
    | 'worker_not_found'
    | 'already_resolved'
    | 'expired'
    | 'superseded'           // dispatch 在执行前已被 stop
  /** 权限超过设备上限时按上限执行，这里记下实际生效的权限。 */
  permission: 'read-only' | 'workspace-write' | 'full-access' | null
}
```

`DeviceCommand` 和 `CommandReceipt` 都是普通的同步记录，写入者分别是发送方和接收方。
接收方本来就会拉取所有记录，所以不需要单独的命令队列。同步服务只需要看到 `to`，用来在接收方在线时立即推送。

### 6.2 派发流程

1. A 的 Router 调用 `dispatch_task`，目标项目的 `deviceId` 不是本机。
2. A 生成 `workerId`，写一条 `dispatch` 命令，并立刻返回给 Router：状态 `queued`，加上目标设备名和它是否在线。
   A 的界面先用这条命令显示一个占位 Worker。
3. B 拉到命令后，先做本地检查（第 7 节），然后交给本机 `WorkerPool`。Worker 的 id 就是 `workerId`。
   B 写回执和 Worker 记录。
   - 超过 `WORKER_LIMIT` 时在 B 本地排队，和本机派发的一样。
   - 被拒绝时只写回执，不建 Worker。
4. B 运行时同步 Worker 记录和已完成的会话条目。A 拉到后，用 B 的 Worker 记录替换占位。

### 6.3 事件回到 Router

- A 应用拉到的 Worker 记录时，如果这个 Worker 的 `routerId` 是本机的 thread，就比较新旧状态，
  写入对应的 Inbox 事件：`worker_report`、`worker_waiting`、`worker_failed`、`worker_stopped`。然后照常唤醒 Router。
- B 每次状态变化都把 Worker 记录里的 `seq` 加一。Inbox 事件的 id 是 `workerId#seq`，重复应用也只写一次。
- 回执被拒绝时，A 写一条 `worker_failed` 事件，原因就是回执里的 `reason`。
- `recall(workerId)` 读的是本地同步过来的会话条目，和本机 Worker 一样。

### 6.4 离线和失败

| 情况 | 处理 |
|---|---|
| B 离线时派发 | 命令留在同步服务上。Router 拿到 `queued`，原因是 `device_offline`，工具说明要求它告诉用户 |
| B 回来时命令已过期 | B 拒绝，原因 `expired`，A 收到 `worker_failed`。用户和 Router 都可以重新派发 |
| B 离线时 `stop` 或撤回 | B 回来后按顺序处理同一个 Worker 的命令：dispatch 后面已经有 stop 的，不再启动，回执记为 `superseded` |
| B 离线时 `message` | 和本机一样排进 `next`，B 回来后投递 |
| A 离线时 B 做完了 | Worker 记录留在同步服务上。A 上线后拉到，照常写 Inbox 事件 |
| 重复发送 | `commandId` 就是幂等键，B 记下处理过的 id，重复的命令不再执行 |
| B 在运行中断网 | B 的 Worker 照常跑完，记录先存本地变更日志，联网后推送 |

`dispatch_unknown` 只在本机引擎调用失败时出现，跨设备派发不会产生它：A 写下命令就算派发成功，
之后的结果都由 B 的回执和 Worker 记录说明。

### 6.5 消息、停止和审批

- **`message_worker`、`stop_worker`、`@` 定向消息：** A 写对应的命令，B 执行。`steer` 失败时，B 退回 `next`，和今天一样。
- **审批：** B 上的 Worker 等待审批时，待处理的请求写在 Worker 记录里。A 收到 `worker_waiting`，A 上的用户批准或拒绝后，
  结果作为 `approval` 命令发给 B。B 本机也可以直接处理。B 以先到的为准，后到的回执记为 `already_resolved`。
- **`base: 'parent'`：** 父 Worker 必须和新任务在同一个项目里，同一个项目本来就在同一台设备上，所以 B 能直接用父分支。
  跨项目时返回现有的错误。
- **GitHub 状态：** 由 B 获取（`worker-github.ts`），写在 Worker 记录里同步出去。B 离线时，其他设备显示最后一次的状态。
- **完整 diff：** 第一版只在 B 上能看，其他设备显示改动文件的统计，以及「在 Mac mini 上查看」的提示。

### 6.6 提示的变化

- 项目列表加上设备和在线状态：`- 模型训练 · p_456 · Mac mini · offline`。本机项目写 `this device`。
- `dispatch_task` 的结果新增 `device` 和 `deviceOnline`。工具说明里写明：目标设备离线时，任务会等它回来再启动，
  超过 24 小时会过期，要把这一点告诉用户。
- `list_workers` 和状态行给其他设备上的 Worker 加上设备名，离线时加上 `device offline since 14:20`。
- `ROUTER_PROMPT_VERSION` 升一版。

## 7. 设备

```ts
type OwlsDevice = {
  id: string                 // dv_xxxxxxxx，首次启动时生成，存在本地
  name: string               // 默认用主机名，可以改
  platform: 'darwin' | 'win32' | 'linux'
  appVersion: string
  agents: { provider: 'claude-code' | 'codex'; ready: boolean }[]
}
```

在线状态不放在设备记录里，由同步服务根据连接给出：有打开的 WebSocket 就算在线，同时记录 `lastSeenAt`。

设备级设置 `device`：

```ts
type DeviceSettings = {
  /** 其他设备派到本机的 Worker 的权限上限。 */
  maxPermission: 'read-only' | 'workspace-write' | 'full-access'
  /** 是否接受其他设备派来的 Worker，会用本机 CLI 的额度。 */
  acceptRemoteDispatch: boolean
}
```

默认值是 `workspace-write` 和 `true`，设置页说明会用本机的额度。

B 执行任何命令之前，都在本地检查以下几点：

- 命令能用当前或之前纪元的内容密钥解开，并且发送方是未撤销的设备。
- 项目确实属于本机。
- `acceptRemoteDispatch` 已开启。
- 所需的 agent 已经在本机连接。
- 实际生效的权限是 `min(命令里的权限, 本机的 maxPermission)`，降级时写进回执。
- `message`、`stop`、`approval` 针对的 Worker 存在，并且是这条命令的发送方派出的。本机界面上的操作不经过命令，不受这条限制。

## 8. 同步协议与端到端加密

### 8.1 记录和写入规则

```ts
type SealedRecord = {
  id: string
  kind: 'thread' | 'item' | 'project' | 'worker' | 'session-item' | 'command' | 'receipt'
      | 'device' | 'memory' | 'memory-category'
  owner: string           // 写入者设备；memory 和类别为 null
  to: string | null       // 只有 command 有
  rev: number             // 同步服务分配，账号内递增
  baseRev: number | null  // 只有 memory 和类别用
  epoch: number
  nonce: string
  body: string            // AEAD 密文
}
```

- **写入。** 设备只推送自己是 `owner` 的记录。同步服务核对 token 对应的设备，不一致就拒绝。
- **顺序和去重。** 每台设备的本地变更日志有递增的 `deviceSeq`。同步服务记下每台设备已接受的最大序号，
  重复的直接确认，跳号的拒绝并要求从缺口重发。这和 Orca federation 的 ack 水位做法相同。
- **保存。** 每个记录 id 只保留最新版本，删除写墓碑，墓碑保留 90 天。
- **共享记录。** `memory` 和 `memory-category` 任何设备都能写，同步服务按 `baseRev` 比较：
  等于当前 `rev` 才接受，否则返回 `stale`。新建记录的 id 由设备生成，重试是幂等的。
- **拉取。** 设备按 `rev > 上次` 分页拉取所有记录，应用到本地表里，并标上 `owner`。
  本地的 `codex_sync_state.rev` 仍然只管本机的读者，和同步服务的 `rev` 分开记录。

### 8.2 消息

一条出站 WebSocket，消息都用 zod 校验：

| 方向 | 消息 | 作用 |
|---|---|---|
| 设备 → 服务 | `hello { deviceId, token, appVersion, after }` | 认证，并从 `after` 开始补发变更 |
| 设备 → 服务 | `push { fromSeq, records }` → `ack { seq, revs }` 或 `error` | 推送本机的变更 |
| 服务 → 设备 | `changes { records, rev }`；设备也可以发 `pull { after }` | 增量推送和分页拉取 |
| 服务 → 设备 | `presence { deviceId, online, lastSeenAt }` | 在线状态变化 |
| 双向 | `join.*` | 新设备加入时转发公钥和验证码（第 8.3 节） |

没有 `job`、`rpc`、`stream`：设备之间的交互都是同步记录。

认证：

- 登录账号后注册设备，每台设备一个 token，在设置里可以看到全部设备并撤销其中任何一个。撤销后连接立即断开，之后的推送都会被拒绝。
- token 用 Electron `safeStorage` 加密保存，和现有 Router API key 的做法一样。

### 8.3 端到端加密

**密钥**

| 密钥 | 存放 | 用途 |
|---|---|---|
| 账号内容密钥 `K_n`（对称，按纪元 `n` 轮换） | 只在用户的设备上，内存里和 `safeStorage` 里 | 加密所有内容 |
| 设备密钥对（X25519） | 私钥用 `safeStorage` 存在本机；公钥登记在同步服务 | 接收包装后的 `K_n` |
| 包装后的 `K_n` | 同步服务，每台设备一份，用该设备的公钥封装 | 设备启动或纪元轮换时取回自己那份 |
| 恢复码 | 用户自己保存，Owls 和同步服务都不存 | 派生出另一把包装密钥，用于所有设备都丢失后的恢复 |

**加入、撤销和恢复**

- **加入新设备。** 新设备生成密钥对并登记公钥，然后需要一台已有设备在线批准。
  两边显示同一个 6 位验证码，由双方公钥派生，用来防止同步服务冒充新设备。用户在已有设备上确认后，它把当前的 `K_n` 包装给新设备。
- **没有其他设备在线时，** 用恢复码加入。
- **撤销设备。** 撤销后轮换到新纪元 `K_{n+1}`，只包装给剩下的设备，之后的新内容都用新密钥加密。
  被撤销的设备已经下载过的旧内容无法收回，旧记录也不重新加密。设置页的撤销确认里要说明这一点。
- **全部设备都丢失、也没有恢复码时，** 数据无法恢复。首次开启同步时，必须让用户保存恢复码，并明确说明这个后果。

**完整性**

- AEAD 的关联数据绑定 `id`、`kind`、`owner`、`to` 和 `epoch`，同步服务没法把一段密文挪到别的记录或别的接收方。
- 同步服务没有内容密钥，所以伪造不了命令。它重放旧命令时，接收方按 `commandId` 去重。
- `body` 里带写入者的版本号，设备拒绝版本比本地更低的内容，以此防止回滚。
- 同步服务仍然可以扣住某些更新不发，这一点加密防不住，列为风险。
- 加密算法优先用 Node 内置的 `crypto`（X25519、AES-256-GCM 或 ChaCha20-Poly1305），避免引入原生依赖。

**同步服务能看到的明文元数据**

| 能看到 | 看不到 |
|---|---|
| 记录的 id、`kind`、`rev`、写入者、命令的接收方、时间戳 | 对话、标题、目标、汇报、artifacts |
| 设备 id、平台、应用版本、在线状态 | 设备名、项目名、路径、分支名、PR 链接 |
| 密文长度和访问时间 | thread、Worker 的状态，memory 的正文和类别名，设置 |

同步服务不再调度，所以原方案里为调度而明文保存的状态、job 类型和三项设置都不需要了。

## 9. 代码怎么拆

| 模块 | 职责 | 改动位置 |
|---|---|---|
| `DeviceIdentity` | 设备 id、设备密钥、内容密钥 | 新增，主进程 |
| `SyncLog` | 本机记录变化时写本地变更日志（`deviceSeq`） | 挂在 `RouterStore.saveThread`、Worker、项目、会话的写入路径上 |
| `SyncClient` | WebSocket、推送、拉取、加解密、把远端记录写进本地表 | 新增；未登录时不启动 |
| `WorkerTarget` | `dispatch`、`message`、`stop`、`approve` 的统一接口。`LocalWorkers` 包装 `WorkerPool`，`RemoteWorkers` 写命令 | `RouterService` 改为按项目的 `deviceId` 选择实现 |
| `RemoteWorkerEvents` | 应用拉到的 Worker 记录时，为本机 thread 写 Inbox 事件 | 新增，接在 `SyncClient` 的应用路径上 |
| `CommandExecutor` | 处理发给本机的命令：本地检查、交给 `WorkerPool`、写回执 | 新增 |
| `SyncRelay` | 同步服务核心：认证、写入校验、`rev`、去重、共享记录比较、推送、在线状态 | 新包，Durable Object 适配层另放 |

数据库：

- `codex_threads`、`codex_projects`、`codex_workers`、`codex_sessions` 增加 `owner_device_id`，thread 条目跟随所属 thread。首次启动生成设备 id 后，
  把已有行回填为本机。
- 新增 `codex_devices`、`codex_device_commands`、`codex_command_receipts`、`codex_sync_log`（`deviceSeq`、记录 id、是否已确认）、
  `codex_sync_cursor`（同步服务的 `rev`）。
- 按仓库规则修改 `schema.ts`，用 `db:generate:codex` 生成迁移。

renderer：

- 其他设备的 thread 只读，显示「在本机继续」。
- 设备名和在线状态显示在侧边栏、全景和 Worker 面板上。
- 设置新增「设备」tab：设备列表、撤销、加入批准、恢复码、`acceptRemoteDispatch`、`maxPermission`。
- 所有文案走 i18n，中英文都要有。

## 10. 和 Orca 的对比

Orca（[stablyai/orca](https://github.com/stablyai/orca)）也是每台主机自己保存状态，其他设备是它的 UI。区别在于：

- Orca 的主机下线后，连上它的客户端什么都看不到。Owls 的同步服务保存了所有设备最后的状态，
  主机下线时其他设备仍然能看，发给它的命令也会排队等它回来。
- 借用的做法：设备主动发起出站 WebSocket，每个客户端一个可撤销的 token，按递增序号和 ack 水位去重。

## 11. 风险、决定与待验证

风险：

- **同步服务被攻破。** 它读不到内容，也伪造不了命令，能做的是扣住更新、延迟推送和观察元数据。
  所有来自同步服务的数据仍按不可信输入校验。
- **一台设备的密钥泄露。** 拿到 `K_n` 的人可以伪造命令。缓解措施：撤销设备并轮换纪元、第 7 节的本地检查、
  `maxPermission` 和 `acceptRemoteDispatch`。
- **隐私。** 同步服务能看到有哪些记录、谁写的、什么时候活跃、有多大。不登录就完全留在本地。
- **密钥丢失。** 所有设备都丢了、恢复码也没有时，数据找不回来。
- **额度。** 其他设备派来的 Worker 用的是本机 CLI 账号的额度。
- **同步量。** Worker 会话条目可能很大，要关注 diff 很大的 Worker。

已定：

- **每台设备只跑自己的 Router。** 其他设备的 thread 只读，用「在本机继续」接着聊（第 5 节）。
- **跨设备派发发给目标设备的 Owls，不经过它的 Router，也不用 SSH**（第 6 节）。
- **同一仓库在多台设备上是两个项目。** 名称后面带上设备名，第一版不合并。
- **做端到端加密。** 从第一版同步就做，因为数据一旦以明文上传就没法收回。
- **Router 引擎由用户自己选。** 引擎在本机运行，多设备下三个引擎行为一致。
- **同步服务用 Cloudflare Durable Object。** 每个账号一个实例，核心逻辑不依赖平台（第 3 节）。

实现前需要验证：

- Durable Object 的限制，对照 Cloudflare 当前文档核对，并做一次 spike：
  - 单个实例的 SQLite 容量上限，能撑多大的账号数据量。会话条目要算进去。
  - 单条 WebSocket 消息的大小上限，决定首次全量拉取和大条目怎么分片。
  - Hibernation 状态下怎么判断在线和推送。
  - 账号认证和设备 token 校验放在 Worker 入口还是 Durable Object 内部。
- 加密开销：新设备首次拉取并解密全部记录的耗时，以及 Node 内置 `crypto` 在 Electron 主进程里的吞吐。
- 派发命令过期时间的默认值（暂定 24 小时）。

## 12. 分阶段

| 阶段 | 内容 | 用户能看到的变化 |
|---|---|---|
| M1 | 本机准备，不联网：设备 id、`owner_device_id` 和回填、`SyncLog`、`WorkerTarget` 拆分、命令和回执模型（本机回环测试） | 没有变化 |
| M2 | 同步服务（Durable Object 适配层）、登录、设备注册和撤销、端到端加密；同步 thread、条目、项目、Worker、会话条目和设备；其他设备的 thread 只读，「在本机继续」 | 每台设备都能看到所有设备的对话和 Worker |
| M3 | 跨设备派发：`RemoteWorkers`、`CommandExecutor`、回执、Worker 事件回到 Router、远程审批、离线排队和过期、提示升版本 | 在 A 上派 B 上的项目；B 离线时任务排队等待 |
| M4 | memory 多设备（RFC_OWLS_MEMORY 第 11 节），可以和 M3 并行 | 所有设备共用同一份记忆 |
| 以后 | 远程查看完整 diff、流式条目实时转发、向其他设备的 thread 代发消息、设置同步 | |

M1 可以单独合入，用现有测试证明单机行为没有变化。
