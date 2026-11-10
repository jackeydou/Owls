# Router/Worker 实测发现记录

用途：记录接入原生 agent 和推进 Router/Worker（[RFC](RFC_OWLS_SUPER_AGENT.md)）过程中实测得到的
事实和问题，方便事后回顾，以及在 CLI 或 SDK 升级后定位行为变化。

维护规则：

- 新发现追加到对应章节，编号递增，不改已有编号。
- 每条写清版本、现象、复现方式、证据、影响和状态；推断要明确标注，和实测区分开。
- 状态取值：`已确认`（行为属实，按此设计）、`待处理`（需要后续改动）、`已修复`、
  `待验证`（推断或需要复查）。
- 升级 Codex 或 Claude Code 后，优先复查标注了「复查」的条目。

实测环境（除非条目另有说明）：macOS arm64，Codex CLI `0.148.0`（ChatGPT `prolite` 账号），
Claude Code `2.1.316`，Agent SDK `0.3.316`。F12 起的补充实测使用 Codex CLI `0.166.0`；
F18–F20 使用 pi `1.5.0`。
回放证据位于 `apps/owls-client/tests/fixtures/providers/`。

## 速查

| 编号 | 摘要 | 状态 |
| --- | --- | --- |
| F1 | Codex 会在每个 thread 中启动用户级 MCP server 和 SessionStart hook | 已确认 |
| F2 | Codex Worker 输出混入用户个人全局指令的内容 | 待处理 |
| F3 | Claude Code 的 `settingSources: []` 不能阻止插件、skills、命令加载；`tools: []` 才能 | 已确认 |
| F4 | 本机 Codex 配置的默认模型不支持当前账号，选「Codex 默认」会失败 | 0.166 未复现 |
| F5 | Codex 在用量很低时也会遇到一次性 429 | 待处理 |
| F6 | Codex `dynamicTools` 需要 `experimentalApi`，否则明确报错 | 已确认 |
| F7 | Codex `thread/resume` 没有 `dynamicTools` 参数，但工具定义随 thread 持久化 | 已确认，0.166 复查通过（F26） |
| F8 | Claude Code 中 `allowedTools` 里的工具会绕过 `canUseTool` | 已确认 |
| F9 | 两种引擎的运行中注入都在同一 turn 内生效 | 已确认 |
| F10 | Claude Code 用户消息的 `priority` 字段无文档，实测不影响结果 | 已确认，复查 |
| F11 | 实测在原生会话存储中留下了临时会话 | 已确认 |
| F12 | Codex `thread/start.config` 中的 `mcp_servers: {}` 会合并，不能关闭用户级 MCP | 已确认 |
| F13 | Codex 的 `features.hooks=false` 不能关闭 hooks，系统托管 hook 也会运行 | 已确认，复查 |
| F14 | Codex dynamic tool 依赖 code-mode host，关闭后无法调用 | 已确认，复查 |
| F15 | Codex 总是加载 `~/.codex/AGENTS.md`，`project_doc_max_bytes: 0` 无效 | 已确认 |
| F16 | Claude Code Router 首次调用工具后上下文被注入约 40k token，`strictMcpConfig` 可避免 | 已确认 |
| F17 | Claude Code 每批次一个 query 与常驻 query 的耗时无明显差异 | 已确认 |
| F18 | pi `Agent` 会把工具参数的标量类型转换成 schema 要求的类型 | 已确认，复查 |
| F19 | pi `Agent` 的请求上下文只包含 Owls 提供的系统提示、工具和消息 | 已确认 |
| F20 | pi `Agent` 的 `steer()` 在工具执行期间注入，同一次运行内生效 | 已确认 |
| R6 | 旧 pi runtime 仍在类型检查范围内，锁定 pi `0.84.1` | 已处理（移入 legacy） |
| F21 | pi 的 OpenAI 兼容请求在没有 API key 时直接失败，即使本地端点不需要 key | 已确认 |
| F22 | 失败的模型回复会进入 pi `Agent` 的消息记录 | 已确认 |
| F23 | 本机 Ollama 实测：`qwen3.6:27b` 完成分派闭环，`qwen2.5-coder:7b` 只回复文字不调用工具 | 已确认 |
| F24 | Claude Code Router 会把自己的工作目录写进分派目标 | 已修复（M2） |
| F25 | `allowedTools` 覆盖 `canUseTool` 时 SDK 每次 query 打印警告；改用 `permissionMode: 'dontAsk'` | 已确认 |
| F26 | Codex 0.166 跨进程 `thread/resume` 后 dynamic tool 仍可调用 | 已确认 |
| F27 | `-c mcp_servers.<未知名称>.enabled=false` 使 app-server 启动失败；未知 feature 只被忽略 | 已确认 |
| F28 | Codex Router 每批次约 17.5k token 固定上下文；`tokenUsage/updated` 可能重复发送 | 已确认 |
| F29 | 受信任项目的 `.codex/config.toml` 中的 MCP server 在 `thread/start` 时启动，不带 `cwd` 的 `config/read` 读不到 | 已确认，已修复 |
| F30 | Owls 引擎超出上下文预算后每次请求都重新裁剪，提示缓存全部失效，且裁剪本身是平方复杂度 | 已修复（M4） |
| F31 | 同一 checkout 中可写 Worker 串行，M4 中完成时间是只读 Worker 的 5.6–6.9 倍 | 已修复（worktree，RFC 11.1） |
| F32 | 后台子 agent 的单会话完成时间与 Router 相当，但输入 token 是 4.6 倍，上下文持续增长 | 已确认（脚本化模型） |
| F33 | 追问直通减少 15% 的 Router 请求，追问 p95 从 5.9 分钟降到 3.9 分钟 | 已确认（脚本化模型） |
| R1 | ClaudeService 一轮结束后立即发下一条，会被上一轮的清理误判为失败 | 已修复（#16） |
| R2 | Claude 任务的回复标题写死为「Codex」 | 已修复（#16） |
| R3 | `main` 上的 `pnpm-lock.yaml` 与工作区不同步 | 已修复（#16） |
| R4 | Agent SDK 的 peer 依赖 `@anthropic-ai/sdk` 版本低于要求 | 待处理 |
| R5 | Agent SDK 只发布 ESM，main 进程必须把它打包进来 | 已确认 |

