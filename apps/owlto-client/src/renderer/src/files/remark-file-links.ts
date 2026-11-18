import { defaultRemarkPlugins } from 'streamdown'
import { isLocalHref } from '../../../shared/file-preview'

/**
 * Local file links leave the Markdown tree as `#owlto-file:<path>`. Streamdown's link
 * hardening blocks a bare relative target such as `src/a.ts` (it shows "[blocked]") and
 * rewrites absolute ones, but leaves hash links alone; MarkdownLink reads the path back.
 */
export const FILE_HREF_PREFIX = '#owlto-file:'

export const fileHref = (path: string) => `${FILE_HREF_PREFIX}${encodeURIComponent(path)}`

/** The path a rewritten link points at, or null for any other link. */
export function fileHrefPath(href: string): string | null {
  if (!href.startsWith(FILE_HREF_PREFIX)) return null
  try {
    return decodeURIComponent(href.slice(FILE_HREF_PREFIX.length))
  } catch {
    return null
  }
}

type MarkdownNode = { type: string; url?: string; children?: MarkdownNode[] }

function rewrite(node: MarkdownNode): void {
  if ((node.type === 'link' || node.type === 'definition') && node.url && isLocalHref(node.url))
    node.url = fileHref(node.url)
  for (const child of node.children ?? []) rewrite(child)
}

/** The remark plugin that marks local file links before hardening runs. */
function remarkFileLinks() {
  return (tree: MarkdownNode) => rewrite(tree)
}

/** Streamdown's own remark plugins, then the file link rewrite. */
export const markdownRemarkPlugins = [...Object.values(defaultRemarkPlugins), remarkFileLinks]
