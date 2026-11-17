// Docs pages: Markdown files in src/docs/<locale>/, one file per page.
// `index.md` is the docs home at /docs/; every other file becomes
// /docs/<file name>/. Each locale must ship the same set of files so every
// page has a hreflang partner.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esc, json } from './escape.mjs'
import { parseFrontmatter, plain, renderMarkdown } from './markdown.mjs'
import { footer, nav } from './page.mjs'
import { LOCALES, REPO_URL, SITE_URL } from './site.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const DOCS_DIR = path.join(here, 'docs')
const SOURCE_URL = `${REPO_URL}/blob/main/apps/owlto-website/src/docs`

const REQUIRED = ['title', 'description', 'navTitle', 'group', 'order']

// Loads and validates every page for one locale, sorted for navigation.
export function loadDocs(locale, groupOrder) {
  const dir = path.join(DOCS_DIR, locale.code)
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()
  const docs = files.map((file) => {
    const { data, body } = parseFrontmatter(readFileSync(path.join(dir, file), 'utf8'))
    for (const key of REQUIRED) {
      if (!data[key]) throw new Error(`docs/${locale.code}/${file}: missing frontmatter "${key}"`)
    }
    if (!groupOrder.includes(data.group)) {
      throw new Error(`docs/${locale.code}/${file}: unknown group "${data.group}"`)
    }
    const slug = file === 'index.md' ? '' : file.replace(/\.md$/, '')
    return {
      file,
      slug,
      route: slug ? `docs/${slug}/` : 'docs/',
      title: data.title,
      navTitle: data.navTitle,
      description: data.description,
      group: data.group,
      order: Number(data.order),
      updated: data.updated ?? null,
      related: data.related ? data.related.split(',').map((item) => item.trim()) : [],
      footer: data.footer === 'true',
      body
    }
  })
  return docs.sort(
    (a, b) =>
      groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) ||
      a.order - b.order ||
      a.slug.localeCompare(b.slug)
  )
}

// Fails the build when locales drift apart or a page links to a missing page.
export function checkDocs(docsByLocale) {
  const [first, ...rest] = LOCALES
  const slugs = docsByLocale[first.code].map((doc) => doc.slug).sort()
  for (const locale of rest) {
    const other = docsByLocale[locale.code].map((doc) => doc.slug).sort()
    if (json(other) !== json(slugs)) {
      throw new Error(
        `docs: ${locale.code} pages ${other} do not match ${first.code} pages ${slugs}`
      )
    }
  }
  for (const locale of LOCALES) {
    const known = new Set(docsByLocale[locale.code].map((doc) => doc.slug))
    for (const doc of docsByLocale[locale.code]) {
      for (const slug of doc.related) {
        if (!known.has(slug))
          throw new Error(`docs/${locale.code}/${doc.file}: unknown related page "${slug}"`)
      }
      for (const [, slug] of doc.body.matchAll(/\]\(\/docs\/([a-z0-9-]*)\/?(?:#[^)]*)?\)/g)) {
        if (!known.has(slug))
          throw new Error(`docs/${locale.code}/${doc.file}: broken link to /docs/${slug}/`)
      }
    }
  }
}

export const docUrl = (locale, doc) => `${SITE_URL}/${locale.path}${doc.route}`

// Relative path from a docs page back to its locale's home page.
const homeFrom = (doc) => (doc.slug ? '../../' : '../')

// Site-relative links in Markdown (`/docs/x/`, `/#faq`) are written without
// the locale; resolve them against the current page and locale.
function resolver(doc) {
  const home = homeFrom(doc)
  return (href) => (href.startsWith('/') ? `${home}${href.slice(1)}` : href)
}

function head({ t, locale, doc, docs, prefix }) {
  const url = docUrl(locale, doc)
  const title = doc.slug ? `${doc.title} · ${t.docs.siteTitle}` : `${doc.title} · Owlto`
  const alternates = LOCALES.map(
    (l) =>
      `<link rel="alternate" hreflang="${l.htmlLang}" href="${SITE_URL}/${l.path}${doc.route}">`
  ).join('\n')
  const crumbs = [
    { name: 'Owlto', item: `${SITE_URL}/${locale.path}` },
    { name: t.docs.label, item: `${SITE_URL}/${locale.path}docs/` }
  ]
  if (doc.slug) crumbs.push({ name: doc.navTitle, item: url })
  const graph = [
    {
      '@type': doc.slug ? 'TechArticle' : 'CollectionPage',
      '@id': `${url}#article`,
      headline: doc.title,
      name: doc.title,
      description: doc.description,
      url,
      inLanguage: locale.htmlLang,
      ...(doc.updated ? { dateModified: doc.updated } : {}),
      isPartOf: { '@id': `${SITE_URL}/#website` },
      about: { '@id': `${SITE_URL}/#software` },
      publisher: { '@id': `${SITE_URL}/#org` },
      ...(doc.slug
        ? {}
        : {
            hasPart: docs
              .filter((item) => item.slug)
              .map((item) => ({
                '@type': 'TechArticle',
                name: item.title,
                url: docUrl(locale, item)
              }))
          })
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.name,
        item: crumb.item
      }))
    }
  ]
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(doc.description)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="${url}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${SITE_URL}/${LOCALES[0].path}${doc.route}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Owlto">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(doc.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(t.meta.ogAlt)}">
<meta property="og:locale" content="${locale.ogLocale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(doc.description)}">
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