## M0 原生能力实测（2026-11-02）

### F1 Codex 会在每个 thread 中启动用户级 MCP server 和 SessionStart hook

- 现象：用 `thread/start` 新建的 thread（包括 Router 用途的 thread）会收到用户级 MCP server 的
  `mcpServer/startupStatus/updated` 通知，以及来自 `~/.codex/hooks.json` 的 `hook/started`、
  `hook/completed`。
- 复现：用 `codex app-server --listen stdio://` 在任意临时目录中 `thread/start` 并发一轮
  `turn/start`，观察通知。
- 证据：原始探针日志（未入库）；fixture 中已删除这些帧，因为它们描述的是录制机器的配置。
- 影响：Router/Worker 会话不是干净环境；用户的 MCP 和 hook 会消耗启动时间，也可能产生副作用。
  Worker 保留这些配置符合预期；Codex Router 需要找到屏蔽方式（RFC 开放问题 1）。

### F2 Codex Worker 输出混入用户个人全局指令的内容

- 现象：`outputSchema` 探针要求 Worker 汇报「目录为空」。返回的 JSON 合法（`status: done`），
  但 `summary` 中混入了与任务无关、来自用户个人全局指令的内容，并提到一个存储类工具
  「需要审批不可用」。
- 复现：在加载了个人全局指令的账号上，`thread/start`（`approvalPolicy: never`、
  `sandbox: read-only`）后，用带 `outputSchema` 的 `turn/start` 发一个简单的汇报任务。
- 证据：原始探针日志（未入库；因含个人内容，不生成 fixture）。
- 影响：结构化汇报的格式由 schema 保证，但**内容**可能被污染，Router 会读到噪声。
- 后续：M1 中评估 Codex Worker 的 `developerInstructions` 能否压住全局指令；在 Router 视图
  中把汇报当作数据展示；必要时在 Worker 汇报 prompt 中明确「只汇报本任务」。

### F3 Claude Code 的 `settingSources: []` 不能阻止插件、skills、命令加载

- 现象：设置 `settingSources: []` 后，init 消息里仍有内联插件、20 个 skills、56 个 slash commands
  和若干内置 agents。同时设置 `tools: []` 后，可用工具列表只剩 SDK MCP 工具
  `mcp__owls__dispatch_task`。
- 复现：`query()` 时传 `settingSources: []`、`tools: []`、自定义 `systemPrompt` 和一个
  `createSdkMcpServer` 工具，检查 `system/init` 消息里的 `tools`、`plugins`、`skills`。
- 证据：`claude-code/router-mcp-tool.jsonl`（init 中的插件、skills 等列表已脱敏清空，
  `tools` 字段保留原样）。
- 影响：Router 的隔离必须依赖**工具白名单**（`tools: []` + `allowedTools`），不能只依赖
  settings。该环境中的内联插件可能来自宿主工具注入，其他机器上可能不同。
  补充实测（F16）表明还需要 `strictMcpConfig: true`。

### F4 本机 Codex 配置的默认模型不支持当前账号

