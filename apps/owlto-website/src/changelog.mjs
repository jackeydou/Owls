// The changelog page at /changelog/, built from the repository's CHANGELOG.md.
// Release PRs already compose CHANGELOG.md, so the site needs no second copy:
// each `## <version>` section becomes one release, its Highlights lead, and its
// Changes and Fixes follow with the PR numbers dropped.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esc, json } from './escape.mjs'
import { footer, nav } from './page.mjs'
import { DOWNLOAD_URL, LOCALES, REPO_URL, SITE_URL } from './site.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const CHANGELOG = path.join(here, '../../../CHANGELOG.md')
const SOURCE_URL = `${REPO_URL}/blob/main/CHANGELOG.md`
export const CHANGELOG_ROUTE = 'changelog/'

const SECTIONS = { Highlights: 'highlights', Changes: 'changes', Fixes: 'fixes' }
// CalVer: YEAR.MONTH.DDNN, where DD is the day and NN the build of that day.
const VERSION = /^(\d{4})\.(\d{1,2})\.(\d+)(?:-([a-z]+)\.(\d+))?$/

// "(#182)" or "(#141, #142)" at the end of an entry: PR numbers mean nothing to readers.
const stripRefs = (text) => text.replace(/\s*\((?:#\d+(?:,\s*)?)+\)/g, '').trim()

// "Workers: Claude Code workers can..." → area "Workers", text "Claude Code workers can...".
function splitArea(text) {
  const match = /^([A-Z][A-Za-z0-9 &/.-]{1,32}):\s+(.+)$/s.exec(text)
  if (!match) return { area: null, text }
  return { area: match[1], text: match[2].charAt(0).toUpperCase() + match[2].slice(1) }
}

function releaseDate(major, minor, patch) {
  const day = Math.floor(Number(patch) / 100)
  return `${major}-${String(minor).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function loadChangelog(file = CHANGELOG) {
  const releases = []
  let release = null
  let section = null
  let item = null
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const heading = /^## (.+)$/.exec(line)
    if (heading) {
      item = null
      section = null
      const version = heading[1].trim()
      const match = VERSION.exec(version)
      release = match
        ? {
            version,
            id: `v${version.replaceAll('.', '-')}`,
            date: releaseDate(match[1], match[2], match[3]),
            channel: match[4] ?? 'stable',
            highlights: [],
            changes: [],
            fixes: []
          }
        : null
      if (release) releases.push(release)
      continue
    }
    if (!release) continue
    const sub = /^### (.+)$/.exec(line)
    if (sub) {
      section = SECTIONS[sub[1].trim()] ?? null
      item = null
      continue
    }
    if (!section) continue
    const bullet = /^- (.+)$/.exec(line)
    if (bullet) {
      item = { raw: bullet[1] }
      release[section].push(item)
    } else if (item && /^\s+\S/.test(line)) {
      item.raw += ` ${line.trim()}`
    } else if (!line.trim()) {
      item = null
    }
  }
  for (const entry of releases) {
    for (const key of Object.values(SECTIONS)) {
      entry[key] = entry[key].map(({ raw }) => {
        const text = stripRefs(raw)
        return key === 'highlights' ? { area: null, text } : splitArea(text)
      })
    }
  }
  if (releases.length === 0) throw new Error('CHANGELOG.md: no releases found')
  return releases
}

const formatDate = (locale, iso) =>
  new Intl.DateTimeFormat(locale.code === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: locale.code === 'zh' ? 'long' : 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${iso}T00:00:00Z`))

const formatMonth = (locale, iso) =>
  new Intl.DateTimeFormat(locale.code === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC'
  }).format(new Date(`${iso}T00:00:00Z`))

export const changelogUrl = (locale) => `${SITE_URL}/${locale.path}${CHANGELOG_ROUTE}`

function head({ t, locale, releases, prefix }) {
  const c = t.changelog
  const url = changelogUrl(locale)
  const title = `${c.title} · Owlto`
  const alternates = LOCALES.map(
    (l) =>
      `<link rel="alternate" hreflang="${l.htmlLang}" href="${SITE_URL}/${l.path}${CHANGELOG_ROUTE}">`
  ).join('\n')
  const graph = [
    {
      '@type': 'CollectionPage',
      '@id': `${url}#page`,
      name: c.title,
      headline: c.title,
      description: c.description,
      url,
      inLanguage: locale.htmlLang,
      dateModified: releases[0].date,
      isPartOf: { '@id': `${SITE_URL}/#website` },
      about: { '@id': `${SITE_URL}/#software` },
      publisher: { '@id': `${SITE_URL}/#org` }
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Owlto', item: `${SITE_URL}/${locale.path}` },
        { '@type': 'ListItem', position: 2, name: c.label, item: url }
      ]
    }
  ]
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(c.description)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="${url}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${SITE_URL}/${LOCALES[0].path}${CHANGELOG_ROUTE}">
<link rel="alternate" type="application/atom+xml" title="${esc(c.title)}" href="${SITE_URL}/${CHANGELOG_ROUTE}feed.xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Owlto">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(c.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(t.meta.ogAlt)}">
<meta property="og:locale" content="${locale.ogLocale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(c.description)}">
<meta name="twitter:image" content="${SITE_URL}/assets/og.png">
<meta name="theme-color" content="#FFF9EC" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1F2A44" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${prefix}assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${prefix}assets/logo.png">
<link rel="manifest" href="${prefix}site.webmanifest">
<script>(function(){try{var s=localStorage.getItem('owlto-theme');var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}document.documentElement.classList.add('js')})()</script>
<link rel="stylesheet" href="${prefix}assets/styles.css">
<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': graph })}</script>
</head>`
}

// Sidebar: releases grouped by month, newest first.
function sidebar({ t, locale, releases }) {
  const months = []
  for (const release of releases) {
    const key = release.date.slice(0, 7)
    if (months.at(-1)?.key !== key) months.push({ key, items: [] })
    months.at(-1).items.push(release)
  }
  const groups = months
    .map(
      (month) => `<p>${esc(formatMonth(locale, `${month.key}-01`))}</p>
      <ul>${month.items
        .map((release) => `<li><a href="#${release.id}" lang="en">${esc(release.version)}</a></li>`)
        .join('')}</ul>`
    )
    .join('\n      ')
  return `<aside class="docs-side">
    <details class="docs-menu" open>
      <summary>${esc(t.changelog.menu)}</summary>
      <nav aria-label="${esc(t.changelog.versions)}">
      ${groups}
      </nav>
    </details>
  </aside>`
}

const entry = ({ area, text }) =>
  `<li>${area ? `<span class="log-area">${esc(area)}</span> ` : ''}${esc(text)}</li>`

function releaseCard({ t, locale, release, latest }) {
  const c = t.changelog
  const list = (key, label) =>
    release[key].length
      ? `<h3>${esc(label)}</h3>
        <ul class="log-list">${release[key].map(entry).join('')}</ul>`
      : ''
  const details = release.changes.length + release.fixes.length
  const badges = [
    latest ? `<span class="log-badge log-badge-latest">${esc(c.latest)}</span>` : '',
    release.channel === 'beta' ? `<span class="log-badge">${esc(c.beta)}</span>` : ''
  ].join('')
  return `<article class="log-release" id="${release.id}" aria-labelledby="${release.id}-title">
      <header class="log-head">
        <h2 id="${release.id}-title"><a href="#${release.id}" lang="en">${esc(release.version)}</a></h2>
        ${badges}
        <time datetime="${release.date}">${esc(formatDate(locale, release.date))}</time>
      </header>
      <div lang="en">
      ${release.highlights.length ? `<ul class="log-highlights">${release.highlights.map(entry).join('')}</ul>` : ''}
      ${
        details
          ? `<details class="log-details"${latest ? ' open' : ''}>
        <summary lang="${locale.htmlLang}">${esc(c.details)} <span>${details}</span></summary>
        ${list('changes', c.changes)}
        ${list('fixes', c.fixes)}
      </details>`
          : ''
      }
      </div>
    </article>`
}

export function renderChangelog({ t, locale, releases, docs }) {
  const c = t.changelog
  const home = '../'
  const prefix = `${home}${locale.path ? '../' : ''}`
  const other = LOCALES.find((l) => l !== locale)
  const otherHref = `${prefix}${other.path}${CHANGELOG_ROUTE}`
  const note = c.languageNote ? `<p class="callout callout-note">${esc(c.languageNote)}</p>` : ''
  return `<!doctype html>
<html lang="${locale.htmlLang}">
${head({ t, locale, releases, prefix })}
<body class="docs-body">
${nav({ t, locale, home, otherHref, current: 'changelog', prefix })}
<main id="main" class="docs">
  ${sidebar({ t, locale, releases })}
  <div class="docs-article log">
    <nav class="crumbs" aria-label="${esc(t.docs.breadcrumb)}"><a href="${home}">Owlto</a></nav>
    <h1>${esc(c.title)}</h1>
    <p class="docs-lead">${esc(c.lead)}</p>
    <p class="log-links">
      <a class="btn btn-sm" href="${DOWNLOAD_URL}" rel="noopener">${esc(c.download)}</a>
      <a class="btn btn-sm btn-ghost" href="${prefix}${CHANGELOG_ROUTE}feed.xml">${esc(c.feed)}</a>
    </p>
    ${note}
    ${releases.map((release, index) => releaseCard({ t, locale, release, latest: index === 0 })).join('\n    ')}
    <footer class="docs-foot">
      <p class="docs-meta">${esc(c.updated)} <time datetime="${releases[0].date}">${releases[0].date}</time></p>
      <a href="${SOURCE_URL}" rel="noopener">${esc(c.source)}</a>
    </footer>
  </div>
</main>
${footer({ t, locale, home, otherHref, docs, prefix })}
<script src="${prefix}assets/app.js" defer></script>
</body>
</html>
`
}

const xml = (value) => esc(value).replaceAll("'", '&apos;')

// Atom feed of the latest releases (English), for feed readers and crawlers.
export function changelogFeed(t, releases) {
  const url = changelogUrl(LOCALES[0])
  const entries = releases
    .slice(0, 30)
    .map((release) => {
      const items = (list) =>
        list
          .map((item) => `<li>${esc(item.area ? `${item.area}: ${item.text}` : item.text)}</li>`)
          .join('')
      const parts = [
        release.highlights.length ? `<ul>${items(release.highlights)}</ul>` : '',
        release.changes.length
          ? `<h3>${esc(t.changelog.changes)}</h3><ul>${items(release.changes)}</ul>`
          : '',
        release.fixes.length
          ? `<h3>${esc(t.changelog.fixes)}</h3><ul>${items(release.fixes)}</ul>`
          : ''
      ].join('')
      return `  <entry>
    <title>Owlto ${xml(release.version)}</title>
    <id>${url}#${release.id}</id>
    <link href="${url}#${release.id}"/>
    <updated>${release.date}T00:00:00Z</updated>
    <content type="html">${xml(parts)}</content>
  </entry>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xml(t.changelog.title)}</title>
  <subtitle>${xml(t.changelog.description)}</subtitle>
  <id>${url}</id>
  <link href="${url}"/>
  <link rel="self" href="${SITE_URL}/${CHANGELOG_ROUTE}feed.xml"/>
  <updated>${releases[0].date}T00:00:00Z</updated>
  <author><name>Owlto contributors</name></author>
${entries}
</feed>
`
}
