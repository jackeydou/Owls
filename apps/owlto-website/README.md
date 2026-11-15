# Owlto website

The marketing site for Owlto: a zero-dependency static site, generated once per
locale so every language ships as plain HTML that search engines and AI answer
engines can read without running JavaScript.

## Commands

Run from the repo root:

```bash
pnpm --filter owlto-website dev     # build + serve on http://127.0.0.1:4321, rebuilds on reload
pnpm --filter owlto-website build   # write the site to apps/owlto-website/dist
pnpm --filter owlto-website og      # re-render public/assets/og.png (needs Google Chrome)
```

`dist/` is a plain static folder. Host it anywhere (GitHub Pages, Cloudflare
Pages, any CDN). All asset links are relative, so it also works on a sub-path.

## Layout

- `src/site.mjs`: site constants. **Set `SITE_URL` to the real origin before
  deploying.** Canonical links, hreflang, the sitemap, Open Graph URLs,
  JSON-LD, and `llms.txt` all derive from it.
- `src/content/en.mjs`, `src/content/zh.mjs`: all copy, key for key. Keep the
  facts in sync with the root `README.md`.
- `src/page.mjs`: the page template. `src/owl.mjs`: the inline hero owls.
- `public/assets/`: `styles.css`, `app.js`, and the rendered `og.png`.
- `build.mjs`: renders `/` (English) and `/zh/` (Simplified Chinese), copies owl
  avatars and logos from `apps/owlto-client/resources`, and writes the
  discovery files below.

## SEO and AEO output

| File | Purpose |
| --- | --- |
| `index.html`, `zh/index.html` | Pre-rendered pages with canonical, hreflang, Open Graph, and Twitter tags |
| JSON-LD in each page | `SoftwareApplication`, `FAQPage`, `HowTo`, `Organization`, `WebSite`, `SoftwareSourceCode` |
| `sitemap.xml` | Both locales with hreflang alternates |
| `robots.txt` | Allows all crawlers, names the AI crawlers explicitly, links the sitemap |
| `llms.txt`, `llms-full.txt`, `zh/llms-full.txt` | Link-first summary and full text for language models |

The FAQ, the comparison table, and the "What is Owlto?" answer are written as
short, self-contained statements so answer engines can quote them. When a fact
changes (supported agents, system requirements, license), update the content
files and rebuild; the HTML, JSON-LD, and `llms*.txt` stay in sync.

## Adding a locale

Add an entry to `LOCALES` in `src/site.mjs`, add `src/content/<code>.mjs` with
the same keys, and register it in `CONTENT` in `build.mjs`.
