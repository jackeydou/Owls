// Builds the Owlto website into dist/. Zero dependencies.
//   node build.mjs                 build once
//   node build.mjs --serve         build and serve dist/, rebuilding on each page request
//   node build.mjs --serve --port 4400
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHANGELOG_ROUTE, changelogFeed, loadChangelog, renderChangelog } from './src/changelog.mjs'
import en from './src/content/en.mjs'
import zh from './src/content/zh.mjs'
import { checkDocs, docsText, docUrl, loadDocs, renderDoc } from './src/docs.mjs'
import { renderPage } from './src/page.mjs'
import { DOWNLOAD_URL, ISSUES_URL, LOCALES, REPO_URL, SITE_URL } from './src/site.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(here, 'dist')
const resources = path.join(here, '../owlto-client/resources')
const CONTENT = { en, zh }

// Crawlers that feed AI answer engines. They are allowed like everyone else;
// naming them documents the intent and makes it easy to change per bot.
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Bytespider',
  'CCBot'
]

function write(file, contents) {
  const target = path.join(dist, file)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

function copyBrandAssets() {
  const avatars = ['router', 'claude-code', 'codex', 'cursor']
  for (const name of avatars) {
    for (const dir of ['', 'working/']) {
      const target = path.join(dist, 'assets/owls', `${dir}${name}.svg`)
      mkdirSync(path.dirname(target), { recursive: true })
      cpSync(path.join(resources, 'owl-avatars', `${dir}${name}.svg`), target)
    }
  }
  mkdirSync(path.join(dist, 'assets/logos'), { recursive: true })
  for (const name of ['trio-white', 'trio-night', 'duo-cream', 'lean-white']) {
    cpSync(
      path.join(resources, 'app-logos', `${name}.svg`),
      path.join(dist, 'assets/logos', `${name}.svg`)
    )
  }
  cpSync(path.join(resources, 'app-logos/trio-white.svg'), path.join(dist, 'assets/favicon.svg'))
  cpSync(path.join(resources, 'app-logos/trio-white.png'), path.join(dist, 'assets/logo.png'))
}

function robots() {
  return `${['*', ...AI_CRAWLERS].map((agent) => `User-agent: ${agent}\nAllow: /\n`).join('\n')}
Sitemap: ${SITE_URL}/sitemap.xml
`
}

// One <url> per page and locale, each listing every locale's version of the
// page plus x-default (the English page).
function sitemap(lastmod, docsByLocale, releases) {
  const routes = ['', CHANGELOG_ROUTE, ...docsByLocale[LOCALES[0].code].map((doc) => doc.route)]
  const urls = routes.flatMap((route) => {
    const links = LOCALES.map(
      (l) =>
        `    <xhtml:link rel="alternate" hreflang="${l.htmlLang}" href="${SITE_URL}/${l.path}${route}"/>`
    ).join('\n')
    return LOCALES.map((locale) => {
      const doc = docsByLocale[locale.code].find((item) => item.route === route)
      return `  <url>
    <loc>${SITE_URL}/${locale.path}${route}</loc>
    <lastmod>${route === CHANGELOG_ROUTE ? releases[0].date : (doc?.updated ?? lastmod)}</lastmod>
${links}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/${LOCALES[0].path}${route}"/>
  </url>`
    })
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`
}

// llms.txt: a short, link-first summary for language models (https://llmstxt.org).
function llms(t, docs) {
  const docLinks = docs
    .filter((doc) => doc.slug)
    .map((doc) => `- [${doc.title}](${docUrl(LOCALES[0], doc)}): ${doc.description}`)
    .join('\n')
  return `# Owlto

> ${t.meta.description}

${t.faq.items[0].a}

- Platform: macOS 13 Ventura or later, Apple silicon (M1 or later)
- Price: free, open source (AGPL-3.0)
- Works with: Claude Code, Codex, Cursor (installed and signed in by the user). All three run workers. The Router runs on Claude Code, Codex, or Owlto's built-in engine (your own model API key or a local OpenAI-compatible endpoint); Cursor can't run the Router.
- Languages: English, Simplified Chinese

## Docs

- [Documentation home](${SITE_URL}/docs/): every guide, grouped by task
${docLinks}

## Links

- [Website](${SITE_URL}/): product overview, features, and FAQ
- [Website (简体中文)](${SITE_URL}/zh/): the same page in Simplified Chinese
- [Changelog](${SITE_URL}/${CHANGELOG_ROUTE}): what changed in each release, newest first
- [Full text for LLMs](${SITE_URL}/llms-full.txt): every feature, the setup steps, the FAQ, and the docs in one file
- [Download](${DOWNLOAD_URL}): latest .dmg on GitHub Releases
- [Source code](${REPO_URL}): GitHub repository and README
- [Issues](${ISSUES_URL}): bug reports and feature requests
`
}

function llmsFull(t, locale, docs) {
  const features = Object.values(t.features.items)
    .map((item) => `- **${item.title}.** ${item.text}`)
    .join('\n')
  const more = t.features.more.map((item) => `- ${item}`).join('\n')
  const how = t.demo.steps
    .map((step, index) => `${index + 1}. **${step.title}.** ${step.text}`)
    .join('\n')
  const steps = t.start.steps
    .map((step, index) => `${index + 1}. **${step.title}.** ${step.text}`)
    .join('\n')
  const agents = t.start.agents.map((agent) => `- ${agent.name}: \`${agent.command}\``).join('\n')
  const compare = t.compare.rows
    .map(([label, before, after]) => `| ${label} | ${before} | ${after} |`)
    .join('\n')
  const faq = t.faq.items.map((item) => `### ${item.q}\n\n${item.a}`).join('\n\n')
  return `# Owlto

> ${t.meta.description}

${t.hero.sub}

Website: ${SITE_URL}/
Download: ${DOWNLOAD_URL}
Source: ${REPO_URL}

## ${t.chaos.kicker}

${t.chaos.body}

## ${t.demo.kicker}

${how}

## ${t.features.kicker}

${features}

${more}

## ${t.start.kicker}

${t.start.body}

${steps}

Agent install commands:

${agents}

## ${t.trust.kicker}

${t.trust.items.map((item) => `- **${item.title}.** ${item.text}`).join('\n')}

${t.trust.caution}

## ${t.compare.title}

| | ${t.compare.head[1]} | ${t.compare.head[2]} |
| --- | --- | --- |
${compare}

## ${t.faq.kicker}

${faq}

# ${t.docs.label}

${docsText(locale, docs)}
`
}

function manifest() {
  return JSON.stringify(
    {
      name: 'Owlto',
      short_name: 'Owlto',
      description: en.meta.description,
      start_url: './',
      display: 'browser',
      background_color: '#FFF9EC',
      theme_color: '#FFF9EC',
      icons: [
        { src: 'assets/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        { src: 'assets/logo.png', sizes: '1024x1024', type: 'image/png' }
      ]
    },
    null,
    2
  )
}

function notFound() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · Owlto</title>
<meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FFF9EC;color:#151515;font:500 18px/1.6 'Avenir Next',system-ui,sans-serif;text-align:center}h1{font:italic 900 5rem/1 'Avenir Next Condensed','Arial Narrow',sans-serif;margin:0 0 8px}a{color:inherit;font-weight:700}</style>
</head>
<body><main><h1>Hoo?</h1><p>This page flew away. <a href="${SITE_URL}/">Back to Owlto</a></p></main></body>
</html>
`
}

export function build() {
  rmSync(dist, { recursive: true, force: true })
  cpSync(path.join(here, 'public'), dist, { recursive: true })
  copyBrandAssets()

  const { version } = JSON.parse(
    readFileSync(path.join(here, '../owlto-client/package.json'), 'utf8')
  )
  const docsByLocale = Object.fromEntries(
    LOCALES.map((locale) => [locale.code, loadDocs(locale, CONTENT[locale.code].docs.groupOrder)])
  )
  checkDocs(docsByLocale)
  const releases = loadChangelog()
  for (const locale of LOCALES) {
    const t = CONTENT[locale.code]
    const docs = docsByLocale[locale.code]
    write(`${locale.path}index.html`, renderPage({ t, locale, version, docs }))
    for (const doc of docs) {
      write(`${locale.path}${doc.route}index.html`, renderDoc({ t, locale, doc, docs }))
    }
    write(
      `${locale.path}${CHANGELOG_ROUTE}index.html`,
      renderChangelog({ t, locale, releases, docs })
    )
  }
  write('robots.txt', robots())
  write('sitemap.xml', sitemap(new Date().toISOString().slice(0, 10), docsByLocale, releases))
  write('llms.txt', llms(en, docsByLocale.en))
  write('llms-full.txt', llmsFull(en, LOCALES[0], docsByLocale.en))
  write('zh/llms-full.txt', llmsFull(zh, LOCALES[1], docsByLocale.zh))
  write(`${CHANGELOG_ROUTE}feed.xml`, changelogFeed(en, releases))
  write('site.webmanifest', manifest())
  write('404.html', notFound())
  // GitHub Pages: serve files as-is, without Jekyll processing.
  write('.nojekyll', '')
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json'
}

function serve(port) {
  const self = fileURLToPath(import.meta.url)
  createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost')
    const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname
    const file = path.join(dist, path.normalize(decodeURIComponent(relative)))
    if (!file.startsWith(dist)) {
      response.writeHead(403).end()
      return
    }
    try {
      // Rebuild in a child process on page loads so edits to the ES modules
      // (which this process has already cached) are picked up.
      if (file.endsWith('.html')) execFileSync(process.execPath, [self], { stdio: 'inherit' })
      const body = readFileSync(file)
      response.writeHead(200, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store'
      })
      response.end(body)
    } catch {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      response.end(notFound())
    }
  }).listen(port, '127.0.0.1', () => {
    console.log(`Owlto website: http://127.0.0.1:${port}/`)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  build()
  if (args.includes('--serve')) {
    const flag = args.indexOf('--port')
    serve(flag === -1 ? 4321 : Number(args[flag + 1]))
  } else {
    console.log(`Built ${path.relative(process.cwd(), dist) || 'dist'}`)
  }
}
