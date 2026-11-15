// English copy. Keep facts in sync with the repository README.
export default {
  meta: {
    title: 'Owlto: run Claude Code, Codex, and Cursor as one team on your Mac',
    description:
      'Owlto is a free, open-source Mac app that runs Claude Code, Codex, and Cursor as one team. Chat with one Router owl: it plans, dispatches, and reports back.',
    ogAlt: 'Owlto: a team of coding owls on your Mac',
    keywords:
      'Owlto, AI coding agents, multi-agent orchestration, Claude Code, Codex, Cursor, macOS app, parallel coding agents, agent router'
  },
  nav: {
    skip: 'Skip to content',
    how: 'How it works',
    features: 'Features',
    owls: 'The owls',
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
    title: ['A team of', 'coding owls', 'on your Mac.'],
    sub: 'Tell one owl what you need. It plans the work, hands each part to Claude Code, Codex, or Cursor, keeps an eye on them, and comes back with one clear answer.',
    cta: 'Download for macOS',
    ctaNote: 'Apple silicon · macOS 13 or later',
    secondary: 'See it work',
    hoots: ['Hoo!', 'On it.', 'Whooo, me?', 'Shipping…', 'LGTM'],
    owlLabels: {
      router: 'Router owl',
      claude: 'Claude Code owl',
      codex: 'Codex owl',
      cursor: 'Cursor owl',
      team: 'Another worker owl'
    },
    hint: 'Psst: they are watching your cursor. Click one.'
  },
  chaos: {
    kicker: 'The problem',
    title: 'Six terminals. Three agents. One of you.',
    body: 'Running several coding agents means babysitting several windows: who is stuck, who is waiting for a yes, who just changed the same file. Owlto folds all of it into one conversation.',
    alerts: ['Waiting for approval', 'Still running…', 'Which tab was this?', 'Needs input'],
    after: 'One chat. The Router does the juggling.',
    you: 'Add dark mode and cover it with tests.',
    router: 'On it. Three owls are working. I will report back.'
  },
  demo: {
    kicker: 'How it works',
    title: 'Ask once. The Router does the rest.',
    body: 'Pick a request and watch the Router plan it, split it across workers, pause for your approval, and sum up the result.',
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
        text: 'It splits the job and sends each part to the right worker: Claude Code, Codex, or Cursor.'
      },
      {
        title: 'Workers run side by side',
        text: 'Each worker gets its own copy of your project, so several can change code at once without conflicts.'
      },
      {
        title: 'You get one clear answer',
        text: 'Approvals wait above the message box. When the work is done, the Router sums up what changed.'
      }
    ],
    scenarios: [
      {
        chip: 'Add dark mode with tests',
        project: 'bookshelf',
        prompt: 'Add dark mode to the settings page and cover it with tests.',
        plan: 'Splitting this into three parts and sending them to the team.',
        workers: [
          {
            owl: 'claude',
            name: 'Claude Code',
            task: 'Dark mode toggle',
            log: ['Reading src/settings', 'Editing ThemeToggle.tsx', 'Running pnpm typecheck']
          },
          {
            owl: 'codex',
            name: 'Codex',
            task: 'Theme toggle tests',
            log: ['Writing toggle.test.ts', 'Running pnpm test', '12 tests passing']
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            task: 'Color tokens',
            log: ['Scanning hard-coded colors', 'Editing tokens.css', 'Running build:tokens']
          }
        ],
        approval: { who: 'Codex', command: 'pnpm add -D @testing-library/react' },
        report:
          'Done. Dark mode is on the settings page, with a toggle, tokens, and 12 passing tests.',
        stats: ['3 workers', '9 files changed', 'PR #128 opened', 'Checks passing']
      },
      {
        chip: 'Fix the flaky checkout test',
        project: 'billing',
        prompt: 'The checkout test is flaky. Find out why, fix it, and open a PR.',
        plan: 'One owl hunts the cause, one writes the fix, one guards against a repeat.',
        workers: [
          {
            owl: 'claude',
            name: 'Claude Code',
            task: 'Find the race',
            log: ['Running the test 50 times', 'Reading checkout.ts', 'Found an unawaited call']
          },
          {
            owl: 'codex',
            name: 'Codex',
            task: 'Fix and verify',
            log: ['Editing checkout.ts', 'Running pnpm test', '50 of 50 runs green']
          },
          {
            owl: 'claude',
            name: 'Claude Code',
            task: 'Regression test',
            log: ['Writing proration.test.ts', 'Running pnpm test', 'Updating CHANGELOG']
          }
        ],
        approval: { who: 'Claude Code', command: 'git push origin fix/checkout-race' },
        report: 'Fixed. The test raced an unawaited payment call. It now passes 50 runs in a row.',
        stats: ['3 workers', '3 files changed', 'PR #131 opened', 'Checks passing']
      },
      {
        chip: 'Upgrade to Node 22',
        project: 'api-server',
        prompt: 'Upgrade the project to Node 22 and update the CI image.',
        plan: 'Dependencies, types, and CI can move in parallel. Dispatching three owls.',
        workers: [
          {
            owl: 'codex',
            name: 'Codex',
            task: 'Bump Node and deps',
            log: ['Editing package.json', 'Running pnpm install', 'Running pnpm test']
          },
          {
            owl: 'claude',
            name: 'Claude Code',
            task: 'Fix stream types',
            log: ['Running pnpm typecheck', 'Editing src/stream.ts', '0 type errors']
          },
          {
            owl: 'cursor',
            name: 'Cursor',
            task: 'Update CI image',
            log: ['Reading .github/workflows', 'Editing ci.yml', 'Checking the matrix']
          }
        ],
        approval: { who: 'Codex', command: 'pnpm install' },
        report: 'Upgraded. The project builds and tests on Node 22, and CI uses the new image.',
        stats: ['3 workers', '6 files changed', 'PR #134 opened', 'Checks passing']
      }
    ]
  },
  owls: {
    kicker: 'Meet the owls',
    title: 'One Router. A flock of workers.',
    body: 'Owlto works with the coding agents you already use. Each one shows up as an owl, and you can see at a glance who is busy.',
    hover: 'Hover or tap an owl to put it to work.',
    cards: [
      {
        id: 'router',
        name: 'Router',
        role: 'The one you talk to',
        text: 'Plans the work, picks the right workers, and sums up what they did. Runs on Claude Code or Codex.'
      },
      {
        id: 'claude-code',
        name: 'Claude Code',
        role: 'Worker',
        text: 'A worker powered by the Claude Code you installed and signed in to on your Mac.'
      },
      {
        id: 'codex',
        name: 'Codex',
        role: 'Worker',
        text: 'A worker powered by Codex on your Mac, signed in with your ChatGPT account.'
      },
      {
        id: 'cursor',
        name: 'Cursor',
        role: 'Worker',
        text: 'A worker powered by the Cursor agent on your Mac. Cursor can work, but not route.'
      }
    ]
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
      { name: 'Claude Code', command: 'curl -fsSL https://claude.ai/install.sh | bash' },
      { name: 'Codex', command: 'brew install --cask codex' },
      { name: 'Cursor', command: 'curl https://cursor.com/install -fsS | bash' }
    ],
    keysTitle: 'Shortcuts worth knowing',
    keysHint: 'Try them on your keyboard.',
    keys: [
      { combo: ['⌘', 'N'], key: 'n', label: 'New conversation' },
      { combo: ['⌘', 'J'], key: 'j', label: 'Chat ↔ map' },
      { combo: ['⌘', 'K'], key: 'k', label: 'Notes' },
      { combo: ['⌘', ','], key: ',', label: 'Settings' }
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
    tagline: 'A team of coding owls on your Mac.',
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
