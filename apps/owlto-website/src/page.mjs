import { owlSvg } from './owl.mjs'
import {
  CONTRIBUTING_URL,
  DOWNLOAD_URL,
  ISSUES_URL,
  LICENSE_URL,
  LOCALES,
  localeUrl,
  REPO_URL,
  SITE_URL
} from './site.mjs'

export const esc = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

// JSON embedded in <script> must not be able to close the tag.
const json = (value) => JSON.stringify(value).replaceAll('<', '\\u003c')

const ICONS = {
  apple:
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.9-.8-3-.8-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2-1.1 2.8-2.3.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8zM14.1 5.8c.6-.8 1.1-1.9.9-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.2-.5 2.8-1.3z"/></svg>',
  github:
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.8V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M6 11l6-6 6 6"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  sun: '<svg class="icon-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3L7 7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7"/></svg>',
  moon: '<svg class="icon-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>'
}

function head({ t, locale, version }) {
  const url = localeUrl(locale)
  const p = locale.prefix
  const alternates = LOCALES.map(
    (l) => `<link rel="alternate" hreflang="${l.htmlLang}" href="${localeUrl(l)}">`
  ).join('\n')
  const ogAlternates = LOCALES.filter((l) => l !== locale)
    .map((l) => `<meta property="og:locale:alternate" content="${l.ogLocale}">`)
    .join('\n')

  const software = {
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name: 'Owlto',
    description: t.meta.description,
    url,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'AI coding agent orchestrator',
    operatingSystem: 'macOS 13 or later (Apple silicon)',
    softwareVersion: version,
    downloadUrl: DOWNLOAD_URL,
    installUrl: DOWNLOAD_URL,
    releaseNotes: DOWNLOAD_URL,
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    isAccessibleForFree: true,
    inLanguage: ['en', 'zh-Hans'],
    image: `${SITE_URL}/assets/og.png`,
    screenshot: `${SITE_URL}/assets/og.png`,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: Object.values(t.features.items).map((item) => item.title),
    sameAs: [REPO_URL],
    publisher: { '@id': `${SITE_URL}/#org` }
  }
  const graph = [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#org`,
      name: 'Owlto',
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/assets/logo.png`,
      sameAs: [REPO_URL]
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: 'Owlto',
      url: `${SITE_URL}/`,
      inLanguage: locale.htmlLang,
      publisher: { '@id': `${SITE_URL}/#org` }
    },
    software,
    {
      '@type': 'SoftwareSourceCode',
      name: 'Owlto',
      codeRepository: REPO_URL,
      license: 'https://www.gnu.org/licenses/agpl-3.0.html',
      programmingLanguage: 'TypeScript',
      targetProduct: { '@id': `${SITE_URL}/#software` }
    },
    {
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      inLanguage: locale.htmlLang,
      mainEntity: t.faq.items.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a }
      }))
    },
    {
      '@type': 'HowTo',
      name: t.start.title,
      inLanguage: locale.htmlLang,
      step: t.start.steps.map((step, index) => ({
        '@type': 'HowToStep',
        position: index + 1,
        name: step.title,
        text: step.text
      }))
    }
  ]

  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.meta.title)}</title>
<meta name="description" content="${esc(t.meta.description)}">
<meta name="keywords" content="${esc(t.meta.keywords)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="${url}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${localeUrl(LOCALES[0])}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Owlto">
<meta property="og:title" content="${esc(t.meta.title)}">
<meta property="og:description" content="${esc(t.meta.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(t.meta.ogAlt)}">
<meta property="og:locale" content="${locale.ogLocale}">
${ogAlternates}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(t.meta.title)}">
<meta name="twitter:description" content="${esc(t.meta.description)}">
<meta name="twitter:image" content="${SITE_URL}/assets/og.png">
<meta name="theme-color" content="#FFF9EC" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1F2A44" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${p}assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${p}assets/logo.png">
<link rel="manifest" href="${p}site.webmanifest">
<link rel="alternate" type="text/plain" href="${p}llms.txt" title="llms.txt">
<script>(function(){try{var s=localStorage.getItem('owlto-theme');var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}document.documentElement.classList.add('js')})()</script>
<link rel="stylesheet" href="${p}assets/styles.css">
<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': graph })}</script>
</head>`
}

function nav({ t, locale }) {
  const p = locale.prefix
  const other = LOCALES.find((l) => l !== locale)
  const otherHref = `${p}${other.path}` || './'
  const links = [
    ['#how', t.nav.how],
    ['#features', t.nav.features],
    ['#start', t.nav.start],
    ['#faq', t.nav.faq]
  ]
  return `<a class="skip" href="#main">${esc(t.nav.skip)}</a>
