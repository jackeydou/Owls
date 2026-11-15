// Simplified Chinese copy. Mirrors en.mjs key for key.
import en from './en.mjs'

export default {
  meta: {
    title: 'Owlto：你的 Auto 智能体团队，在 Mac 上调度 Claude Code、Codex、Cursor',
    description:
      'Owlto（读作 Auto）是一款免费开源的 macOS 应用，把 Claude Code、Codex 和 Cursor 组成一支团队。你只需和一只 Router 猫头鹰对话，它负责规划、派发并汇总结果。',
    ogAlt: 'Owlto：你的 Owlto（Auto）智能体团队',
    keywords:
      'Owlto, AI 编程智能体, 多智能体协作, 多 Agent 编排, Claude Code, Codex, Cursor, macOS 应用, 并行编程, Agent 调度'
  },
  nav: {
    skip: '跳到正文',
    how: '工作方式',
    features: '功能',
    start: '快速开始',
    faq: '常见问题',
    download: '下载',
    github: 'GitHub',
    theme: '切换白天或夜晚',
    language: '语言',
    menu: '菜单'
  },
  // The hero stays in English on every locale; only the rest is translated.
  hero: en.hero,
  chaos: {
    kicker: '问题在哪',
    title: ['四个服务，', '九个任务，', '三个智能体，', '只有一个你。'],
    body: '真正的需求从来不只在一个仓库里：API 要改，Web 要跟，移动端要同步，文档也过时了。每一块都在不同的智能体、不同的终端里，等着你去处理。Owlto 把这一切收进一段对话里。',
    alerts: [
      '等待批准',
      '被 api-server 阻塞',
      '这是哪个标签页？',
      '需要输入',
      '合并冲突',
      '用量已达上限'
    ],
    after: '一个对话框，杂事交给 Router。',
    you: '把团队邀请功能做完：API、Web、移动端和文档。',
    router: '收到：4 个项目里的 6 个任务，6 只猫头鹰已经开工，做完向你汇报。'
  },
  demo: {
    kicker: '工作方式',
    title: '说一次，Router 调度整支团队。',
    body: '选一个横跨多个服务的需求，看 Router 如何规划、分配到不同项目和智能体、停下来等你批准、把一只猫头鹰的成果交给下一只，再把结果汇总给你。',
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
        text: '它把任务按项目拆开，把每一部分交给合适的 worker：Claude Code、Codex 或 Cursor。'
      },
      {
        title: '多个 worker 并行工作',
        text: '每个 worker 都有一份独立的项目副本，可以跨服务同时改代码，互不冲突。'
      },
      {
        title: '你只收到一个清楚的答复',
        text: '需要批准的操作会停在输入框上方。任务完成后，Router 汇总都改了什么。'
      }
    ],
    scenarios: [
      {
        chip: '上线团队邀请功能',
        prompt: '把团队邀请功能完整做出来：API、Web、移动端和文档。',
        plan: '4 个项目里共 6 个任务。先定 API 契约，契约一出，Web、移动端和文档立刻跟上。',
        workers: [
          {
            owl: 'codex',
            name: 'Codex',
            project: 'api-server',
            task: '邀请 API 与迁移',
            log: ['编写 0042_invites.sql', '编辑 routes/invites.ts', '契约已发布'],
            wave: 1
          },
          {
            owl: 'claude-code',
            name: 'Claude Code',
            project: 'api-server',
            task: '权限校验',
            log: ['读取 auth/policies.ts', '编写 invites.policy.test.ts', '18 个测试通过'],
            wave: 1
          },
          {
            owl: 'claude-code',
            name: 'Claude Code',
            project: 'web-app',
            task: '邀请弹窗',
            log: ['读取 API 契约', '编辑 InviteDialog.tsx', '类型检查通过'],
            wave: 2
          },
          {
            owl: 'codex',
            name: 'Codex',
            project: 'web-app',
            task: '端到端测试',
            log: ['编写 invites.spec.ts', '运行 playwright', '6 个用例通过'],
            wave: 2
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            project: 'mobile-app',
            task: '邀请页面',
            log: ['读取 API 契约', '编辑 InviteScreen.tsx', 'iOS 构建通过'],
            wave: 2
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            project: 'docs-site',
            task: 'API 文档',
            log: ['读取 API 契约', '编写 docs/invites.md', '链接检查通过'],
            wave: 2
          }
        ],
        approval: {
          who: 'Codex',
          command: 'pnpm db:migrate'
        },
        handoff: '邀请接口的契约已就绪，现在交给 Web、移动端和文档。',
        report: '已上线。团队邀请全链路可用：API、Web 弹窗、移动端页面和文档，新增 24 个测试。',
        stats: ['6 个 worker', '4 个项目', '改动 31 个文件', '已创建 4 个 PR', '检查通过']
      },
      {
        chip: '发版后结账挂了',
        prompt: '昨晚发版后结账开始失败。找出原因，把所有受影响的地方都修好，并加上防护。',
        plan: '三只猫头鹰并行排查。原因一明确，修复就同步到所有受影响的服务。',
        workers: [
          {
            owl: 'claude-code',
            name: 'Claude Code',
            project: 'billing-api',
            task: '追踪失败的支付',
            log: ['读取错误日志', '重放一次失败请求', '发现：金额被当成字符串'],
            wave: 1
          },
          {
            owl: 'codex',
            name: 'Codex',
            project: 'web-app',
            task: '检查结账表单',
            log: ['读取 Checkout.tsx', '对比上次发版', '发现同样的类型转换'],
            wave: 1
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            project: 'infra',
            task: '对比部署配置',
            log: ['对比 staging 与 prod', '读取 deploy.yml', '配置无差异'],
            wave: 1
          },
          {
            owl: 'claude-code',
            name: 'Claude Code',
            project: 'billing-api',
            task: '校验并修复',
            log: ['编辑 payments.ts', '编写回归测试', '42 个测试通过'],
            wave: 2
          },
          {
            owl: 'codex',
            name: 'Codex',
            project: 'web-app',
            task: '修复表单',
            log: ['编辑 Checkout.tsx', '运行 pnpm test', '检查通过'],
            wave: 2
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            project: 'mobile-app',
            task: '移动端同样的问题',
            log: ['读取 CheckoutScreen.tsx', '编辑 currency.ts', '测试通过'],
            wave: 2
          }
        ],
        approval: {
          who: 'Claude Code',
          command: 'git push origin fix/currency-cast'
        },
        handoff: '原因找到了：金额被当成字符串发送。修复正在同步到 billing、Web 和移动端。',
        report:
          '三个服务都已修复。发版后金额被当成字符串发送，现在三处都做了校验，并补了回归测试。',
        stats: ['6 个 worker', '4 个项目', '改动 8 个文件', '已创建 3 个 PR', '检查通过']
      },
      {
        chip: '推广新的设计变量',
        prompt: '把新的颜色变量推广到 Web、移动端和文档，并移除旧变量。',
        plan: '设计系统先发布变量，然后三个应用同时迁移，再由一只猫头鹰清理遗留。',
        workers: [
          {
            owl: 'cursor',
            name: 'Cursor',
            project: 'design-system',
            task: '发布 tokens v2',
            log: ['编辑 tokens.json', '运行 build:tokens', '已发布 2.0.0'],
            wave: 1
          },
          {
            owl: 'claude-code',
            name: 'Claude Code',
            project: 'design-system',
            task: '编写 codemod',
            log: ['读取旧变量用法', '编写 codemod.ts', '试运行：212 处匹配'],
            wave: 1
          },
          {
            owl: 'claude-code',
            name: 'Claude Code',
            project: 'web-app',
            task: '迁移 Web',
            log: ['运行 codemod', '修复 9 处特殊情况', '视觉测试通过'],
            wave: 2
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            project: 'mobile-app',
            task: '迁移移动端',
            log: ['运行 codemod', '编辑 theme.ts', 'iOS 构建通过'],
            wave: 2
          },
          {
            owl: 'codex',
            name: 'Codex',
            project: 'docs-site',
            task: '迁移文档',
            log: ['运行 codemod', '编辑 tokens.md', '链接检查通过'],
            wave: 2
          },
          {
            owl: 'codex',
            name: 'Codex',
            project: 'web-app',
            task: '清理旧变量',
            log: ['扫描写死的颜色', '移除 14 处遗留', '旧变量已清零'],
            wave: 2
          }
        ],
        approval: {
          who: 'Cursor',
          command: 'pnpm publish --tag next'
        },
        handoff: 'tokens 2.0.0 和 codemod 已就绪，三个应用现在开始迁移。',
        report: '推广完成。Web、移动端和文档都已使用新变量，旧变量已全部移除。',
        stats: ['6 个 worker', '4 个项目', '替换 212 处', '已创建 4 个 PR', '检查通过']
      }
    ],
    queued: '排队中',
    owlsWorking: '只猫头鹰在工作'
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
      {
        name: 'Claude Code',
        command: 'curl -fsSL https://claude.ai/install.sh | bash'
      },
      {
        name: 'Codex',
        command: 'brew install --cask codex'
      },
      {
        name: 'Cursor',
        command: 'curl https://cursor.com/install -fsS | bash'
      }
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
        q: 'Owlto 怎么读？',
        a: 'Owlto 读作“Auto”。这个名字把 owl（猫头鹰）和 auto（自动）合在一起：一支猫头鹰编程团队替你调度智能体，而批准权始终在你手里。'
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
    tagline: '你的 Owlto（Auto）智能体团队：Mac 上的猫头鹰编程团队。',
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
