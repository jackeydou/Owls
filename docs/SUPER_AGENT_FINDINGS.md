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
Claude Code `2.1.316`，Agent SDK `0.3.316`。回放证据位于
`apps/pichu-client/tests/fixtures/providers/`。

## 速查

| 编号 | 摘要 | 状态 |
| --- | --- | --- |
| F1 | Codex 会在每个 thread 中启动用户级 MCP server 和 SessionStart hook | 已确认 |
| F2 | Codex Worker 输出混入用户个人全局指令的内容 | 待处理 |
| F3 | Claude Code 的 `settingSources: []` 不能阻止插件、skills、命令加载；`tools: []` 才能 | 已确认 |
| F4 | 本机 Codex 配置的默认模型不支持当前账号，选「Codex 默认」会失败 | 待验证 |
| F5 | Codex 在用量很低时也会遇到一次性 429 | 待处理 |
| F6 | Codex `dynamicTools` 需要 `experimentalApi`，否则明确报错 | 已确认 |
| F7 | Codex `thread/resume` 没有 `dynamicTools` 参数，但工具定义随 thread 持久化 | 已确认，复查 |
| F8 | Claude Code 中 `allowedTools` 里的工具会绕过 `canUseTool` | 已确认 |
| F9 | 两种引擎的运行中注入都在同一 turn 内生效 | 已确认 |
| F10 | Claude Code 用户消息的 `priority` 字段无文档，实测不影响结果 | 已确认，复查 |
| F11 | 实测在原生会话存储中留下了临时会话 | 已确认 |
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

### F4 本机 Codex 配置的默认模型不支持当前账号

- 现象：不指定 `model` 时，turn 立刻失败：`The 'gpt-6.1-sol' model is not supported when using
  Codex with a ChatGPT account.`（`model_not_found`）。`model/list` 返回的可用模型是
  `gpt-5.6-sol`（默认）、`gpt-5.6-terra`、`gpt-5.6-luna`。
- 复现：用本机配置启动 app-server，`thread/start` 和 `turn/start` 都不传 `model`。
- 影响（推断，待验证）：Owls 中把模型设为「Codex 默认」时不会传 `model`，应该会得到同样的
  失败。这是本机配置问题，但 Owls 可以改进：失败时提示改用账号默认模型，或把「Codex 默认」
  解释为 `model/list` 中 `isDefault` 的模型。
- 复查：在 Owls 中新建一个 Codex 任务，选「Codex 默认」并发送消息。

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
- 复查：CLI 升级后重跑这个场景，因为这是实验接口的隐式行为。

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