<div class="progress" aria-hidden="true"><i></i></div>
<header class="nav" data-nav>
  <a class="brand" href="#top" aria-label="Owlto">
    <img src="${p}assets/logos/trio-white.svg" width="36" height="36" alt="">
    <span>Owlto</span>
  </a>
  <nav class="nav-links" aria-label="${esc(t.nav.menu)}">
    ${links.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('\n    ')}
  </nav>
  <div class="nav-actions">
    <a class="nav-lang" href="${otherHref}" hreflang="${other.htmlLang}" lang="${other.htmlLang}" aria-label="${esc(t.nav.language)}: ${esc(other.label)}">${other.code === 'zh' ? '中文' : 'EN'}</a>
    <button class="nav-icon" type="button" data-theme-toggle aria-label="${esc(t.nav.theme)}">${ICONS.sun}${ICONS.moon}</button>
    <a class="nav-icon nav-gh" href="${REPO_URL}" rel="noopener" aria-label="${esc(t.nav.github)}">${ICONS.github}</a>
    <a class="btn btn-sm" href="${DOWNLOAD_URL}" rel="noopener">${esc(t.nav.download)}</a>
  </div>
</header>`
}

function hero({ t }) {
  const flock = [
    ['user', 0.78, 300],
    ['claude-code', 0.86, 315],
    ['router', 1, 335],
    ['codex', 0.86, 315],
    ['cursor', 0.78, 300]
  ]
  const [lineA, lineB] = t.hero.title
  return `<section class="hero" id="top">
  <div class="sky" aria-hidden="true"><i class="moon"></i><i class="stars"></i><i class="stars stars-b"></i></div>
  <div class="hero-copy">
    <p class="kicker rise" style="--i:0">${esc(t.hero.kicker)}</p>
    <h1 class="hero-title">
      <span class="rise" style="--i:1">${esc(lineA)} <mark class="flip"><span class="flip-a">Owlto</span> <span class="flip-b">${esc(t.hero.auto)}</span></mark></span>
      <span class="rise" style="--i:2">${esc(lineB)}</span>
    </h1>
    <p class="say rise" style="--i:3"><b>Owlto</b> <span>/ˈɔːtoʊ/</span> ${esc(t.hero.say)}</p>
    <p class="hero-sub rise" style="--i:4">${esc(t.hero.sub)}</p>
    <div class="hero-cta rise" style="--i:5">
      <a class="btn btn-lg" href="${DOWNLOAD_URL}" rel="noopener">${ICONS.apple}<span>${esc(t.hero.cta)}</span></a>
      <a class="btn btn-lg btn-ghost" href="#how"><span>${esc(t.hero.secondary)}</span>${ICONS.arrow}</a>
    </div>
    <p class="hero-note rise" style="--i:6">${esc(t.hero.ctaNote)}</p>
  </div>
  <div class="flock" data-hoots="${esc(json(t.hero.hoots))}">
    ${flock
      .map(
        ([id, scale, height], index) =>
          `<button class="owl" type="button" style="--s:${scale};--i:${index}" aria-label="${esc(t.hero.owlLabels[id])}" data-owl>${owlSvg(id, height)}</button>`
      )
      .join('\n    ')}
  </div>
  <p class="flock-hint" aria-hidden="true">${esc(t.hero.hint)}</p>