- 现象：不指定 `model` 时，turn 立刻失败：`The 'gpt-6.1-sol' model is not supported when using
  Codex with a ChatGPT account.`（`model_not_found`）。`model/list` 返回的可用模型是
  `gpt-5.6-sol`（默认）、`gpt-5.6-terra`、`gpt-5.6-luna`。
- 复现：用本机配置启动 app-server，`thread/start` 和 `turn/start` 都不传 `model`。
- 影响（推断，待验证）：Owls 中把模型设为「Codex 默认」时不会传 `model`，应该会得到同样的
  失败。这是本机配置问题，但 Owls 可以改进：失败时提示改用账号默认模型，或把「Codex 默认」
  解释为 `model/list` 中 `isDefault` 的模型。
- 复查：在 Owls 中新建一个 Codex 任务，选「Codex 默认」并发送消息。
- 0.166.0 复查（2026-11-02）：`model/list` 的默认模型变为 `gpt-6.1-sol`，不指定 `model`
  的探针均正常完成，未复现。`model/list` 的默认值与账号可用模型可能随 CLI 或账号变化，
  Owls 仍应在 `model_not_found` 时给出可操作的提示。

### F5 Codex 在用量很低时也会遇到一次性 429

- 现象：连续快速创建多个 thread 和 turn 时，turn 失败：`exceeded retry limit, last status: 429
  Too Many Requests`。`account/rateLimits/read` 显示周用量 8%，`rateLimitReachedType` 为 null。
  改为逐个运行后恢复正常。
- 影响：Router 并发分派多个 Codex Worker 时可能触发。目前 Owls 把它显示为通用的
  `native_error`。
- 后续：区分限流错误，展示「稍后重试」；Worker 并发启动时错开时间。不使用账号的
  rate-limit reset credit（属于用户自己的额度决策）。

### F6 Codex `dynamicTools` 需要 `experimentalApi`

- 现象：`initialize` 中声明 `experimentalApi: false` 时，带 `dynamicTools` 的 `thread/start`
  返回错误：`thread/start.dynamicTools requires experimentalApi capability`。
- 影响：这个错误便于识别；Codex Router 的 adapter 可以据此判断能力并降级。Owls 现有的
  Codex 客户端写死了 `experimentalApi: false`（`src/main/codex/client.ts`）。

### F7 Codex 工具定义随 thread 持久化

- 现象：非 ephemeral thread 用 `dynamicTools` 创建后结束进程；新进程 `thread/resume`
  （该接口没有 `dynamicTools` 参数）后发一轮，Codex 仍然调用了 `dispatch_task`。
- 影响：Codex Router 重启后无需重新声明工具；但工具定义的变更无法通过 resume 下发，
  更新工具契约时需要新建 thread。
- 复查：CLI 升级后重跑这个场景，因为这是实验接口的隐式行为。0.166.0 尚未复查；
  F14 显示 dynamic tool 的调用路径依赖 code-mode host，复查时一并确认。

### F8 Claude Code 中 `allowedTools` 里的工具会绕过 `canUseTool`

- 现象：SDK 警告 `[CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] canUseTool will not be invoked for:
  mcp__owls__dispatch_task`；列入 `allowedTools` 的工具直接自动批准。
- 影响：Router 的 Owls 工具应该自动批准，这符合预期。如果以后需要逐次审核某个工具，
  要改用 `PreToolUse` hook，或者不把它放进 `allowedTools`。

### F9 运行中注入在同一 turn 内生效

- 现象：命令执行期间注入一句「最终回复必须包含 STEERED」，两种引擎都在**同一 turn** 内采纳，
  最终回复为 `SLEPT STEERED`，只产生一个 turn 或 result。Codex 用 `turn/steer`；
  `expectedTurnId` 不匹配时报错 `expected active turn id \`stale-turn-id\` but found \`<id>\``。
- 证据：`codex/worker-steer.jsonl`、`claude-code/worker-steer.jsonl`。
- 影响：Router 运行中收到的用户消息可以即时注入（RFC 第 7 节）；一个 Router turn 可能因注入而延长，
  所以非用户事件留到下一批次。

### F10 Claude Code 用户消息的 `priority` 字段无文档

- 现象：`SDKUserMessage.priority` 可取 `now`、`next`、`later`，类型里没有说明。实测不带该字段和
  带 `priority: 'next'` 的注入效果一致。
- 影响：实现中不依赖该字段。
- 复查：SDK 升级后查看类型注释是否补充了语义。

### F11 实测在原生会话存储中留下了临时会话

- 现象：「重启后工具保留」探针需要非 ephemeral 会话，因此在 Codex 和 Claude Code 的原生会话
  存储中各留下一个临时会话（对应的临时目录已删除）。其他探针使用 ephemeral thread 或
  `persistSession: false`。