function sidebar({ t, doc, docs, home }) {
  const groups = t.docs.groupOrder
    .map((group) => {
      const items = docs.filter((item) => item.group === group)
      if (items.length === 0) return ''
      return `<p>${esc(t.docs.groups[group])}</p>
      <ul>${items
        .map(
          (item) =>
            `<li><a href="${home}${item.route}"${item === doc ? ' aria-current="page"' : ''}>${esc(item.navTitle)}</a></li>`
        )
        .join('')}</ul>`
    })
    .join('\n      ')
  return `<aside class="docs-side">
    <details class="docs-menu" open>
      <summary>${esc(t.docs.menu)}</summary>
      <nav aria-label="${esc(t.docs.label)}">
      ${groups}
      </nav>
    </details>
  </aside>`
}

function pager({ t, doc, docs, home }) {
  const index = docs.indexOf(doc)
  const prev = docs[index - 1]
  const next = docs[index + 1]
  const link = (item, label, cls) =>
    item
      ? `<a class="pager-${cls}" href="${home}${item.route}"><span>${esc(label)}</span><b>${esc(item.navTitle)}</b></a>`
      : '<span></span>'
  return `<nav class="pager" aria-label="${esc(t.docs.pager)}">${link(prev, t.docs.prev, 'prev')}${link(next, t.docs.next, 'next')}</nav>`
}

function related({ t, doc, docs, home }) {
  const items = doc.related.map((slug) => docs.find((item) => item.slug === slug))
  if (items.length === 0) return ''
  return `<section class="related" aria-labelledby="related-title">
      <h2 id="related-title">${esc(t.docs.related)}</h2>
      <ul>${items
        .map(
          (item) =>
            `<li><a href="${home}${item.route}"><b>${esc(item.navTitle)}</b><span>${esc(item.description)}</span></a></li>`
        )
        .join('')}</ul>
    </section>`
}

// The docs home lists every page under its group, with its description.
function indexCards({ t, docs, home }) {
  return t.docs.groupOrder
    .map((group) => {
      const items = docs.filter((item) => item.group === group && item.slug)
      if (items.length === 0) return ''
      return `<h2 id="${group}">${esc(t.docs.groups[group])}</h2>
    <ul class="doc-cards">${items
      .map(
        (item) =>
          `<li><a href="${home}${item.route}"><b>${esc(item.navTitle)}</b><span>${esc(item.description)}</span></a></li>`
      )
      .join('')}</ul>`
    })
    .join('\n    ')
}

export function renderDoc({ t, locale, doc, docs }) {
  const home = homeFrom(doc)
  // From the locale home back to the site root.
  const root = `${home}${locale.path ? '../' : ''}`
  const prefix = root
  const other = LOCALES.find((l) => l !== locale)
  const otherHref = `${root}${other.path}${doc.route}`
  const { html, toc } = renderMarkdown(doc.body, {
    resolveHref: resolver(doc),
    copy: { label: t.start.copy, copied: t.start.copied }
  })
  const tocHtml =
    toc.length > 1
      ? `<nav class="toc" aria-label="${esc(t.docs.onThisPage)}"><p>${esc(t.docs.onThisPage)}</p><ol>${toc.map((item) => `<li><a href="#${item.id}">${esc(item.text)}</a></li>`).join('')}</ol></nav>`
      : ''
  const crumbs = doc.slug
    ? `<nav class="crumbs" aria-label="${esc(t.docs.breadcrumb)}"><a href="${home}">Owlto</a><span aria-hidden="true">/</span><a href="${home}docs/">${esc(t.docs.label)}</a></nav>`
    : `<nav class="crumbs" aria-label="${esc(t.docs.breadcrumb)}"><a href="${home}">Owlto</a></nav>`
  const updated = doc.updated
    ? `<p class="docs-meta">${esc(t.docs.updated)} <time datetime="${doc.updated}">${doc.updated}</time></p>`
    : ''
  return `<!doctype html>
<html lang="${locale.htmlLang}">
${head({ t, locale, doc, docs, prefix })}
<body class="docs-body">
${nav({ t, locale, home, otherHref, current: 'docs', prefix })}
<main id="main" class="docs">
  ${sidebar({ t, doc, docs, home })}
  <article class="docs-article">
    ${crumbs}
    <h1>${esc(doc.title)}</h1>
    <p class="docs-lead">${esc(plain(doc.description))}</p>
    ${tocHtml}
    <div class="prose">
${html}
    ${doc.slug ? '' : indexCards({ t, docs, home })}
    </div>
    ${related({ t, doc, docs, home })}
    ${pager({ t, doc, docs, home })}
    <footer class="docs-foot">
      ${updated}
      <a href="${SOURCE_URL}/${locale.code}/${doc.file}" rel="noopener">${esc(t.docs.edit)}</a>
      <a href="${REPO_URL}/issues" rel="noopener">${esc(t.docs.feedback)}</a>
    </footer>
  </article>
</main>
${footer({ t, locale, home, otherHref, docs, prefix })}
<script src="${prefix}assets/app.js" defer></script>
</body>
</html>
`
}

// Plain-text version of every docs page for llms-full.txt.
export function docsText(locale, docs) {
  return docs
    .filter((doc) => doc.slug)
    .map(
      (doc) =>
        `## ${doc.title}\n\nURL: ${docUrl(locale, doc)}\n\n${doc.description}\n\n${doc.body.replace(/^(#{2,3}) /gm, '#$1 ').trim()}`
    )
    .join('\n\n')
}
