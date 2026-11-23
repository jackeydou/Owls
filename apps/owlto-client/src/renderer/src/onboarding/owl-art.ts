import { createElement, type ReactNode } from 'react'
import antigravity from '../../../../resources/owl-avatars/antigravity.svg?raw'
import claudeCode from '../../../../resources/owl-avatars/claude-code.svg?raw'
import codex from '../../../../resources/owl-avatars/codex.svg?raw'
import cursor from '../../../../resources/owl-avatars/cursor.svg?raw'
import router from '../../../../resources/owl-avatars/router.svg?raw'
import user from '../../../../resources/owl-avatars/user.svg?raw'

export type OwlId = 'user' | 'claude-code' | 'router' | 'codex' | 'cursor' | 'antigravity'

const SOURCES: Record<OwlId, string> = {
  user,
  'claude-code': claudeCode,
  router,
  codex,
  cursor,
  antigravity
}

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

function element(node: Element, key: number, children: ReactNode[] = []): ReactNode {
  const props: Record<string, string | number> = { key }
  for (const { name, value } of [...node.attributes]) props[camel(name)] = value
  return createElement(node.tagName, props, ...children)
}

/**
 * The owl drawing from an avatar file, without its round background, as React nodes. The
 * same art as the website hero (apps/owlto-website/src/owl.mjs): each eye is grouped so it
 * can blink, and each pupil so it can follow the pointer. The user's owl wears sunglasses.
 */
function drawing(id: OwlId): ReactNode[] {
  const doc = new DOMParser().parseFromString(SOURCES[id], 'image/svg+xml')
  const body = doc.querySelector('g[transform^="translate(256 304)"]')
  if (!body) return []
  const nodes: ReactNode[] = []
  let eye: ReactNode[] | null = null
  let key = 0
  for (const child of [...body.children]) {
    const circle = child.tagName === 'circle'
    if (circle && child.getAttribute('r') === '72') eye = []
    const pupil = circle && child.getAttribute('cy') === '276'
    const node = pupil
      ? createElement('g', { key: key++, className: 'onb-owl-pupil' }, element(child, 0))
      : element(child, key++)
    if (eye) eye.push(node)
    else nodes.push(node)
    if (pupil && eye) {
      nodes.push(createElement('g', { key: key++, className: 'onb-owl-eye' }, ...eye))
      eye = null
    }
  }
  return nodes
}

const cache = new Map<OwlId, ReactNode[]>()
/** Parsed once per owl; the files are bundled with the app. */
export function owlDrawing(id: OwlId): ReactNode[] {
  let nodes = cache.get(id)
  if (!nodes) {
    nodes = drawing(id)
    cache.set(id, nodes)
  }
  return nodes
}
