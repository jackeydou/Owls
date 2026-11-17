// Checks the built site in dist/: every internal link and #anchor resolves,
// every page has a self-referencing canonical, title, description, lang, and
// hreflang partners, and every sitemap URL maps to a built page.
//   node scripts/check-site.mjs        (run `node build.mjs` first)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SITE_URL } from '../src/site.mjs'

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist')

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return htmlFiles(full)
    return name.endsWith('.html') && name !== '404.html' ? [full] : []
  })
}

const statSafe = (file) => {
  try {
    return statSync(file)
  } catch {
    return null
  }
}

const pages = new Map()
for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, 'utf8')
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))
  pages.set(file, { html, ids })
}

const errors = []
const fail = (file, message) => errors.push(`${path.relative(dist, file)}: ${message}`)
const pageFor = (target) => {
  // path.resolve drops trailing slashes, so treat directories as their index.html.
  const isDir = target.endsWith('/') || (statSafe(target)?.isDirectory() ?? false)
  const file = isDir ? path.join(target, 'index.html') : target
  if (pages.has(file)) return { file, page: pages.get(file) }
  return statSafe(file) ? { file, page: null } : null
}

for (const [file, { html }] of pages) {
  const dir = path.dirname(file)
  const one = (pattern) => [...html.matchAll(pattern)].map((match) => match[1])

  const titles = one(/<title>([^<]*)<\/title>/g)
  if (titles.length !== 1 || !titles[0].trim()) fail(file, 'needs exactly one non-empty <title>')
  const descriptions = one(/<meta name="description" content="([^"]*)">/g)
  // Chinese packs about twice the meaning per character.
  const minLength = /<html lang="zh/.test(html) ? 25 : 50
  if (descriptions.length !== 1 || descriptions[0].length < minLength) {
    fail(file, `needs one meta description of at least ${minLength} characters`)
  }
  if (!/<html lang="[^"]+">/.test(html)) fail(file, 'missing <html lang>')
  if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) {
    fail(file, 'needs exactly one <h1>')
  }

  const route = `/${path.relative(dist, dir).split(path.sep).join('/')}`.replace(/\/?$/, '/')
  const canonical = one(/<link rel="canonical" href="([^"]+)">/g)
  if (canonical.length !== 1 || canonical[0] !== `${SITE_URL}${route}`.replace(/\/\/$/, '/')) {
    fail(file, `canonical ${canonical[0]} should be ${SITE_URL}${route}`)
  }
  const hreflang = one(/<link rel="alternate" hreflang="[^"]+" href="([^"]+)">/g)
  if (hreflang.length < 3) fail(file, 'needs hreflang links for every locale plus x-default')
  for (const href of hreflang) {
    if (!pageFor(path.join(dist, href.replace(SITE_URL, ''))))
      fail(file, `hreflang target missing: ${href}`)
  }

  for (const href of one(/<a [^>]*href="([^"]+)"/g)) {
    if (/^(https?:|mailto:)/.test(href)) continue
    const [target, anchor] = href.split('#')
    const resolved = target ? pageFor(path.resolve(dir, target)) : { file, page: pages.get(file) }
    if (!resolved) {
      fail(file, `broken link: ${href}`)
      continue
    }
    if (anchor && resolved.page && !resolved.page.ids.has(anchor)) {
      fail(file, `missing anchor: ${href}`)
    }
  }
}

const sitemap = readFileSync(path.join(dist, 'sitemap.xml'), 'utf8')
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
for (const loc of locs) {
  if (!pageFor(path.join(dist, loc.replace(SITE_URL, ''))))
    errors.push(`sitemap: no page for ${loc}`)
}
if (locs.length !== pages.size) {
  errors.push(`sitemap lists ${locs.length} URLs but ${pages.size} pages were built`)
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`Checked ${pages.size} pages and ${locs.length} sitemap URLs: no problems found.`)