</section>`
}

// Nine terminals across services: the "before" picture. Decorative.
const TERMINALS = [
  [
    'claude · api-server',
    ['$ claude', '● Writing 0042_invites.sql', '● pnpm db:migrate', '  allow? (y/n)']
  ],
  [
    'codex · web-app',
    ['$ codex', '› Editing InviteDialog.tsx', '› waiting for POST /invites', '  no contract yet']
  ],
  [
    'cursor-agent · mobile-app',
    ['$ cursor-agent', '~ Editing InviteScreen.tsx', '~ Running the iOS build', '  ...']
  ],
  [
    'claude · docs-site',
    ['$ claude', '● Writing docs/invites.md', '● Which fields are required?', '  >']
  ],
  [
    'codex · billing-api',
    ['$ codex', '› Editing payments.ts', '› CONFLICT currency.ts', '  both modified']
  ],
  [
    'cursor-agent · design-system',
    ['$ cursor-agent', '~ Running build:tokens', '~ 212 usages to migrate', '  usage limit reached']
  ],
  [
    'claude · infra',
    ['$ claude', '● Diffing staging and prod', '● Reading deploy.yml', '  no drift']
  ],
  [
    'codex · web-app (2)',
    ['$ codex', '› Running playwright', '› 2 failed, 4 passed', '  retrying ...']
  ],
  [
    'zsh · ~/code',
    ['$ git worktree list', '  api-server   invites', '  web-app      invites-ui', '$ _']
  ]
]

function chaos({ t, locale }) {
  const p = locale.prefix
  return `<section class="chaos" id="problem" data-chaos>
  <div class="chaos-sticky">
    <div class="chaos-copy">
      <p class="kicker">${esc(t.chaos.kicker)}</p>
      <h2>${t.chaos.title.map((line) => `<span>${esc(line)}</span>`).join(' ')}</h2>
      <p>${esc(t.chaos.body)}</p>
    </div>
    <div class="chaos-stage" aria-hidden="true">
      ${TERMINALS.map(
        ([title, lines], index) => `<div class="term term-${index}">
        <div class="term-bar"><i></i><i></i><i></i><span>${esc(title)}</span></div>
        <pre>${lines.map(esc).join('\n')}</pre>
        ${index < t.chaos.alerts.length ? `<b class="term-alert">${esc(t.chaos.alerts[index])}</b>` : ''}
      </div>`
      ).join('\n      ')}
      <div class="unified">
        <p class="unified-you">${esc(t.chaos.you)}</p>
        <p class="unified-router"><img src="${p}assets/owls/working/router.svg" width="44" height="44" alt="" loading="lazy"><span>${esc(t.chaos.router)}</span></p>
        <strong>${esc(t.chaos.after)}</strong>
      </div>
    </div>
  </div>
</section>`
}

// Projects of a scenario in first-appearance order, each with a stable color slot.
const projectsOf = (scenario) => [...new Set(scenario.workers.map((worker) => worker.project))]

function scene({ t, scenario, index, p }) {
  const projects = projectsOf(scenario)
  const workers = scenario.workers
    .map(
      (
        worker
      ) => `<article class="wk" data-wave="${worker.wave}" data-project="${esc(worker.project)}" data-log="${esc(json(worker.log))}">
            <img src="${p}assets/owls/working/${worker.owl}.svg" width="36" height="36" alt="" loading="lazy">
            <div class="wk-body"><b>${esc(worker.task)}</b><span><i class="dot dot-${projects.indexOf(worker.project)}"></i>${esc(worker.project)} · ${esc(worker.name)}</span><code>${esc(worker.log.at(-1))}</code></div>
            <span class="wk-state" data-queued="${esc(t.demo.queued)}" data-working="${esc(t.demo.working)}" data-done="${esc(t.demo.done)}">${esc(t.demo.done)}</span>
          </article>`
    )
    .join('\n          ')
  const routerSays = (step, text, extra = '') => `<div class="msg msg-router" data-step="${step}">
          <img src="${p}assets/owls/router.svg" width="36" height="36" alt="" loading="lazy">
          <div><b>Router</b><p>${esc(text)}</p>${extra}</div>
        </div>`
  return `<div class="scene" data-scene="${index}"${index === 0 ? '' : ' hidden'}>
        <div class="msg msg-user" data-step="user"><p>${esc(scenario.prompt)}</p></div>
        ${routerSays('plan', scenario.plan)}
        <div class="workers" data-step="workers">
          ${workers}
        </div>
        <div class="approval is-approved" data-step="approval">
          <b>${esc(t.demo.approvalTitle)}</b>
          <p>${esc(scenario.approval.who)} → <code>${esc(scenario.approval.command)}</code></p>
          <button class="btn btn-sm" type="button" data-approve data-label="${esc(t.demo.approve)}" data-done="${esc(t.demo.approved)}">${ICONS.check}<span>${esc(t.demo.approved)}</span></button>
        </div>
        ${routerSays('handoff', scenario.handoff)}
        ${routerSays(
          'report',
          scenario.report,
          `<ul class="stats">${scenario.stats.map((stat) => `<li>${esc(stat)}</li>`).join('')}</ul>`
        )}
      </div>`
}

function sidebar({ t, scenario, index }) {
  return `<ul class="side-list" data-side="${index}"${index === 0 ? '' : ' hidden'}>
          ${projectsOf(scenario)
            .map(
              (project, slot) =>
                `<li data-project="${esc(project)}"><i class="dot dot-${slot}"></i><span>${esc(project)}</span><em data-idle="–" data-working="${esc(t.demo.working)}" data-done="${esc(t.demo.done)}">${esc(t.demo.done)}</em></li>`
            )
            .join('\n          ')}
        </ul>`
}

function demo({ t, locale }) {
  const p = locale.prefix
  const scenarios = t.demo.scenarios
  return `<section class="section demo-section" id="how">
  <div class="section-head reveal">
    <p class="kicker">${esc(t.demo.kicker)}</p>
    <h2>${esc(t.demo.title)}</h2>
    <p>${esc(t.demo.body)}</p>
  </div>
  <div class="demo reveal" data-demo>
    <div class="demo-chips" role="group" aria-label="${esc(t.demo.try)}">
      <span>${esc(t.demo.try)}</span>
      ${scenarios
        .map(
          (scenario, index) =>
            `<button class="chip${index === 0 ? ' is-active' : ''}" type="button" data-play="${index}" data-prompt="${esc(scenario.prompt)}" aria-pressed="${index === 0}">${esc(scenario.chip)}</button>`
        )
        .join('\n      ')}
    </div>
    <div class="app">
      <div class="app-bar"><i></i><i></i><i></i><span class="app-title">Owlto</span><span class="app-count"><b data-demo-count>0</b> ${esc(t.demo.owlsWorking)}</span></div>
      <div class="app-body">
        <aside class="app-side" aria-label="${esc(t.demo.projects)}">
          <p>${esc(t.demo.projects)}</p>
          ${scenarios.map((scenario, index) => sidebar({ t, scenario, index })).join('\n          ')}
        </aside>
        <div class="app-main">
          <div class="app-chat" data-demo-log>
      ${scenarios.map((scenario, index) => scene({ t, scenario, index, p })).join('\n      ')}
          </div>
          <div class="app-composer">
            <span class="app-input" data-demo-input data-placeholder="${esc(t.demo.placeholder)}">${esc(t.demo.placeholder)}</span>
            <button class="app-send" type="button" data-replay aria-label="${esc(t.demo.replay)}">${ICONS.up}</button>
          </div>
        </div>
      </div>
    </div>
    <p class="demo-note">${esc(t.demo.note)}</p>
  </div>
  <ol class="steps">
    ${t.demo.steps
      .map(
        (step, index) =>
          `<li class="reveal" style="--i:${index}"><span class="step-n">${index + 1}</span><h3>${esc(step.title)}</h3><p>${esc(step.text)}</p></li>`
      )
      .join('\n    ')}
  </ol>