- 影响：会在原生 CLI 的历史中看到 `owls-m0-resume-*` 目录下的会话，可以手动删除。

## Router 隔离与进程模型补充实测（2026-11-02）

对应 RFC 4.2 节。Codex 探针使用 ephemeral thread；Claude Code 探针在结束时删除临时目录
及其 `~/.claude/projects/` 下的会话记录，本轮没有遗留原生会话。原始探针日志含本机 MCP、
hook 和插件信息，未入库。

### F12 Codex `thread/start.config` 中的 `mcp_servers: {}` 会合并

- 现象：`thread/start.config` 关闭 `plugins`、`apps` 等 features 后，来自插件和 apps 的
  MCP server 不再启动（11 个 → 2 个），但配置文件中声明的 server 仍然启动。再加
  `mcp_servers: {}` 结果相同。模型在 `features.shell_tool=false` 的情况下，经用户的
  `node_repl` MCP 执行了 shell 命令（`mcpToolCall`）。
- 复现：`thread/start` 传 `config: { 'features.shell_tool': false, ..., mcp_servers: {} }`，
  要求模型执行 `echo PROBE_SHELL`，观察 `mcpServer/startupStatus/updated` 和 item 类型。
- 处理：在 app-server **启动参数**中按名称逐个设置 `-c mcp_servers.<name>.enabled=false`
  后，没有 MCP server 启动，shell 也无法执行。server 名称可以从 `config/read` 读取。
- 影响：关闭 shell 必须同时关闭用户 MCP；只关 `shell_tool` 不够。

### F13 Codex 的 `features.hooks=false` 不能关闭 hooks

- 现象：无论放在 `thread/start.config` 还是 app-server 启动参数 `-c` 中，`sessionStart`、
  `userPromptSubmit`、`stop` 等 hooks 仍然运行。其中包括 `source: system` 的系统托管 hook
  （企业设备管理下发）。
- 影响：Codex 会话无法得到不运行 hooks 的环境，这是 Codex Router 不进入 M1–M4 的主要原因
  （RFC 4.3 节）。Worker 运行 hooks 符合预期。
- 复查：CLI 升级后检查是否提供了关闭 hooks 的配置或 app-server 参数。

### F14 Codex dynamic tool 依赖 code-mode host

- 现象：启动参数加 `features.code_mode_host=false` 后，模型无法调用 `dispatch_task`，
  回复 `code-mode host is disabled`，客户端收不到 `item/tool/call`。保持开启时，
  `item/tool/call` 和 `dynamicToolCall` 的形状与 0.148 相同。
- 影响：Codex Router 不能通过关闭 code mode 来减少工具；code mode 的 `functions.exec`
  会一直暴露给模型。
- 复查：CLI 升级后重跑，这是实验接口的实现细节。

### F15 Codex 总是加载 `~/.codex/AGENTS.md`

- 现象：所有变体的 `thread/start` 响应中，`instructionSources` 都包含 `~/.codex/AGENTS.md`；
  `project_doc_max_bytes: 0` 只影响项目文档。
- 影响：F2 的内容污染在 Codex 会话中无法从配置层面消除，只能靠角色说明和把汇报当数据展示。

### F16 Claude Code Router 首次调用工具后上下文被注入约 40k token

- 现象：Router 设置 `tools: []`、`settingSources: []`、自定义 `systemPrompt` 时，不调用工具的
  一轮上下文约 1.3k token（流式输入、字符串 prompt、是否持久化会话都相同）。调用
  `mcp__owls__dispatch_task` 后，下一次请求的上下文约 42k token，cache read 为 0。
  init 消息中的 `mcp_servers` 只有 `owls`，`tools` 只有 Owls 工具。
- 复现：同上配置，prompt 为「Please count the files in the repo.」，读取每条 assistant
  消息的 `usage`。
- 对照：`skills: []`、`extraArgs: { 'disable-slash-commands': null }` 都无效；
  `strictMcpConfig: true` 单独即可把整轮降到约 2.9k token，第二次请求命中缓存。
- 影响：Router 必须设置 `strictMcpConfig: true`，否则每个分派批次多付约 40k token 的缓存写入。
  注入内容的来源是推断（`mcpServers` 之外的 MCP 配置，例如宿主或插件提供的 server），
  未直接观察到。M0 的 F3 实测没有调用后的第二次请求用量，因此当时没有发现。
- `--bare` 能跳过更多加载，但只接受 API key 认证，不适用于订阅账号，未采用。

### F17 Claude Code 每批次一个 query 与常驻 query 的耗时无明显差异

