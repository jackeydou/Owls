// Renders the social preview image (public/assets/og.png, 1200x630) with the
// locally installed Google Chrome. Run it after
// changing the hero copy or the brand: `pnpm --filter owlto-website og`.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import en from '../src/content/en.mjs'
import { OWLS, owlSvg } from '../src/owl.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!existsSync(CHROME)) {
  console.error(`Google Chrome not found at ${CHROME}`)
  process.exit(1)
}

const [lineA, accent, lineB] = en.hero.title
const flock = [
  ['cursor', 190],
  ['claude', 230],
  ['router', 270],
  ['codex', 230],
  ['team', 190]
]
const html = `<!doctype html>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; position: relative; background: #FFF9EC; color: #151515;
    font-family: 'Avenir Next Condensed', 'Arial Narrow', sans-serif; text-align: center; }
  .orb { position: absolute; left: 50%; bottom: -520px; width: 980px; height: 980px; margin-left: -490px; border-radius: 50%; background: #FFD66B; }
  .brand { position: relative; margin-top: 34px; font: italic 900 46px/1 'Avenir Next Condensed'; }
  h1 { position: relative; margin-top: 8px; font: italic 900 118px/0.9 'Avenir Next Condensed'; letter-spacing: -3px; text-transform: uppercase; }
  mark { display: inline-block; padding: 0 22px 6px; background: #FFB000; border: 5px solid #151515; border-radius: 18px; box-shadow: 8px 8px 0 #151515; transform: rotate(-2deg); }
  .flock { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: flex-end; justify-content: center; border-bottom: 10px solid #151515; }
  .flock div { margin: 0 -14px; }
  .flock svg { display: block; width: 100%; height: auto; overflow: visible; }
</style>
<div class="orb"></div>
<p class="brand">Owlto</p>
<h1>${lineA}<br><mark>${accent}</mark><br>${lineB}</h1>
<div class="flock">${flock
  .map(
    ([id, width], index) =>
      `<div style="width:${width}px;z-index:${index === 2 ? 2 : 1}">${owlSvg({ ...OWLS[id], height: 300 })}</div>`
  )
  .join('')}</div>
`
const scratch = mkdtempSync(path.join(tmpdir(), 'owlto-og-'))
const source = path.join(scratch, 'og.html')
const target = path.join(here, '../public/assets/og.png')
writeFileSync(source, html)
execFileSync(
  CHROME,
  [
    '--headless',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1200,630',
    `--screenshot=${target}`,
    pathToFileURL(source).href
  ],
  { stdio: 'ignore' }
)
rmSync(scratch, { recursive: true, force: true })
console.log(`Wrote ${path.relative(process.cwd(), target)}`)