</section>`
}

// Mini overview map: one hub, six project nodes. Decorative.
function mapArt() {
  const nodes = [
    [40, 34, '#7C8CFF'],
    [36, 100, '#E8785A'],
    [48, 166, '#5FB3A1'],
    [272, 30, '#FFB000'],
    [284, 98, '#7C8CFF'],
    [270, 168, '#E8785A']
  ]
  const links = nodes
    .map(([x, y, color], index) => {
      const fromX = x < 160 ? 138 : 182
      const midX = (fromX + x) / 2
      return `<path class="map-link" style="--i:${index}" pathLength="1" d="M${fromX} 100 C${midX} 100 ${midX} ${y} ${x < 160 ? x + 44 : x - 44} ${y}" stroke="${color}"/>`
    })
    .join('')
  const cards = nodes
    .map(
      ([x, y, color], index) =>
        `<g class="map-node" style="--i:${index}"><rect x="${x - 44}" y="${y - 15}" width="88" height="30" rx="8"/><circle cx="${x - 30}" cy="${y}" r="5" fill="${color}"/><path d="M${x - 18} ${y - 4}h42M${x - 18} ${y + 5}h26"/></g>`
    )
    .join('')
  return `<svg class="map-art" viewBox="-12 6 344 188" aria-hidden="true">${links}${cards}
