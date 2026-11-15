// Inline owl drawings that share the app avatars' geometry
// (apps/owlto-client/resources/owl-avatars). They are inlined instead of
// loaded as <img> so the page script can move the pupils toward the pointer.

const INK = '#151515'
const stroke = (width) =>
  `stroke="${INK}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`

const eye = (cx, pupilX, ring) => `<g class="owl-eye">
<circle cx="${cx}" cy="270" r="72" fill="#fff" ${stroke(18)}/>
<circle cx="${cx}" cy="270" r="43" fill="none" stroke="${ring}" stroke-width="7"/>
<g class="owl-pupil"><circle cx="${pupilX}" cy="272" r="23" fill="${INK}"/><circle cx="${pupilX + 8}" cy="263" r="6" fill="#fff"/></g>
</g>`

const EXTRAS = {
  tie: `<path d="M256 412 L214 388 L214 436 Z M256 412 L298 388 L298 436 Z" fill="#fff" ${stroke(13)}/>
<circle cx="256" cy="412" r="9" fill="${INK}"/>`,
  chest: [
    [203, 428],
    [279, 428],
    [241, 468]
  ]
    .map(([x, y]) => `<path d="M${x} ${y} q15 16 30 0" fill="none" ${stroke(13)}/>`)
    .join('\n')
}

/**
 * @param {{ body: string, ring?: string, extra?: 'tie' | 'chest', height?: number }} options
 * `height` crops the drawing from the top of the head, in drawing units.
 */
export function owlSvg({ body, ring = '#D9DDE4', extra = 'chest', height = 420 }) {
  return `<svg class="owl-svg" viewBox="52 80 408 ${height}" aria-hidden="true" focusable="false">
<path d="M72 620 L72 290 C72 160 156 100 256 100 C356 100 440 160 440 290 L440 620 Z" fill="${body}" ${stroke(20)}/>
<path d="M72 404 C112 424 134 476 134 620" fill="none" ${stroke(16)}/>
<path d="M440 404 C400 424 378 476 378 620" fill="none" ${stroke(16)}/>
${eye(180, 188, ring)}
${eye(332, 324, ring)}
<path d="M234 320 Q256 308 278 320 Q274 354 256 366 Q238 354 234 320 Z" fill="#FFB000" ${stroke(12)}/>
${EXTRAS[extra]}
</svg>`
}

export const OWLS = {
  router: { body: '#F4F1E8', ring: '#C9CED8', extra: 'tie' },
  claude: { body: '#E8785A', ring: '#F3C3B5' },
  codex: { body: '#3A3E46', ring: '#C9CED8' },
  cursor: { body: '#7C8CFF', ring: '#CBD1FF' },
  team: { body: '#5FB3A1', ring: '#BFE3DA' }
}
