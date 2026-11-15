// Simplified Chinese copy. Mirrors en.mjs key for key.
export default {
  meta: {
    title: 'Owlto：在 Mac 上把 Claude Code、Codex、Cursor 组成一支编程团队',
    description:
      'Owlto 是一款免费开源的 macOS 应用，用来统一调度 AI 编程智能体。你只需和一只 Router 猫头鹰对话，它负责规划任务、并行调度 Claude Code、Codex 和 Cursor，并汇总结果。',
    ogAlt: 'Owlto：Mac 上的一支猫头鹰编程团队',
    keywords:
      'Owlto, AI 编程智能体, 多智能体协作, 多 Agent 编排, Claude Code, Codex, Cursor, macOS 应用, 并行编程, Agent 调度'
  },
  nav: {
    skip: '跳到正文',
    how: '工作方式',
    features: '功能',
    owls: '猫头鹰们',
    start: '快速开始',
    faq: '常见问题',
    download: '下载',
    github: 'GitHub',
    theme: '切换白天或夜晚',
    language: '语言',
    menu: '菜单'
  },
  hero: {
    kicker: '免费开源 · macOS',
    title: ['Mac 上的一支', '猫头鹰', '编程团队'],
    sub: '把需求告诉一只猫头鹰就行。它来规划任务，把每一部分交给 Claude Code、Codex 或 Cursor，全程盯着进度，最后给你一个清楚的答复。',
    cta: '下载 macOS 版',
    ctaNote: 'Apple 芯片 · macOS 13 及以上',
    secondary: '看看它怎么干活',
    hoots: ['咕咕！', '收到。', '叫我吗？', '正在提交…', 'LGTM'],
    owlLabels: {
      router: 'Router 猫头鹰',
      claude: 'Claude Code 猫头鹰',
      codex: 'Codex 猫头鹰',
      cursor: 'Cursor 猫头鹰',
      team: '另一只干活的猫头鹰'
    },
    hint: '它们在盯着你的鼠标。点一只试试。'
  },
  chaos: {
    kicker: '问题在哪',
    title: '六个终端，三个智能体，只有一个你。',
    body: '同时跑几个编程智能体，就得同时盯着几个窗口：谁卡住了，谁在等你点头，谁又改了同一个文件。Owlto 把这一切收进一段对话里。',
    alerts: ['等待批准', '还在运行…', '这是哪个标签页？', '需要输入'],
    after: '一个对话框，杂事交给 Router。',
    you: '加上深色模式，并补上测试。',
    router: '收到。三只猫头鹰已经开工，做完向你汇报。'
  },
  demo: {
    kicker: '工作方式',
    title: '说一次，剩下的交给 Router。',
    body: '选一个需求，看 Router 如何规划、拆给多个 worker、停下来等你批准，再把结果汇总给你。',
    note: 'Owlto 对话界面的模拟演示。',
    try: '试一个需求',
    placeholder: '让 Router 规划、派发或跟进…',
    send: '发送',
    projects: '项目',
    working: '进行中',
    done: '已完成',
    planning: '规划中',
    approve: '批准',
    approved: '已批准',
    approvalTitle: '需要你确认',
    replay: '重新播放',
    steps: [
      {
        title: '用大白话提需求',
        text: '按 ⌘N 新建对话，描述你想要什么；输入 @ 可以选择项目，或直接找某个 worker。'
      },
      {
        title: 'Router 规划并派发',
        text: '它把任务拆开，把每一部分交给合适的 worker：Claude Code、Codex 或 Cursor。'
      },
      {
        title: '多个 worker 并行工作',
        text: '每个 worker 都有一份独立的项目副本，可以同时改代码，互不冲突。'
      },
      {
        title: '你只收到一个清楚的答复',
        text: '需要批准的操作会停在输入框上方。任务完成后，Router 汇总都改了什么。'
      }
    ],
    scenarios: [
      {
        chip: '加深色模式并补测试',
        project: 'bookshelf',
        prompt: '给设置页加上深色模式，并补上测试。',
        plan: '我把它拆成三部分，分给团队去做。',
        workers: [
          {
            owl: 'claude',
            name: 'Claude Code',
            task: '深色模式开关',
            log: ['读取 src/settings', '编辑 ThemeToggle.tsx', '运行 pnpm typecheck']
          },
          {
            owl: 'codex',
            name: 'Codex',
            task: '主题开关测试',
            log: ['编写 toggle.test.ts', '运行 pnpm test', '12 个测试通过']
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            task: '颜色变量',
            log: ['扫描写死的颜色', '编辑 tokens.css', '运行 build:tokens']
          }
        ],
        approval: { who: 'Codex', command: 'pnpm add -D @testing-library/react' },
        report: '完成。设置页已支持深色模式，包含开关、颜色变量和 12 个通过的测试。',
        stats: ['3 个 worker', '改动 9 个文件', '已创建 PR #128', '检查通过']
      },
      {
        chip: '修复不稳定的结账测试',
        project: 'billing',
        prompt: '结账测试时好时坏，找出原因并修复，然后提一个 PR。',
        plan: '一只找原因，一只写修复，一只防止复发。',
        workers: [
          {
            owl: 'claude',
            name: 'Claude Code',
            task: '定位竞态',
            log: ['把测试跑 50 遍', '读取 checkout.ts', '发现一处漏掉的 await']
          },
          {
            owl: 'codex',
            name: 'Codex',
            task: '修复并验证',
            log: ['编辑 checkout.ts', '运行 pnpm test', '50 次全部通过']
          },
          {
            owl: 'claude',
            name: 'Claude Code',
            task: '回归测试',
            log: ['编写 proration.test.ts', '运行 pnpm test', '更新 CHANGELOG']
          }
        ],
        approval: { who: 'Claude Code', command: 'git push origin fix/checkout-race' },
        report: '已修复。测试和一个没有 await 的支付调用存在竞态，现在连续 50 次通过。',
        stats: ['3 个 worker', '改动 3 个文件', '已创建 PR #131', '检查通过']
      },
      {
        chip: '升级到 Node 22',
        project: 'api-server',
        prompt: '把项目升级到 Node 22，并更新 CI 镜像。',
        plan: '依赖、类型和 CI 可以并行推进，派三只猫头鹰去做。',
        workers: [
          {
            owl: 'codex',
            name: 'Codex',
            task: '升级 Node 和依赖',
            log: ['编辑 package.json', '运行 pnpm install', '运行 pnpm test']
          },
          {
            owl: 'claude',
            name: 'Claude Code',
            task: '修复 stream 类型',
            log: ['运行 pnpm typecheck', '编辑 src/stream.ts', '0 个类型错误']
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            task: '更新 CI 镜像',
            log: ['读取 .github/workflows', '编辑 ci.yml', '检查构建矩阵']
          }
        ],
        approval: { who: 'Codex', command: 'pnpm install' },
        report: '升级完成。项目在 Node 22 上构建和测试通过，CI 已使用新镜像。',
        stats: ['3 个 worker', '改动 6 个文件', '已创建 PR #134', '检查通过']
      }
    ]
  },
  owls: {
    kicker: '认识猫头鹰们',
    title: '一只 Router，一群 worker。',
    body: 'Owlto 直接使用你已经在用的编程智能体。每个智能体都是一只猫头鹰，谁在忙一眼就能看出来。',
    hover: '把鼠标移上去或点一下，让它开工。',
    cards: [
      {
        id: 'router',
        name: 'Router',
        role: '和你对话的那一只',
        text: '规划任务、挑选合适的 worker，并汇总它们的成果。可由 Claude Code 或 Codex 驱动。'
      },
      {
        id: 'claude-code',
        name: 'Claude Code',
        role: 'Worker',
        text: '由你在 Mac 上安装并登录的 Claude Code 驱动的 worker。'
      },
      {
        id: 'codex',
        name: 'Codex',
        role: 'Worker',
        text: '由 Mac 上的 Codex 驱动的 worker，使用你的 ChatGPT 账号登录。'
      },
      {
        id: 'cursor',
        name: 'Cursor',
        role: 'Worker',
        text: '由 Mac 上的 Cursor agent 驱动的 worker。Cursor 可以干活，但不能担任 Router。'
      }
    ]
  },
  features: {
    kicker: '功能',
    title: '一群猫头鹰需要的，都在这里。',
    body: '为同时使用多个编程智能体的人而做：读一份汇报，胜过盯六个终端。',
    items: {
      parallel: {
        title: '多个 worker 同时开工',
        text: '每个 worker 都有一份独立的项目副本，可以同时修改代码，互不干扰。'
      },
      map: {
        title: '全局地图',
        text: '所有项目和猫头鹰都在一张图上，谁在工作、谁在等待、谁已完成一目了然。按 ⌘J 在对话和地图之间切换。'
      },
      approvals: {
        title: '批准权在你手里',
        text: '当猫头鹰要做需要你确认的操作时，请求会停在输入框上方等你。',
        sample: 'Codex 想要运行'
      },
      story: {
        title: '每个 worker 的来龙去脉',
        text: '打开任意 worker，先看它的汇报，再看完整过程：改动文件列表，以及每处改动的并排对比。'
      },
      prs: {
        title: 'PR 集中管理',
        text: '猫头鹰们创建的所有 PR 都在一处，附带合并、评审和检查状态，并按需要你处理的优先排序。',
        rows: [
          ['深色模式开关', '检查通过'],
          ['修复结账竞态', '等待评审'],
          ['升级 Node 22', '已合并']
        ]
      },
      notes: {
        title: '笔记与白板',
        text: '把有用的回答存成笔记，用标签整理，在白板上排布，还能附加到新消息里。按 ⌘K 打开笔记。',
        tags: ['架构', '发布', '想法']
      },
      openIn: {
        title: '在常用应用中打开',
        text: '从某个 worker 直接跳到你熟悉的工具里。',
        apps: [
          'VS Code',
          'Cursor',
          'Zed',
          'Xcode',
          'JetBrains IDE',
          'Finder',
          'Terminal',
          'Ghostty'
        ]
      },
      usage: {
        title: '用量一目了然',
        text: '查看每个智能体的套餐还剩多少，并在设置中浏览每日用量和预估花费。'
      }
    },
    more: [
      '用 @ 直接找某个 worker',
      '打开文件夹、克隆仓库或新建空项目',
      '自动更新：稳定版或测试版',
      '浅色与深色主题',
      '支持英文和简体中文',
      '九款猫头鹰 Dock 图标'
    ]
  },
  start: {
    kicker: '快速开始',
    title: '三步就能用起来。',
    body: '需要一台搭载 Apple 芯片（M1 及以上）、运行 macOS 13 Ventura 及以上的 Mac。',
    copy: '复制',
    copied: '已复制',
    steps: [
      {
        title: '安装 Owlto',
        text: '从 GitHub Releases 下载最新的 .dmg，打开后把 Owlto 拖进“应用程序”文件夹。',
        action: '前往 Releases'
      },
      {
        title: '至少安装一个编程智能体',
        text: 'Owlto 驱动的是你已经在用的智能体。安装一个或多个，并在终端里登录一次。'
      },
      {
        title: '连接并开始对话',
        text: '打开设置（⌘,）→ Agents，点击“Connect local …”。然后按 ⌘N，把需求告诉 Router。'
      }
    ],
    agents: [
      { name: 'Claude Code', command: 'curl -fsSL https://claude.ai/install.sh | bash' },
      { name: 'Codex', command: 'brew install --cask codex' },
      { name: 'Cursor', command: 'curl https://cursor.com/install -fsS | bash' }
    ],
    keysTitle: '值得记住的快捷键',
    keysHint: '在键盘上按按看。',
    keys: [
      { combo: ['⌘', 'N'], key: 'n', label: '新建对话' },
      { combo: ['⌘', 'J'], key: 'j', label: '对话 ↔ 地图' },
      { combo: ['⌘', 'K'], key: 'k', label: '笔记' },
      { combo: ['⌘', ','], key: ',', label: '设置' }
    ]
  },
  trust: {
    kicker: '隐私优先',
    title: '你的 Mac，你的智能体，你的账号。',
    items: [
      {
        title: '运行在你的 Mac 上',
        text: 'Owlto 是一款桌面应用，使用的是你自己安装并登录的智能体。'
      },
      {
        title: '从不复制你的登录信息',
        text: 'Owlto 不会复制你的密码或登录令牌，只读取账号状态，用来显示你当前登录的身份。'
      },
      {
        title: '开源',
        text: '代码以 AGPL-3.0 协议公开。你可以阅读、自行构建，或一起把它做得更好。'
      }
    ],
    caution: '只打开你信任的项目。编程智能体可能会遵循项目内保存的指令和设置。'
  },
  compare: {
    title: 'Owlto 与“来回切终端”的区别',
    head: ['', '多个独立终端', '使用 Owlto'],
    rows: [
      ['在哪里提需求', '每个智能体一个窗口', '只和 Router 在一处对话'],
      ['拆分大任务', '自己规划，来回复制提示词', 'Router 负责规划和派发'],
      ['并行修改', '多个智能体可能在同一份代码里冲突', '每个 worker 一份独立的项目副本'],
      ['批准操作', '散落在各个窗口', '统一排在输入框上方'],
      ['查看进度', '逐个终端翻看', '一张项目与猫头鹰的地图'],
      ['最终结果', '逐份阅读对话记录', '一份汇总，附带文件和 diff']
    ]
  },
  faq: {
    kicker: '常见问题',
    title: '你可能想问的。',
    items: [
      {
        q: 'Owlto 是什么？',
        a: 'Owlto 是一款免费开源的 macOS 桌面应用，面向使用 AI 编程智能体的人。你不必再在多个终端窗口之间来回切换，只需和一只 Router 猫头鹰对话：它规划任务，把每一部分交给 worker（Claude Code、Codex 或 Cursor），盯着进度，最后给你一个清楚的答复。'
      },
      {
        q: 'Owlto 支持哪些编程智能体？',
        a: 'Owlto 支持 Claude Code、Codex 和 Cursor。你需要自行安装并登录，然后在“设置 → Agents”中连接。Claude Code 和 Codex 既可以担任 Router，也可以作为 worker；Cursor 只能作为 worker，不能担任 Router。'
      },
      {
        q: 'Owlto 免费吗？',
        a: '免费。Owlto 可免费下载，并以 GNU AGPL-3.0 协议开源。各编程智能体需要单独安装，使用你自己的账号和套餐，并遵循各自的条款。'
      },
      {
        q: '运行 Owlto 需要什么？',
        a: '一台搭载 Apple 芯片（M1 及以上）、运行 macOS 13 Ventura 及以上的 Mac，并且至少安装并登录了 Claude Code、Codex、Cursor 中的一个。'
      },
      {
        q: '多个智能体同时改同一个项目，怎么避免冲突？',
        a: '每个 worker 都有一份独立的项目副本，所以多个 worker 可以同时修改代码。你可以打开任意 worker，查看它的汇报、改动的文件，以及每处改动的并排对比。'
      },
      {
        q: 'Owlto 会看到我的密码或 API 令牌吗？',
        a: '不会。Owlto 运行在你的 Mac 上，使用你自己安装并登录的智能体。它不会复制你的密码或登录令牌，只读取账号状态，用来显示你当前登录的身份。'
      },
      {
        q: 'Router 是什么？',
        a: 'Router 是和你对话的那只猫头鹰。它把你的需求变成计划，挑选合适的 worker，跟踪进度，在需要时请你批准，并汇总最终结果。'
      },
      {
        q: '我可以直接和某个 worker 对话吗？',
        a: '可以。在输入框里输入 @，即可为对话选择项目，或直接找某个 worker。你也可以点击任意 worker 查看它正在做什么。'
      },
      {
        q: 'Owlto 支持 Windows 或 Linux 吗？',
        a: '目前不支持。Owlto 是面向 Apple 芯片 Mac 的 macOS 应用。'
      },
      {
        q: '怎么安装 Owlto？',
        a: '从 GitHub Releases 页面下载最新的 .dmg，打开后把 Owlto 拖进“应用程序”文件夹。之后 Owlto 会在后台检查更新，可选择稳定版或测试版通道。'
      }
    ]
  },
  cta: {
    title: '给你的智能体配一只 Router。',
    body: '下载 Owlto，连接你已经在用的智能体，把终端窗口还给自己。',
    button: '下载 macOS 版',
    star: '在 GitHub 上点个 Star'
  },
  footer: {
    tagline: 'Mac 上的一支猫头鹰编程团队。',
    product: '产品',
    project: '项目',
    releases: '版本发布',
    issues: '反馈问题',
    contributing: '参与贡献',
    license: 'AGPL-3.0 协议',
    legal: 'Claude Code、Codex 和 Cursor 需单独安装，并遵循各自的条款。其名称归各自所有者所有。',
    madeBy: '由 Owlto 贡献者制作。'
  }
}