- 现象：三个连续批次（分派、汇报加追问、简单回复），两轮运行，均设置 `strictMcpConfig`。
  每批次一个 query（`resume`）的 init 为 0.32–0.38 秒，到 result 为 4.8–6.2 秒；
  常驻 query 的 init 为 0.28–0.34 秒（仅首次），每批次到 result 为 2.2–6.9 秒。
  最早一次未设 `strictMcpConfig` 的运行中，冷启动 init 为 2.4 秒。
- 影响：进程开销可以忽略，RFC 8.1 节选择每批次一个 query。
- 注意：两次运行的模型均为 CLI 默认的 `claude-opus-5-5`；样本量小，只作量级参考。

## Owls 引擎离线实测（2026-11-02）

对应 RFC 4.4 节。`@earendil-works/pi-agent-core`、`pi-ai`、`pi-schema` `1.5.0` 安装在仓库外的
临时目录中，用 pi-ai 的 `fauxProvider` 驱动，没有网络请求和凭据。探针为一个只有
`dispatch_task` 的 `Agent`，faux 响应工厂记录每次请求收到的上下文。

### F18 pi `Agent` 会把工具参数的标量类型转换成 schema 要求的类型

- 现象：`dispatch_task` 的 `parameters` 要求 `goal` 为字符串，模型（faux）传入 `goal: 42`，
  工具的 `execute` 照常执行，返回 `isError: false` 的结果。M1 实现中复测：`execute` 收到的是字符串
  `"42"`，所以 Owls 的 zod 校验也通过；而多余字段或空白 `goal` 会被 pi 用自己的
  `Validation…` 错误拒绝，不会到达 `execute`。
- 影响：Owls 不能依赖引擎的参数校验；工具处理器统一先用 zod 校验（RFC 第 5 节）。被转换的标量
  不会造成越权，因为权限、provider 等枚举值仍由 zod 校验。
- 复查：升级 pi 后重跑；即使 pi 改为拒绝，处理器中的校验也保留。

### F19 pi `Agent` 的请求上下文只包含 Owls 提供的内容

- 现象：首次请求的上下文是一条 system 消息（`content` 为系统提示，`toolsAdded` 为工具声明）
  加一条用户消息，序列化后 434 字节。设置 `prepareRequest` 后，请求中的消息列表被完全替换，
  `agent.state.messages` 中的完整记录不变。
- 影响：Owls 引擎的上下文可以确定性地构建和测试，这是选择它作为默认 Router 引擎的主要依据
  （RFC 4.3 节）。真实 provider 会在此基础上加上自己的请求格式，固定上下文大小需要在 M1 用真实
  模型测量。

### F20 pi `Agent` 的 `steer()` 在同一次运行内生效

- 现象：工具执行期间调用 `agent.steer()`，注入的用户消息出现在工具结果之后、下一次请求之前，
  同一次 `prompt()` 内完成；`execute` 抛出的错误成为 `isError: true` 的工具结果。
- 影响：Owls 引擎与另外两个引擎一样支持运行中注入（RFC 第 8 节）。

### R6 旧 pi runtime 仍在类型检查范围内

- 现象：构建入口已是 `src/main/app/desktop.ts`，但仍有 41 个文件引用
  `@earendil-works/pi-agent-core` 或 `pi-ai` `0.84.1`：`src/main` 34 个、`src/shared` 2 个、
  `src/renderer` 4 个、`src/preload` 1 个，分别在 `typecheck:node` 和 `typecheck:web` 的范围内。
  npm 上的最新版本是 `1.5.0`，1.x 用 `createModels()` 取代了全局 `getModel()` 等 API。
- 影响：直接升级会让旧代码无法通过类型检查。
- 处理：#18 尝试直接删除，后按维护者要求关闭。改为把构建入口不可达的 338 个源文件和覆盖它们的
  31 个测试与 fixture 移到 `apps/owls-client/legacy/`，保留原目录结构；legacy 不参与构建、类型检查、
  lint 和测试。pi 升级到 `1.5.0`，`pi-coding-agent` 和它带来的 photon wasm 复制步骤移除。

### F21 pi 的 OpenAI 兼容请求在没有 API key 时直接失败

- 现象：Owls 引擎连本机 Ollama（`custom` 端点，`getApiKey` 返回 `undefined`）时，批次立即失败：
  `No API key for provider: custom`。`createProvider` 的 `auth.apiKey.resolve` 返回空 auth 也一样。
- 处理：对不需要 key 的 `custom` 端点传入固定占位值 `owls-local`（不是机密）；本地服务器会忽略它。
- 证据：本机实测；faux provider 不经过这条路径，所以单元测试没有发现。

### F22 失败的模型回复会进入 pi `Agent` 的消息记录

