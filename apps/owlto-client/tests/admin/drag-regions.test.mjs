import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Electron hands no clicks or wheel turns to a `-webkit-app-region: drag` area or to anything
// inside it that does not opt out with `no-drag`. A drag region on a container (a sidebar, a
// panel, a page) therefore breaks every list, pane, and scroll area added to it later, which
// has shipped more than once. Only fixed-height title bars may drag. A new bar is added here
// on purpose, after checking it is a bar and not a container.
const TITLE_BARS = [
  '.card-editor > header',
  '.cards-hud',
  '.map-hud',
  '.onb-bar',
  '.owlto-settings-drag',
  '.owlto-topbar',
  '.router-panel > header',
  '.router-projects-head',
  '.router-sidebar-head'
]
// Flex fillers inside a bar whose other children opt out with `no-drag`.
const BAR_FILLERS = ['.card-editor-space', '.cards-hud-space', '.map-hud-space']

const here = dirname(fileURLToPath(import.meta.url))
const rendererRoot = join(here, '../../src/renderer')

function sourceFiles(dir, extensions) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(path, extensions))
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path)
  }
  return found.sort()
}

/** Every innermost CSS rule that turns on dragging, as `{ file, selector, body }`. */
function dragRules() {
  const rules = []
  for (const file of sourceFiles(rendererRoot, ['.css'])) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = match[2]
      if (!/-webkit-app-region\s*:\s*drag\b/.test(body)) continue
      const selector = match[1].trim().replace(/\s+/g, ' ')
      rules.push({ file: relative(rendererRoot, file), selector, body })
    }
  }
  return rules
}

test('only title bars are window drag regions', () => {
  const rules = dragRules()
  assert.ok(rules.length > 0, 'expected the title bars to declare drag regions')
  const allowed = new Set([...TITLE_BARS, ...BAR_FILLERS])
  const leaks = rules
    .flatMap((rule) => rule.selector.split(',').map((part) => ({ ...rule, selector: part.trim() })))
    .filter((rule) => !allowed.has(rule.selector))
    .map((rule) => `${rule.file}: ${rule.selector}`)
  assert.deepEqual(
    leaks,
    [],
    'Drag regions belong on fixed-height title bars only, never on a sidebar, panel, or ' +
      'page. Move the drag to the bar, or add a genuine new bar to TITLE_BARS.'
  )
})

test('every title bar drag region has a fixed height', () => {
  for (const rule of dragRules()) {
    if (!TITLE_BARS.includes(rule.selector)) continue
    assert.match(
      rule.body,
      /(^|[;\s])height\s*:/,
      `${rule.file}: ${rule.selector} drags, so it must be a fixed-height bar`
    )
  }
})

test('components do not turn on dragging outside the stylesheets', () => {
  const offenders = sourceFiles(rendererRoot, ['.ts', '.tsx', '.html'])
    .filter((file) => {
      const source = readFileSync(file, 'utf8')
      return (
        /\[-webkit-app-region:\s*drag\]/.test(source) ||
        /WebkitAppRegion\s*:\s*['"]drag['"]/.test(source)
      )
    })
    .map((file) => relative(rendererRoot, file))
  assert.deepEqual(offenders, [], 'Set drag regions in CSS on a title bar listed in this test')
})
