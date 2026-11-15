// English copy. Keep facts in sync with the repository README.
export default {
  meta: {
    title: 'Owlto: your auto agent team for Claude Code, Codex, and Cursor on Mac',
    description:
      'Owlto (say "auto") is a free, open-source Mac app that runs Claude Code, Codex, and Cursor as one team: one Router owl plans, dispatches, and reports back.',
    ogAlt: 'Owlto: your Owlto (auto) agent team',
    keywords:
      'Owlto, AI coding agents, multi-agent orchestration, Claude Code, Codex, Cursor, macOS app, parallel coding agents, agent router'
  },
  nav: {
    skip: 'Skip to content',
    how: 'How it works',
    features: 'Features',
    start: 'Get started',
    faq: 'FAQ',
    download: 'Download',
    github: 'GitHub',
    theme: 'Switch between day and night',
    language: 'Language',
    menu: 'Menu'
  },
  hero: {
    kicker: 'Free and open source · macOS',
    title: ['Your', 'agent team'],
    sub: 'A team of coding owls on your Mac. Tell one owl what you need: it plans the work, hands each part to Claude Code, Codex, or Cursor, and comes back with one clear answer.',
    cta: 'Download for macOS',
    ctaNote: 'Apple silicon · macOS 13 or later',
    secondary: 'See it work',
    hoots: ['Hoo!', 'On it.', 'Whooo, me?', 'Shipping…', 'LGTM'],
    owlLabels: {
      user: 'You, in sunglasses',
      router: 'Router owl',
      'claude-code': 'Claude Code owl',
      codex: 'Codex owl',
      cursor: 'Cursor owl'
    },
    hint: 'Psst: they are watching your cursor. Click one.',
    auto: 'Auto',
    say: 'sounds like “auto”.'
  },
  chaos: {
    kicker: 'The problem',
    title: ['Four services.', 'Nine tasks.', 'Three agents.', 'One of you.'],
    body: 'A real feature never lives in one repo. The API changes, the web app follows, mobile needs the same fix, and the docs go stale. Each piece sits in a different agent, in a different terminal, waiting on you. Owlto folds all of it into one conversation.',
    alerts: [
      'Waiting for approval',
      'Blocked on api-server',
      'Which tab was this?',
      'Needs input',
      'Merge conflict',
      'Usage limit reached'
    ],
    after: 'One chat. The Router does the juggling.',
    you: 'Ship team invites across the API, web, mobile, and docs.',
    router: 'On it: 6 tasks in 4 projects, 6 owls on the job. I will report back.'
  },
  demo: {
    kicker: 'How it works',
    title: 'Ask once. The Router runs the whole team.',
    body: 'Pick a request that touches several services. Watch the Router plan it, spread it across projects and agents, pause for your approval, pass results from one owl to the next, and sum it all up.',
    note: 'Simulated walkthrough of the Owlto conversation view.',
    try: 'Try a request',
    placeholder: 'Ask the Router to plan, dispatch, or follow up…',
    send: 'Send',
    projects: 'Projects',
    working: 'working',
    done: 'done',
    planning: 'Planning',
    approve: 'Approve',
    approved: 'Approved',
    approvalTitle: 'Needs your OK',
    replay: 'Replay',
    steps: [
      {
        title: 'You ask in plain words',
        text: 'Press ⌘N, describe what you want, and type @ to pick a project or talk to one worker directly.'
      },
      {
        title: 'The Router plans and dispatches',
        text: 'It splits the job across projects and sends each part to the right worker: Claude Code, Codex, or Cursor.'
      },
      {
        title: 'Workers run side by side',
        text: 'Each worker gets its own copy of the project, so several can change code at once, across services, without conflicts.'
      },
      {
        title: 'You get one clear answer',
        text: 'Approvals wait above the message box. When the work is done, the Router sums up what changed.'
      }
    ],
    scenarios: [
      {
        chip: 'Ship team invites',
        prompt: 'Ship team invites end to end: API, web, mobile, and docs.',
        plan: 'Six tasks across four projects. The API contract goes first; web, mobile, and docs follow as soon as it lands.',
        workers: [
          {
            owl: 'codex',
            name: 'Codex',
            project: 'api-server',
            task: 'Invites API + migration',
            log: ['Writing 0042_invites.sql', 'Editing routes/invites.ts', 'Contract published'],
            wave: 1
          },
          {
            owl: 'claude-code',
            name: 'Claude Code',
            project: 'api-server',
            task: 'Permission checks',
            log: ['Reading auth/policies.ts', 'Writing invites.policy.test.ts', '18 tests passing'],
            wave: 1
          },
          {
            owl: 'claude-code',
            name: 'Claude Code',
            project: 'web-app',
            task: 'Invite dialog',
            log: ['Reading the API contract', 'Editing InviteDialog.tsx', 'Typecheck passing'],
            wave: 2
          },
          {
            owl: 'codex',
            name: 'Codex',
            project: 'web-app',
            task: 'End-to-end tests',
            log: ['Writing invites.spec.ts', 'Running playwright', '6 specs passing'],
            wave: 2
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            project: 'mobile-app',
            task: 'Invite screen',
            log: ['Reading the API contract', 'Editing InviteScreen.tsx', 'iOS build passing'],
            wave: 2
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            project: 'docs-site',
            task: 'API reference',
            log: ['Reading the API contract', 'Writing docs/invites.md', 'Links checked'],
            wave: 2
          }
        ],
        approval: {
          who: 'Codex',
          command: 'pnpm db:migrate'
        },
        handoff: 'The invites contract is in. Handing it to web, mobile, and docs.',
        report:
          'Shipped. Team invites work end to end: API, web dialog, mobile screen, and docs, with 24 new tests.',
        stats: ['6 workers', '4 projects', '31 files changed', '4 PRs opened', 'Checks passing']
      },
      {
        chip: 'Checkout broke after deploy',
        prompt:
          'Checkout started failing after last night’s deploy. Find it, fix it everywhere, and add a guard.',
        plan: 'Three owls investigate in parallel. Once the cause is clear, the fix fans out to every service that shares it.',
        workers: [
          {
            owl: 'claude-code',
            name: 'Claude Code',
            project: 'billing-api',
            task: 'Trace failed payments',
            log: [
              'Reading error logs',
              'Replaying a failed request',
              'Found: amount sent as string'
            ],
            wave: 1
          },
          {
            owl: 'codex',
            name: 'Codex',
            project: 'web-app',
            task: 'Check the checkout form',
            log: ['Reading Checkout.tsx', 'Diffing the last deploy', 'Found the same cast'],
            wave: 1
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            project: 'infra',
            task: 'Compare deploy configs',
            log: ['Diffing staging and prod', 'Reading deploy.yml', 'No config drift'],
            wave: 1
          },
          {
            owl: 'claude-code',
            name: 'Claude Code',
            project: 'billing-api',
            task: 'Validate and fix',
            log: ['Editing payments.ts', 'Writing a regression test', '42 tests passing'],
            wave: 2
          },
          {
            owl: 'codex',
            name: 'Codex',
            project: 'web-app',
            task: 'Fix the form',
            log: ['Editing Checkout.tsx', 'Running pnpm test', 'Checks green'],
            wave: 2
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            project: 'mobile-app',
            task: 'Same bug on mobile',
            log: ['Reading CheckoutScreen.tsx', 'Editing currency.ts', 'Tests passing'],
            wave: 2
          }
        ],
        approval: {
          who: 'Claude Code',
          command: 'git push origin fix/currency-cast'
        },
        handoff:
          'Cause found: the amount is sent as a string. Sending the fix to billing, web, and mobile.',
        report:
          'Fixed in three services. The amount was sent as a string after the deploy; all three now validate it, with a regression test.',
        stats: ['6 workers', '4 projects', '8 files changed', '3 PRs opened', 'Checks passing']
      },
      {
        chip: 'Roll out new design tokens',
        prompt: 'Roll the new color tokens out to web, mobile, and docs, and remove the old ones.',
        plan: 'The design system publishes the tokens first. Then three apps migrate at the same time, and one owl sweeps for leftovers.',
        workers: [
          {
            owl: 'cursor',
            name: 'Cursor',
            project: 'design-system',
            task: 'Publish tokens v2',
            log: ['Editing tokens.json', 'Running build:tokens', 'Published 2.0.0'],
            wave: 1
          },
          {
            owl: 'claude-code',
            name: 'Claude Code',
            project: 'design-system',
            task: 'Write the codemod',
            log: ['Reading old token usage', 'Writing codemod.ts', 'Dry run: 212 matches'],
            wave: 1
          },
          {
            owl: 'claude-code',
            name: 'Claude Code',
            project: 'web-app',
            task: 'Migrate web',
            log: ['Running the codemod', 'Fixing 9 edge cases', 'Visual tests passing'],
            wave: 2
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            project: 'mobile-app',
            task: 'Migrate mobile',
            log: ['Running the codemod', 'Editing theme.ts', 'iOS build passing'],
            wave: 2
          },
          {
            owl: 'codex',
            name: 'Codex',
            project: 'docs-site',
            task: 'Migrate docs',
            log: ['Running the codemod', 'Editing tokens.md', 'Links checked'],
            wave: 2
          },
          {
            owl: 'codex',
            name: 'Codex',
            project: 'web-app',
            task: 'Sweep for old tokens',
            log: ['Scanning hard-coded colors', 'Removing 14 leftovers', '0 old tokens left'],
            wave: 2
          }
        ],
        approval: {
          who: 'Cursor',
          command: 'pnpm publish --tag next'
        },
        handoff: 'Tokens 2.0.0 and the codemod are ready. Three apps start migrating now.',
        report: 'Rolled out. Web, mobile, and docs use the new tokens, and the old ones are gone.',
        stats: ['6 workers', '4 projects', '212 replacements', '4 PRs opened', 'Checks passing']
      }
    ],
    queued: 'queued',
    owlsWorking: 'owls working'
  },
  features: {
    kicker: 'Features',
    title: 'Everything a flock needs.',
    body: 'Built for people who run more than one coding agent and would rather read one report than six terminals.',
    items: {
      parallel: {
        title: 'Many workers at once',
        text: 'Each worker gets its own copy of your project, so several can change code at the same time without stepping on each other.'
      },
      map: {
        title: 'Overview map',
        text: 'All your projects and owls on one board. See who is working, waiting, or done. Press ⌘J to switch between chat and map.'
      },
      approvals: {
        title: 'Approvals you control',
        text: 'When an owl wants to do something that needs your OK, the request waits right above the message box.',
        sample: 'Codex wants to run'
      },
      story: {
        title: "Every worker's story",
        text: 'Open a worker to read its report first, then everything it did, with changed files and a side-by-side view of each change.'
      },
      prs: {
        title: 'Pull requests in one place',
        text: 'Every pull request your owls opened, with merge, review, and check status, sorted by what needs you.',
        rows: [
          ['Dark mode toggle', 'Checks passing'],
          ['Fix checkout race', 'Review requested'],
          ['Node 22 upgrade', 'Merged']
        ]
      },
      notes: {
        title: 'Notes and whiteboards',
        text: 'Save useful answers as notes, sort them with tags, lay them out on boards, and attach them to new messages. ⌘K opens your notes.',
        tags: ['architecture', 'release', 'ideas']
      },
      openIn: {
        title: 'Open in your favorite app',
        text: 'Jump from a worker straight into the tools you already use.',
        apps: [
          'VS Code',
          'Cursor',
          'Zed',
          'Xcode',
          'JetBrains IDEs',
          'Finder',
          'Terminal',
          'Ghostty'
        ]
      },
      usage: {
        title: 'Usage at a glance',
        text: "See how much of each agent's plan you have left, with daily usage and estimated cost in Settings."
      }
    },
    more: [
      'Mention a worker with @',
      'Open a folder, clone a repo, or start empty',
      'Updates itself: stable or beta',
      'Light and dark themes',
      'English and Simplified Chinese',
      'Nine owl logos for your Dock'
    ]
  },
  start: {
    kicker: 'Get started',
    title: 'Up and running in three steps.',
    body: 'You need a Mac with Apple silicon (M1 or later) running macOS 13 Ventura or later.',
    copy: 'Copy',
    copied: 'Copied',
    steps: [
      {
        title: 'Install Owlto',
        text: 'Download the latest .dmg from GitHub Releases, open it, and drag Owlto into your Applications folder.',
        action: 'Go to Releases'
      },
      {
        title: 'Install at least one coding agent',
        text: 'Owlto drives the agents you already use. Install one or more and sign in once in Terminal.'
      },
      {
        title: 'Connect it and start a conversation',
        text: 'Open Settings (⌘,) → Agents and click “Connect local …”. Then press ⌘N and tell the Router what you need.'
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
    kicker: 'Private by design',
    title: 'Your Mac. Your agents. Your accounts.',
    items: [
      {
        title: 'Runs on your Mac',
        text: 'Owlto is a desktop app. It uses the agents you installed and signed in to yourself.'
      },
      {
        title: 'Never copies your sign-in',
        text: 'Owlto never copies your passwords or sign-in tokens. It only reads your account status to show who you are signed in as.'
      },
      {
        title: 'Open source',
        text: 'The code is public under AGPL-3.0. Read it, build it, or help make it better.'
      }
    ],
    caution:
      'Only open projects you trust. Your coding agents may follow instructions and settings stored inside a project.'
  },
  compare: {
    title: 'Owlto vs. juggling terminals',
    head: ['', 'Separate terminals', 'With Owlto'],
    rows: [
      ['Where you ask', 'One window per agent', 'One chat with the Router'],
      [
        'Splitting a big job',
        'You plan and copy prompts around',
        'The Router plans and dispatches'
      ],
      [
        'Parallel changes',
        'Agents can collide in one checkout',
        'Each worker gets its own copy of the project'
      ],
      ['Approvals', 'Scattered across windows', 'Queued above the message box'],
      ['Seeing progress', 'Tab through every terminal', 'One map of projects and owls'],
      ['The result', 'Read every transcript', 'One summary, with files and diffs']
    ]
  },
  faq: {
    kicker: 'FAQ',
    title: 'Questions, answered.',
    items: [
      {
        q: 'What is Owlto?',
        a: 'Owlto is a free, open-source macOS desktop app for people who use AI coding agents. Instead of juggling several terminal windows, you chat with one Router owl. It plans the work, sends each part to a worker (Claude Code, Codex, or Cursor), keeps an eye on them, and comes back with one clear answer.'
      },
      {
        q: 'How do you pronounce Owlto?',
        a: 'Owlto sounds like "auto". The name joins "owl" and "auto": a team of coding owls that runs your agents for you, while approvals stay in your hands.'
      },
      {
        q: 'Which coding agents does Owlto work with?',
        a: 'Owlto works with Claude Code, Codex, and Cursor. You install and sign in to them yourself, then connect them in Settings → Agents. Claude Code and Codex can run the Router or act as workers. Cursor can act as a worker, but not as the Router.'
      },
      {
        q: 'Is Owlto free?',
        a: 'Yes. Owlto is free to download and open source under the GNU AGPL-3.0 license. The coding agents are installed separately, use your own accounts and plans, and follow their own terms.'
      },
      {
        q: 'What do I need to run Owlto?',
        a: 'A Mac with Apple silicon (M1 or later) running macOS 13 Ventura or later, and at least one of Claude Code, Codex, or Cursor installed and signed in.'
      },
      {
        q: 'How do several agents work on the same project without conflicts?',
        a: 'Each worker gets its own copy of your project, so several workers can change code at the same time. You can open any worker to see its report, its changed files, and a side-by-side view of each change.'
      },
      {
        q: 'Does Owlto see my passwords or API tokens?',
        a: 'No. Owlto runs on your Mac and uses the agents you installed and signed in to yourself. It never copies your passwords or sign-in tokens. It only reads your account status to show who you are signed in as.'
      },
      {
        q: 'What is the Router?',
        a: 'The Router is the owl you talk to. It turns your request into a plan, picks the right workers, watches their progress, asks for your approval when something needs it, and sums up the result.'
      },
      {
        q: 'Can I talk to one worker directly?',
        a: 'Yes. Type @ in the message box to pick a project for a conversation or to address one worker yourself. You can also click any worker to see what it is doing.'
      },
      {
        q: 'Does Owlto run on Windows or Linux?',
        a: 'Not today. Owlto is a macOS app for Apple silicon Macs.'
      },
      {
        q: 'How do I install Owlto?',
        a: 'Download the latest .dmg from the GitHub Releases page, open it, and drag Owlto into your Applications folder. Owlto then checks for updates in the background, on the stable or beta channel.'
      }
    ]
  },
  cta: {
    title: 'Give your agents a Router.',
    body: 'Download Owlto, connect the agents you already use, and get your terminals back.',
    button: 'Download for macOS',
    star: 'Star on GitHub'
  },
  footer: {
    tagline: 'Your Owlto (auto) agent team: coding owls on your Mac.',
    product: 'Product',
    project: 'Project',
    releases: 'Releases',
    issues: 'Report an issue',
    contributing: 'Contributing',
    license: 'AGPL-3.0 license',
    legal:
      'Claude Code, Codex, and Cursor are installed separately and follow their own terms. Their names belong to their respective owners.',
    madeBy: 'Made by the Owlto contributors.'
  }
}
