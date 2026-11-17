# Owlto website

The marketing site for Owlto: a zero-dependency static site, generated once per
locale so every language ships as plain HTML that search engines and AI answer
engines can read without running JavaScript.

## Commands

Run from the repo root:

```bash
pnpm --filter owlto-website dev     # build + serve on http://127.0.0.1:4321, rebuilds on reload
pnpm --filter owlto-website build   # write the site to apps/owlto-website/dist
pnpm --filter owlto-website check   # build, then check links, anchors, canonicals, hreflang, and the sitemap
pnpm --filter owlto-website og      # re-render public/assets/og.png (needs Google Chrome)
pnpm --filter owlto-website deploy:cf   # build, then deploy dist/ to Cloudflare
```

## Hosting

The site runs on Cloudflare Workers static assets as the `owlto` Worker
(`wrangler.jsonc`), at <https://owlto.dev>. The custom domain is the `routes`
entry in `wrangler.jsonc`; the Worker is also reachable at
`owlto.libertylab.workers.dev`, and every page points its canonical link at
`owlto.dev`. `deploy:cf` needs a one-time `pnpm dlx wrangler login` on the
machine that deploys. There is no automatic deploy: merging to `main` does not
publish the site.

To change the domain, edit the `routes` entry, set `SITE_URL` in
`src/site.mjs` to the new origin, and deploy again.

`dist/` is a plain static folder with relative asset links, so it can also be
hosted on any other static host or CDN.

## Layout

- `src/site.mjs`: site constants. **`SITE_URL` must match the origin the site is
  served from.** Canonical links, hreflang, the sitemap, Open Graph URLs,
  JSON-LD, and `llms.txt` all derive from it.
- `src/content/en.mjs`, `src/content/zh.mjs`: all copy, key for key. Keep the
  facts in sync with the root `README.md`.
- `src/page.mjs`: the home page template, plus the shared header and footer.
  `src/owl.mjs`: the inline hero owls.
- `src/docs/<locale>/*.md`: the docs pages, one Markdown file per page (see
  below). `src/docs.mjs` loads and renders them; `src/markdown.mjs` is the small
  Markdown renderer they use.
- `public/assets/`: `styles.css`, `app.js`, and the rendered `og.png`.
- `build.mjs`: renders `/` (English), `/zh/` (Simplified Chinese), and every
  docs page under `/docs/` and `/zh/docs/`, copies owl
  avatars and logos from `apps/owlto-client/resources`, and writes the
  discovery files below.

## SEO and AEO output

| File | Purpose |
| --- | --- |
| `index.html`, `zh/index.html` | Pre-rendered pages with canonical, hreflang, Open Graph, and Twitter tags |
| `docs/**/index.html`, `zh/docs/**/index.html` | Docs pages with the same tags, a breadcrumb, and an "On this page" outline |
| JSON-LD in each page | Home: `SoftwareApplication`, `FAQPage`, `HowTo`, `Organization`, `WebSite`, `SoftwareSourceCode`. Docs: `TechArticle` (or `CollectionPage` for the docs home) and `BreadcrumbList` |
| `sitemap.xml` | Every page in both locales with hreflang alternates |
| `robots.txt` | Allows all crawlers, names the AI crawlers explicitly, links the sitemap |
| `llms.txt`, `llms-full.txt`, `zh/llms-full.txt` | Link-first summary and full text for language models |

The FAQ, the comparison table, and the "What is Owlto?" answer are written as
short, self-contained statements so answer engines can quote them. When a fact
changes (supported agents, system requirements, license), update the content
files and rebuild; the HTML, JSON-LD, and `llms*.txt` stay in sync.

## Docs

Each docs page is a Markdown file in `src/docs/en/` with a partner of the same
name in `src/docs/zh/`; the build fails if the two folders don't match, if a
`related` page doesn't exist, or if a `/docs/...` link points at a missing page.
`index.md` is the docs home at `/docs/`; `quickstart.md` becomes
`/docs/quickstart/`.

Frontmatter:

```yaml
title: Page title, also the <title> and the H1
navTitle: Short title for the sidebar, cards, and footer
description: One sentence that says what the page covers (meta description)
group: start | guides | concepts | reference
order: 1            # position inside the group
updated: 2026-11-16 # date the page was last checked against the app
related: quickstart, troubleshooting   # optional, shown at the end of the page
footer: true        # optional, list the page in the site footer
```

The Markdown subset: `##`/`###` headings, paragraphs, `-` and `1.` lists,
fenced code blocks (rendered with a copy button), pipe tables, `> **Note:**`
callouts (also Tip, Warning, Important, and 注意, 提示, 警告, 重要), `**bold**`,
`` `code` ``, and links. Write site links without the locale, such as
`/docs/quickstart/#step-2-ask-the-router`; they resolve per locale. Chinese
headings get Chinese anchor ids, so link to them by their own text.

Docs describe the app as it is: check behavior and UI labels against
`apps/owlto-client` (and its i18n files for the exact English and Chinese
labels) before writing, and bump `updated` when you re-check a page.

## Adding a locale

Add an entry to `LOCALES` in `src/site.mjs`, add `src/content/<code>.mjs` with
the same keys, add `src/docs/<code>/` with the same pages, and register the
content in `CONTENT` in `build.mjs`.
