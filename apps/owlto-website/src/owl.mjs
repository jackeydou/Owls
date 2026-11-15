// Inline owls for the hero, taken from the app's own avatar drawings
// (apps/owlto-client/resources/owl-avatars) so the site always shows the real
// owls. They are inlined, not loaded as <img>, so the page script can move the
// pupils toward the pointer; the round avatar background is dropped so the
// owls can stand in a row.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const avatars = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../owlto-client/resources/owl-avatars'
)

// Every avatar wraps its owl in one positioning group inside the clip group.
const BODY = /<g transform="translate\(256 304\)[^"]*">([\s\S]*)<\/g>\s*<\/g>\s*<\/svg>\s*$/
const PUPIL = /<circle cx="(?:188|324)" cy="276" r="\d+" fill="#151515"\/>/g
const EYES = [
  /<circle cx="180" cy="270" r="72"[\s\S]*?<circle cx="188" cy="276"[^>]*\/>/,
  /<circle cx="332" cy="270" r="72"[\s\S]*?<circle cx="324" cy="276"[^>]*\/>/
]

function drawing(id) {
  const source = readFileSync(path.join(avatars, `${id}.svg`), 'utf8')
  const body = source.match(BODY)?.[1]
  if (!body) throw new Error(`owl-avatars/${id}.svg: owl group not found`)
  let art = body
  // The user's owl wears sunglasses: no eyes to animate.
  if (id === 'user') return art
  for (const eye of EYES) {
    if (!eye.test(art)) throw new Error(`owl-avatars/${id}.svg: eye not found`)
    // Group each eye so it can blink, and its pupil so it can look around.
    art = art.replace(eye, (match) => `<g class="owl-eye">${match}</g>`)
  }
  return art.replace(PUPIL, (match) => `<g class="owl-pupil">${match}</g>`)
}

/**
 * @param {'router' | 'claude-code' | 'codex' | 'cursor' | 'user'} id avatar file name
 * @param {number} height crops the drawing from the top of the head, in drawing units
 */
export function owlSvg(id, height = 420) {
  return `<svg class="owl-svg" viewBox="52 80 408 ${height}" aria-hidden="true" focusable="false">${drawing(id)}</svg>`
}