<g class="map-hub"><circle cx="160" cy="100" r="24"/><circle cx="151" cy="97" r="7.5" fill="#fff"/><circle cx="169" cy="97" r="7.5" fill="#fff"/><circle cx="152" cy="98" r="2.8" fill="#151515" stroke="none"/><circle cx="168" cy="98" r="2.8" fill="#151515" stroke="none"/><path d="M157 104 q3 -2 6 0 q-1 5 -3 6 q-2 -1 -3 -6z" fill="#FFB000" stroke-width="1.5"/></g></svg>`
}

function features({ t, locale }) {
  const p = locale.prefix
  const f = t.features.items
  const card = (id, item, art) => `<li class="bento bento-${id} reveal" data-tilt>
      <div class="bento-art" aria-hidden="true">${art}</div>
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.text)}</p>
    </li>`
  const lanes = ['claude-code', 'codex', 'cursor']
    .map(
      (id, index) =>
        `<div class="lane" style="--i:${index}"><img src="${p}assets/owls/working/${id}.svg" width="34" height="34" alt="" loading="lazy"><i><b></b></i></div>`
    )
    .join('')
  const apps = f.openIn.apps.map((app) => `<span>${esc(app)}</span>`).join('')
  return `<section class="section features-section" id="features">
  <div class="section-head reveal">
    <p class="kicker">${esc(t.features.kicker)}</p>
    <h2>${esc(t.features.title)}</h2>
    <p>${esc(t.features.body)}</p>
  </div>
  <ul class="bento-grid">
    ${card('parallel', f.parallel, `<div class="lanes">${lanes}</div>`)}
    ${card('map', f.map, mapArt())}
    ${card(
      'approvals',
      f.approvals,
      `<div class="mini-approval"><span>${esc(f.approvals.sample)}</span><code>pnpm test</code><b>${ICONS.check}</b></div>`
    )}
    ${card(
      'story',
      f.story,
      `<div class="diff"><code class="del">- color: #fff;</code><code class="add">+ color: var(--surface);</code><code class="add">+ color-scheme: light dark;</code></div>`
    )}
    ${card(
      'prs',
      f.prs,
      `<div class="prs">${f.prs.rows.map(([name, state], index) => `<div class="pr pr-${index}"><i></i><b>${esc(name)}</b><span>${esc(state)}</span></div>`).join('')}</div>`
    )}
    ${card(
      'notes',
      f.notes,
      `<div class="notes">${f.notes.tags.map((tag, index) => `<span class="note note-${index}">#${esc(tag)}</span>`).join('')}</div>`
    )}
    ${card('open', f.openIn, `<div class="marquee"><div>${apps}${apps}</div></div>`)}
    ${card(
      'usage',
      f.usage,
      `<div class="usage">${[72, 46, 88].map((value, index) => `<i style="--v:${value}%;--i:${index}"><b></b></i>`).join('')}</div>`
    )}
  </ul>
  <ul class="more reveal">
    ${t.features.more.map((item) => `<li>${ICONS.check}<span>${esc(item)}</span></li>`).join('\n    ')}
  </ul>
</section>`
}

function start({ t }) {
  const [install, agents, connect] = t.start.steps
  const commands = t.start.agents
    .map(
      (agent) => `<div class="cmd">
          <span class="cmd-name">${esc(agent.name)}</span>
          <code>${esc(agent.command)}</code>
          <button class="cmd-copy" type="button" data-copy="${esc(agent.command)}" data-copied="${esc(t.start.copied)}"><span>${esc(t.start.copy)}</span></button>
        </div>`
    )
    .join('\n        ')
  return `<section class="section start-section" id="start">
  <div class="section-head reveal">
    <p class="kicker">${esc(t.start.kicker)}</p>
    <h2>${esc(t.start.title)}</h2>
    <p>${esc(t.start.body)}</p>
  </div>
  <ol class="start-steps">
    <li class="reveal"><span class="step-n">1</span><div><h3>${esc(install.title)}</h3><p>${esc(install.text)}</p>
      <a class="btn btn-sm" href="${DOWNLOAD_URL}" rel="noopener">${ICONS.apple}<span>${esc(install.action)}</span></a></div></li>
    <li class="reveal"><span class="step-n">2</span><div><h3>${esc(agents.title)}</h3><p>${esc(agents.text)}</p>
      <div class="cmds">
        ${commands}
      </div></div></li>
    <li class="reveal"><span class="step-n">3</span><div><h3>${esc(connect.title)}</h3><p>${esc(connect.text)}</p></div></li>
  </ol>