- 现象：F21 的失败批次之后，`agent.state.messages` 中留下了一条 `stopReason: 'error'`、内容为空的
  assistant 消息，并被持久化到 `codex_router_messages`。下一批次会把它带进上下文。
- 处理：批次以 `error` 或 `aborted` 结束时，从内存和持久化记录中去掉这条 assistant 消息，保留用户
  消息。回归测试：`router-runtime.test.mjs`「a failed model response is not kept」。

### F23 本机 Ollama 实测

- 环境：Ollama.app 提供的 OpenAI 兼容端点 `http://127.0.0.1:11434/v1`，假的 Worker host（不启动
  真实任务），经打包后的 `out/main/app/runtime.js` 运行。
- `qwen3.6:27b`：第一批次调用 `dispatch_task`（约 24 秒，含模型加载），创建一个 Codex Worker 并回复；
  注入假汇报后，第二批次按汇报回复「There are 42 TypeScript files in this project.」。记录为
  `user, assistant, toolResult, assistant, user, assistant`。
- `qwen2.5-coder:7b`：约 5 秒内回复「I will start a background worker…」，但没有调用工具。
- 影响：Owls 引擎的请求、工具调用和持久化路径在真实 provider 上可用；Router 质量取决于模型的工具
  调用能力，推荐模型需要在 M4 评估（RFC 开放问题 4）。

## Claude Code Router 引擎实测（M2，2026-11-03）

经打包后的 `out/main/app/runtime.js` 运行 `ClaudeEngine`，使用真实 Agent SDK 与本机 Claude Code
`2.1.316`，假的 `dispatch_task`（不启动 Worker）。两个批次：分派，然后 `resume` 后追问 Worker ID。
结束时删除临时目录及其 `~/.claude/projects/` 下的会话记录。

- 结果：第一批次调用 `dispatch_task` 并回复，usage 为 input 4、cache read 约 1.4–2.1k、
  cache write 约 1.6k、output 约 200，与 F16 中设置 `strictMcpConfig` 后的量级一致；第二批次
  `resume` 同一会话，正确回答 `w_live`，约 4–5 秒。

### F24 Claude Code Router 会把自己的工作目录写进分派目标

- 现象：Router 的 `cwd` 设为 Owls 自己的目录时，模型生成的 `goal` 写成「Count the TypeScript files
  … in the directory /private/var/…/owls-router-live-…」。即使 `systemPrompt` 是自定义字符串，
  Claude Code 仍会告诉模型当前工作目录。
- 影响：Worker 在项目目录运行，目标里的路径会把它引向错误的位置。
- 处理：Claude Code Router 以项目路径作为 `cwd`。代价是 Router 的原生会话出现在该项目的
  Claude Code 历史中（`claude --resume`）。复测后目标中的路径即为项目路径。

### F25 `allowedTools` 覆盖 `canUseTool` 时 SDK 打印警告

- 现象：同时设置 `allowedTools: ['mcp__owls__dispatch_task']` 和一个拒绝一切的 `canUseTool` 时，
  SDK 每次 query 都发出 `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` 进程警告（与 F8 是同一行为）。
- 处理：去掉 `canUseTool`，改用 `permissionMode: 'dontAsk'`：未预先批准的工具直接拒绝，不弹审批。
  `tools: []` 下本来也没有其他工具。

## Codex Router 引擎实测（M3，2026-11-03）

Codex CLI `0.166.0`。先用独立脚本复现 RFC 4.2 节的锁定进程，再经打包后的
`out/main/app/runtime.js` 运行 `CodexEngine` 和真实 `CodexRouterServer`，假的 `dispatch_task`。

- 锁定进程（18 个 features 关闭、3 个配置中的 MCP server 逐个关闭、`web_search="disabled"`）：
  没有 MCP server 启动，模型回复「无法运行命令」，`dispatch_task` 正常调用；hooks 仍运行
  （一个 turn 中 22 个 hook 帧），`instructionSources` 仍含 `~/.codex/AGENTS.md`（F13、F15 复查）。
- 引擎：第一批次（含两个进程启动）约 30 秒，分派一次并回复；随后关闭进程，第二批次在新进程中
  `thread/resume` 同一 thread，约 8 秒，再次分派并正确说出两个 Worker ID。

### F26 Codex 0.166 跨进程 `thread/resume` 后 dynamic tool 仍可调用

- 现象：第一个 app-server 进程中用 `dynamicTools` 启动的 thread，在新进程中 `thread/resume`
  （不传工具）后，模型仍能调用 `dispatch_task`，客户端收到 `item/tool/call`。
- 影响：Codex 引擎重启后直接 `resume`，不需要新建 thread；F7 在 0.166 上成立。

