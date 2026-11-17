// A small Markdown renderer for the docs pages. Zero dependencies; it covers
// only the subset the docs use:
//   frontmatter (key: value), ## and ### headings, paragraphs, - and 1. lists,
//   fenced code blocks, pipe tables, > callouts (> **Note:** ...),
//   **bold**, `code`, and [links](href).
// Anything else is rendered as a plain paragraph, escaped.
import { esc } from './escape.mjs'

// Splits `---` frontmatter from the body. Values are plain strings.
export function parseFrontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source)
  if (!match) return { data: {}, body: source }
  const data = {}
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':')
    if (index === -1) continue
    const value = line.slice(index + 1).trim()
    data[line.slice(0, index).trim()] = /^".*"$/.test(value) ? value.slice(1, -1) : value
  }
  return { data, body: source.slice(match[0].length) }
}

// Heading ids: ASCII slugs for English; for other scripts keep the letters and
// fall back to a positional id so anchors stay stable and unique.
export function slugify(text, used) {
  const base =
    text
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}-${n++}`
  used.add(id)
  return id
}

// Inline formatting. `resolveHref` rewrites site-relative links such as
// `/docs/quickstart/` to paths that work from the current page.
export function inline(text, resolveHref = (href) => href) {
  const codes = []
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${esc(code)}</code>`)
    return `\uE000${codes.length - 1}\uE000`
  })
  out = esc(out)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const external = /^https?:/.test(href)
    const target = external ? href : resolveHref(href)
    return `<a href="${esc(target)}"${external ? ' rel="noopener"' : ''}>${label}</a>`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return out.replace(/\uE000(\d+)\uE000/g, (_, index) => codes[Number(index)])
}

// Strips inline Markdown for plain-text uses (meta descriptions, JSON-LD, TOC).
export const plain = (text) =>
  text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')

const CALLOUTS = {
  note: ['Note', '注意'],
  tip: ['Tip', '提示'],
  warning: ['Warning', '警告'],
  important: ['Important', '重要']
}

function calloutKind(firstLine) {
  const match = /^\*\*([^*:：]+)[:：]?\*\*[:：]?\s*/.exec(firstLine)
  if (!match) return null
  const label = match[1].trim().toLowerCase()
  for (const [kind, names] of Object.entries(CALLOUTS)) {
    if (names.some((name) => name.toLowerCase() === label)) return kind
  }
  return null
}

function table(lines, resolveHref) {
  const rows = lines.map((line) =>
    line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())
  )
  const [head, , ...body] = rows
  return `<div class="table-wrap"><table>
<thead><tr>${head.map((cell) => `<th scope="col">${inline(cell, resolveHref)}</th>`).join('')}</tr></thead>
<tbody>
${body.map((row) => `<tr>${row.map((cell, index) => (index === 0 ? `<th scope="row">${inline(cell, resolveHref)}</th>` : `<td>${inline(cell, resolveHref)}</td>`)).join('')}</tr>`).join('\n')}
</tbody>
</table></div>`
}

// Renders a Markdown body. Returns the HTML and the h2 outline for the TOC.
// `copy` ({ label, copied }) adds a copy button to each code block.
export function renderMarkdown(source, { resolveHref, copy } = {}) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const html = []
  const toc = []
  const used = new Set()
  let i = 0

  const isBlockStart = (line) => /^(#{2,3} |```|> |\||- |\d+\. )/.test(line) || line.trim() === ''

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      continue
    }
    const heading = /^(#{2,3}) (.+)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const text = heading[2].trim()
      const id = slugify(plain(text), used)
      if (level === 2) toc.push({ id, text: plain(text) })
      html.push(
        `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inline(text, resolveHref)}</h${level}>`
      )
      i++
      continue
    }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const code = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      i++
      const text = code.join('\n')
      const button = copy
        ? `<button class="cmd-copy code-copy" type="button" data-copy="${esc(text)}" data-copied="${esc(copy.copied)}"><span>${esc(copy.label)}</span></button>`
        : ''
      html.push(
        `<div class="code-block"><pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(text)}</code></pre>${button}</div>`
      )
      continue
    }
    if (line.startsWith('> ')) {
      const quote = []
      while (i < lines.length && lines[i].startsWith('>'))
        quote.push(lines[i++].replace(/^> ?/, ''))
      const kind = calloutKind(quote[0]) ?? 'note'
      const text = quote.join(' ')
      html.push(
        `<aside class="callout callout-${kind}"><p>${inline(text, resolveHref)}</p></aside>`
      )
      continue
    }
    if (line.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++])
      html.push(table(rows, resolveHref))
      continue
    }
    const listMatch = /^(- |\d+\. )/.exec(line)
    if (listMatch) {
      const ordered = listMatch[1] !== '- '
      const items = []
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) {
        let item = lines[i].replace(/^(- |\d+\. )/, '')
        i++
        // Continuation lines are indented by two or more spaces.
        while (i < lines.length && /^ {2,}\S/.test(lines[i])) item += ` ${lines[i++].trim()}`
        items.push(item)
      }
      const tag = ordered ? 'ol' : 'ul'
      // A numbered list that resumes after a code block keeps its numbering.
      const start = ordered ? Number.parseInt(listMatch[1], 10) : 1
      html.push(
        `<${tag}${start > 1 ? ` start="${start}"` : ''}>${items.map((item) => `<li>${inline(item, resolveHref)}</li>`).join('')}</${tag}>`
      )
      continue
    }
    const paragraph = [line]
    i++
    while (i < lines.length && !isBlockStart(lines[i])) paragraph.push(lines[i++])
    html.push(`<p>${inline(paragraph.join(' '), resolveHref)}</p>`)
  }
  return { html: html.join('\n'), toc }
}
