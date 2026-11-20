// Standalone pages such as the privacy policy and support page: Markdown files in
// src/legal/<locale>/, one per page, each served at /<file name>/. They share the
// docs typography but have no docs sidebar. The App Store listing links to these
// URLs, so keep each route stable once published.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esc, json } from './escape.mjs'
import { parseFrontmatter, plain, renderMarkdown } from './markdown.mjs'
import { footer, nav } from './page.mjs'
import { LOCALES, REPO_URL, SITE_URL } from './site.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const LEGAL_DIR = path.join(here, 'legal')
const SOURCE_URL = `${REPO_URL}/blob/main/apps/owlto-website/src/legal`

const REQUIRED = ['title', 'description', 'navTitle', 'order', 'updated']

export function loadLegal(locale) {
  const dir = path.join(LEGAL_DIR, locale.code)
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => {
      const { data, body } = parseFrontmatter(readFileSync(path.join(dir, file), 'utf8'))
      for (const key of REQUIRED) {
        if (!data[key])
          throw new Error(`legal/${locale.code}/${file}: missing frontmatter "${key}"`)
      }
      const slug = file.replace(/\.md$/, '')
      return {
        file,
        slug,
        route: `${slug}/`,
        title: data.title,
        navTitle: data.navTitle,
        description: data.description,
        order: Number(data.order),
        updated: data.updated,
        body
      }
    })
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
}

// Every locale must ship the same pages so each has a hreflang partner.
export function checkLegal(legalByLocale) {
  const [first, ...rest] = LOCALES
  const slugs = legalByLocale[first.code].map((page) => page.slug).join(',')
  for (const locale of rest) {
    const other = legalByLocale[locale.code].map((page) => page.slug).join(',')
    if (other !== slugs) {
      throw new Error(
        `legal/${locale.code} pages (${other}) differ from legal/${first.code} (${slugs})`
      )
    }
  }
}

export const legalUrl = (locale, page) => `${SITE_URL}/${locale.path}${page.route}`

function head({ t, locale, page, prefix }) {
  const url = legalUrl(locale, page)
  const title = `${page.title} · Owlto`
  const alternates = LOCALES.map(
    (l) =>
      `<link rel="alternate" hreflang="${l.htmlLang}" href="${SITE_URL}/${l.path}${page.route}">`
  ).join('\n')
  const graph = [
    {
      '@type': 'WebPage',
      '@id': `${url}#page`,
      name: page.title,
      description: page.description,
      url,
      inLanguage: locale.htmlLang,
      dateModified: page.updated,
      isPartOf: { '@id': `${SITE_URL}/#website` },
      about: { '@id': `${SITE_URL}/#software` },
      publisher: { '@id': `${SITE_URL}/#org` }
    }
  ]
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(page.description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${url}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${SITE_URL}/${LOCALES[0].path}${page.route}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Owlto">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}/assets/og.png">
<meta property="og:image:alt" content="${esc(t.meta.ogAlt)}">
<meta property="og:locale" content="${locale.ogLocale}">
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

export function renderLegal({ t, locale, page, docs }) {
  const home = '../'
  const prefix = `${home}${locale.path ? '../' : ''}`
  const other = LOCALES.find((l) => l !== locale)
  const otherHref = `${prefix}${other.path}${page.route}`
  const { html, toc } = renderMarkdown(page.body, {
    resolveHref: (href) => (href.startsWith('/') ? `${home}${href.slice(1)}` : href),
    copy: { label: t.start.copy, copied: t.start.copied }
  })
  const tocHtml =
    toc.length > 2
      ? `<nav class="toc" aria-label="${esc(t.docs.onThisPage)}"><p>${esc(t.docs.onThisPage)}</p><ol>${toc.map((item) => `<li><a href="#${item.id}">${esc(item.text)}</a></li>`).join('')}</ol></nav>`
      : ''
  return `<!doctype html>
<html lang="${locale.htmlLang}">
${head({ t, locale, page, prefix })}
<body class="docs-body">
${nav({ t, locale, home, otherHref, prefix })}
<main id="main" class="docs docs-solo">
  <article class="docs-article">
    <nav class="crumbs" aria-label="${esc(t.docs.breadcrumb)}"><a href="${home}">Owlto</a></nav>
    <h1>${esc(page.title)}</h1>
    <p class="docs-lead">${esc(plain(page.description))}</p>
    ${tocHtml}
    <div class="prose">
${html}
    </div>
    <footer class="docs-foot">
      <p class="docs-meta">${esc(t.legal.updated)} <time datetime="${page.updated}">${page.updated}</time></p>
      <a href="${SOURCE_URL}/${locale.code}/${page.file}" rel="noopener">${esc(t.legal.source)}</a>
    </footer>
  </article>
</main>
${footer({ t, locale, home, otherHref, docs, prefix })}
<script src="${prefix}assets/app.js" defer></script>
</body>
</html>
`
}