### F27 未知 MCP server 名称使 app-server 启动失败

- 现象：`codex app-server -c mcp_servers.no_such_server.enabled=false` 直接退出，报
  `invalid transport in mcp_servers.no_such_server`；`-c features.no_such_feature=false` 只打印
  「ignoring 1 unrecognized configuration setting」，进程照常初始化。
- 处理：MCP server 名称必须来自 `config/read`（`CodexRouterServer` 先启动一个普通进程读取）；
  feature 列表可以写成常量，CLI 改名或删除时不会导致启动失败。

### F28 Codex Router 的固定上下文与重复的用量事件

- 现象：锁定进程中，每个 Router 请求约 17.5k 输入 token（第二次起大部分是缓存读取），约为
  Claude Code 引擎（F24 实测约 3k）的 6 倍，来自 code mode、原生指令和全局 `AGENTS.md`。
  同一请求的 `thread/tokenUsage/updated` 有时连续发送两次，`last` 完全相同。
- 处理：Codex 引擎按 `total.totalTokens` 去重后再累计用量。上下文成本记入 RFC 开放问题 7。

### F29 项目配置中的 MCP server 绕过 Codex Router 的隔离

- 来源：PR #21 的 Codex 安全审查（P1）。
- 现象：项目受信任时（`~/.codex/config.toml` 中 `trust_level = "trusted"`），项目
  `.codex/config.toml` 声明的 MCP server 会在 `thread/start`（`cwd` 为项目路径）时作为子进程
  启动，`sandbox: read-only` 不限制它。不带 `cwd` 的 `config/read` 只返回用户层配置，读不到这些
  名称，所以 Router 进程没有关闭它们。打开项目并发送一条 Router 消息，就会运行仓库指定的命令。
  另外两点：在项目外启动的 app-server 带 `-c mcp_servers.<项目中的名称>.enabled=false` 会因
  F27 启动失败；运行中的 app-server 每次 `thread/start` 都重新读项目配置，启动后新增的 server
  也会运行。
- 复现：临时 `CODEX_HOME` 中信任一个临时仓库，仓库配置一个 `command = "sh"` 的 server 创建标记
  文件；Codex 0.166.0 下按 PR #21 的方式启动，`thread/start` 后标记文件出现。
- 处理：`config/read` 传 `cwd`（返回该目录看到的有效配置，含项目层）；每个项目目录一个 Router
  app-server，进程的工作目录就是项目目录；每次 `thread/resume` 或 `thread/start` 之前（已加载的
  thread 不重复检查）从运行中的进程再读一次配置，出现未关闭的 server 时重启进程。同样的实测中
  原有 server 和中途新增的 server 都不再启动。
- 未验证：已加载的 thread 在后续 turn 中是否会启动配置中新增的 server（需要登录才能发起 turn）。

## M4 消融实验（2026-11-03）

`pnpm --filter owls-client bench:router`，设置与完整结果见 RFC 14.1 节。打包后的
`RouterService`、`WorkerPool` 和 Owls 引擎由脚本化的 pi faux provider 驱动，时间走虚拟时钟；
以下数字是 5 个种子的平均，单种子的数字会标明。

### F30 Owls 引擎超出上下文预算后提示缓存全部失效

- 现象：Router 的上下文一旦超过 `ROUTER_CONTEXT_BUDGET`，`trimContext` 在每次请求时都从头重新
  计算裁剪位置，并把最新的 Worker 状态摘要拼到第一条保留的消息前面。裁剪位置随每个新批次后移，
  摘要也随 Worker 状态变化，所以相邻两次请求只有系统提示相同。种子 1001 中 Router 的输入
  3693k token 只有 28% 可以命中缓存（同一负载的单会话为 99%）。另外 `trimContext` 对每个候选
  位置重新序列化全部消息，是平方复杂度：修复前 7 组基准约 54 秒，修复后 2.9 秒。
- 影响：长时间运行的 Router 每个请求都按全价付约 12k token 的上下文；main 进程在每次请求前
  同步序列化整段历史。
- 修复：超出预算时一次裁到预算的 60%，Owls 引擎记住裁剪位置和当时的摘要，直到剩余部分再次
  超出预算才重新裁剪；后缀大小一次累加，线性复杂度。种子 1001 的未缓存输入从约 2659k 降到 327k。
  回归测试：`router-runtime.test.mjs` 中的
  「trimContext keeps its cut and note until the context outgrows the budget again」。

### F31 同一 checkout 中可写 Worker 串行