</section>`
}

function trust({ t }) {
  return `<section class="section trust-section" id="privacy">
  <div class="section-head reveal">
    <p class="kicker">${esc(t.trust.kicker)}</p>
    <h2>${esc(t.trust.title)}</h2>
  </div>
  <ul class="trust-grid">
    ${t.trust.items
      .map(
        (item, index) =>
          `<li class="reveal" style="--i:${index}"><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></li>`
      )
      .join('\n    ')}
  </ul>
  <p class="caution reveal">${esc(t.trust.caution)}</p>
  <div class="compare reveal" id="compare">
    <h3>${esc(t.compare.title)}</h3>
    <div class="table-wrap">
      <table>
        <thead><tr>${t.compare.head.map((cell) => `<th scope="col">${esc(cell)}</th>`).join('')}</tr></thead>
        <tbody>
          ${t.compare.rows
            .map(
              ([label, before, after]) =>
                `<tr><th scope="row">${esc(label)}</th><td>${esc(before)}</td><td>${esc(after)}</td></tr>`
            )
            .join('\n          ')}
        </tbody>
      </table>
    </div>
  </div>
</section>`
}

function faq({ t }) {
  return `<section class="section faq-section" id="faq">
  <div class="section-head reveal">
    <p class="kicker">${esc(t.faq.kicker)}</p>
    <h2>${esc(t.faq.title)}</h2>
  </div>
  <div class="faq-list">
    ${t.faq.items
      .map(
        (item, index) =>
          `<details class="reveal"${index === 0 ? ' open' : ''}><summary><h3>${esc(item.q)}</h3><i aria-hidden="true"></i></summary><p>${esc(item.a)}</p></details>`
      )
      .join('\n    ')}
  </div>
</section>`
}

function closing({ t, locale }) {
  const p = locale.prefix
  return `<section class="cta-section">
  <div class="cta reveal">
    <div class="cta-logos" aria-hidden="true">
      <img src="${p}assets/logos/duo-cream.svg" width="96" height="96" alt="" loading="lazy">
      <img src="${p}assets/logos/trio-night.svg" width="120" height="120" alt="" loading="lazy">
      <img src="${p}assets/logos/lean-white.svg" width="96" height="96" alt="" loading="lazy">
    </div>
    <h2>${esc(t.cta.title)}</h2>
    <p>${esc(t.cta.body)}</p>
    <div class="hero-cta">
      <a class="btn btn-lg" href="${DOWNLOAD_URL}" rel="noopener">${ICONS.apple}<span>${esc(t.cta.button)}</span></a>
      <a class="btn btn-lg btn-ghost" href="${REPO_URL}" rel="noopener">${ICONS.github}<span>${esc(t.cta.star)}</span></a>
    </div>
    <p class="hero-note">${esc(t.hero.ctaNote)}</p>
  </div>
</section>`
}

function footer({ t, locale }) {
  const p = locale.prefix
  const other = LOCALES.find((l) => l !== locale)
  return `<footer class="footer">
  <div class="footer-brand">
    <a class="brand" href="#top"><img src="${p}assets/logos/trio-white.svg" width="36" height="36" alt=""><span>Owlto</span></a>
    <p>${esc(t.footer.tagline)}</p>
  </div>
  <nav aria-label="${esc(t.footer.product)}">
    <h2>${esc(t.footer.product)}</h2>
    <a href="#how">${esc(t.nav.how)}</a>
    <a href="#features">${esc(t.nav.features)}</a>
    <a href="#start">${esc(t.nav.start)}</a>
    <a href="#faq">${esc(t.nav.faq)}</a>
  </nav>
  <nav aria-label="${esc(t.footer.project)}">
    <h2>${esc(t.footer.project)}</h2>
    <a href="${REPO_URL}" rel="noopener">GitHub</a>
    <a href="${DOWNLOAD_URL}" rel="noopener">${esc(t.footer.releases)}</a>
    <a href="${ISSUES_URL}" rel="noopener">${esc(t.footer.issues)}</a>
    <a href="${CONTRIBUTING_URL}" rel="noopener">${esc(t.footer.contributing)}</a>
    <a href="${LICENSE_URL}" rel="noopener">${esc(t.footer.license)}</a>
    <a href="${p}${other.path}" hreflang="${other.htmlLang}" lang="${other.htmlLang}">${esc(other.label)}</a>
  </nav>
  <p class="footer-legal">${esc(t.footer.legal)} ${esc(t.footer.madeBy)}</p>
</footer>`
}

export function renderPage(context) {
  const { locale } = context
  return `<!doctype html>
<html lang="${locale.htmlLang}">
${head(context)}
<body>
${nav(context)}
<main id="main">
${hero(context)}
${chaos(context)}
${demo(context)}
${features(context)}
${start(context)}
${trust(context)}
${faq(context)}
${closing(context)}
</main>
${footer(context)}
<script src="${locale.prefix}assets/app.js" defer></script>
</body>
</html>
`
}
