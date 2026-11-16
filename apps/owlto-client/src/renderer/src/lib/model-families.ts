/** Trailing words that name a variant of a model rather than the model itself. */
const VARIANT_WORDS = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'extra',
  'xhigh',
  'max',
  'fast',
  'thinking'
])

/**
 * Splits a model's display name into its family and variant, such as "Grok 4.7" and
 * "Low Fast" for "Grok 4.7 Low Fast". A name with no variant words has an empty variant.
 */
export function splitModelName(name: string): { family: string; variant: string } {
  const words = name.trim().split(/\s+/)
  let cut = words.length
  while (cut > 1 && VARIANT_WORDS.has(words[cut - 1].replace(/[()]/g, '').toLowerCase())) cut--
  return { family: words.slice(0, cut).join(' '), variant: words.slice(cut).join(' ') }
}

/** Groups items by model family, keeping the order families and items first appear in. */
export function groupByFamily<T>(
  items: readonly T[],
  name: (item: T) => string
): Array<{ family: string; items: Array<{ item: T; variant: string }> }> {
  const groups = new Map<string, Array<{ item: T; variant: string }>>()
  for (const item of items) {
    const { family, variant } = splitModelName(name(item))
    const group = groups.get(family)
    if (group) group.push({ item, variant })
    else groups.set(family, [{ item, variant }])
  }
  return [...groups].map(([family, members]) => ({ family, items: members }))
}