- 现象：RFC 11 节规定同一 checkout 上权限不是 `read-only` 的 Worker 串行执行。基准中 Worker 都以
  `workspace-write` 分派时，工作完成时间 p50 47.5 分钟、p95 100.3 分钟，只读 Worker 为 8.5 和
  14.5 分钟。
- 影响：`dispatch_task` 不指定权限时取项目默认权限（通常是 `workspace-write`），所以实际使用中
  Router 分派的改代码任务基本是串行的，双层架构的并行收益只对只读任务成立。
- 修复：可写 Worker 默认各自使用一个 git worktree，分支 `owls/<workerId>`（RFC 11.1 节）；
  写入者只在共用同一个 checkout 时串行。
- 复测（`bench:router`，5 个种子，worktree 创建按每个 2 秒计）：「Worker 都可写，各自 worktree」组
  工作 p50 / p95 为 8.52 / 14.53 分钟，只读组为 8.46 / 14.45 分钟，同目录串行组仍为 47.54 / 100.28
  分钟。差值约 4 秒，来自 worktree 的创建时间。
- 局限：创建耗时是假设；真实仓库中 Worker 还可能需要在 worktree 里安装依赖，这部分不在基准中。

### F32 后台子 agent 的单会话与 Router 完成时间相当，成本更高

- 现象：单会话用前台子 agent（等待结果再继续）时工作 p95 28.5 分钟、闲聊 p95 914 秒；改用
  后台子 agent（结果作为新消息到达）后工作 p50 / p95 为 8.1 / 14.5 分钟，与 Router 的 8.5 / 14.5
  相当。代价是上下文一小时后达到 65k 且持续增长，输入 token 12082k，是 Router 的 4.6 倍；按缓存
  命中计 10% 折算约为 Router 的 2.2 倍。
- 影响：Router 的完成时间优势来自不阻塞，后台子 agent 也能做到；Router 的优势在于上下文有界、
  Worker 隔离和成本。该结论依赖耗时模型（缓存 token 的预填充成本只算 10%），需要实机校准。

### F33 追问直通减少 Router 决策

- 现象：去掉追问直通（追问先发给 Router，再由 `message_worker` 转给 Worker）后，Router 请求从
  316 增加到 374，批次从 257 增加到 283；追问 p50 / p95 从 2.2 / 3.9 分钟变为 2.7 / 5.9 分钟，
  工作 p95 从 14.5 变为 15.5 分钟。
- 影响：与文章的方向一致：直通在不改变结果的前提下减少协调层的负载和排队。

## Claude Code runtime 接入（PR #16，2026-11-01）

### R1 一轮结束后立即发下一条，被误判为失败

- 现象：`result` 消息到达后会话状态已经是 idle，但上一轮的 `for await` 收尾还没执行。
  此时立即发出的下一条消息，会被上一轮的收尾逻辑当作「未结束就断开」，标记为
  `claude_disconnected`（错误信息为空）。手动调试时隔了 15 秒，所以没复现；`verify:claude`
  连发时稳定复现。
- 修复：一轮在收到 result 时立即释放会话所有权；收尾逻辑只在自己仍是当前 runtime 时才修改会话
  （`src/main/claude/service.ts` 的 `release`）。回归测试：`claude-runtime.test.mjs` 中的
  `linger` 场景。

### R2 Claude 任务的回复标题写死为「Codex」

- 现象：UI 截图中，Claude Code 任务的助手消息标题显示「Codex」。
- 修复：`ConversationItem` 接收 `agent` 参数；UI 冒烟测试断言标题为「Claude Code」。

### R3 `main` 上的 lockfile 与工作区不同步

- 现象：`pnpm-lock.yaml` 中有仓库里不存在的 `apps/website` importer，oxc 版本也是旧的；
  执行 `pnpm install` 会产生大量与任务无关的变更。
- 处理：在 #16 中随依赖变更一起同步，并在 PR 中说明。

### R4 Agent SDK 的 peer 依赖版本低于要求

- 现象：`@anthropic-ai/claude-agent-sdk@0.3.316` 要求 `@anthropic-ai/sdk >=0.93.0`，工作区解析到
  `0.91.1`（其他依赖引入）。
- 影响：只影响类型定义，typecheck 通过；运行时不加载该包。
- 后续：在合适的时机统一升级 `@anthropic-ai/sdk`。

### R5 Agent SDK 只发布 ESM，main 进程必须打包

- 现象：SDK 只发布 ESM；main 进程默认把依赖外部化。
- 处理：在 `electron.vite.config.ts` 的 `externalizeDeps.exclude` 中加入 SDK，使用
  `/core` 入口；未使用的设置解析分包会被 tree-shaking 去掉。SDK 的平台 CLI 包通过
  `ignoredOptionalDependencies` 排除，确保不会回退到内置 CLI。
