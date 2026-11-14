import {
  defaultRehypePlugins,
  defaultUrlTransform,
  type StreamdownProps,
  type UrlTransform
} from 'streamdown'
import { localHrefFromHref, localPathFromHref, localPathFromImageSrc } from './MarkdownLinks'

type MarkdownSanitizeSchema = {
  attributes?: Record<string, unknown[]>
  protocols?: Record<string, string[]>
  [key: string]: unknown
}
type HastNode = {
  type?: unknown
  tagName?: unknown
  properties?: Record<string, unknown>
  children?: HastNode[]
}
type RehypePlugins = NonNullable<StreamdownProps['rehypePlugins']>

function withAttachmentImageProtocol(plugin: unknown): unknown {
  if (!Array.isArray(plugin)) return plugin
  const [attacher, schema, ...rest] = plugin
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return plugin

  const sanitizeSchema = schema as MarkdownSanitizeSchema
  return [
    attacher,
    {
      ...sanitizeSchema,
      attributes: {
        ...sanitizeSchema.attributes,
        code: [...(sanitizeSchema.attributes?.code ?? []), 'metastring']
      },
      protocols: {
        ...sanitizeSchema.protocols,
        href: [...(sanitizeSchema.protocols?.href ?? []), 'file'],
        src: [...(sanitizeSchema.protocols?.src ?? []), 'attachment']
      }
    },
    ...rest
  ]
}

function normalizeLocalFileLinkHrefs(): (tree: HastNode) => void {
  return (tree) => {
    const visit = (node: HastNode) => {
      if (node.type === 'element' && node.tagName === 'a' && node.properties) {
        const href = node.properties.href
        if (typeof href === 'string') {
          const localHref = localHrefFromHref(href)
          if (localHref) node.properties.href = localHref
        }
      }

      for (const child of node.children ?? []) {
        visit(child)
      }
    }

    visit(tree)
  }
}

export const markdownRehypePlugins = [
  defaultRehypePlugins.raw,
  withAttachmentImageProtocol(defaultRehypePlugins.sanitize),
  normalizeLocalFileLinkHrefs,
  defaultRehypePlugins.harden
] as RehypePlugins

export const markdownUrlTransform: UrlTransform = (url, key, node) => {
  if (key === 'href' && node.tagName === 'a' && localPathFromHref(url)) {
    return url
  }

  if (key === 'src' && node.tagName === 'img') {
    const localPath = localPathFromImageSrc(url)
    if (localPath) return `attachment:${localPath}`
  }
  return defaultUrlTransform(url, key, node)
}
