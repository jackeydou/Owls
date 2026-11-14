import { Buffer } from 'node:buffer'

const LINK_ICON_HTML_LIMIT_BYTES = 256 * 1024
const LINK_ICON_IMAGE_LIMIT_BYTES = 256 * 1024
const LINK_ICON_TIMEOUT_MS = 5000

type LinkIconCandidate = {
  url: string
  priority: number
  size: number
}

export function normalizeLinkIconUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https links can have icons.')
  }
  url.hash = ''
  return url
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LINK_ICON_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function readResponseBytes(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()

  const chunks: Uint8Array[] = []
  let total = 0

  while (total < limit) {
    const { done, value } = await reader.read()
    if (done || !value) break

    const remaining = limit - total
    const chunk = value.length > remaining ? value.slice(0, remaining) : value
    chunks.push(chunk)
    total += chunk.length

    if (value.length > remaining) {
      await reader.cancel()
      break
    }
  }

  if (total >= limit) {
    await reader.cancel().catch(() => undefined)
  }

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

async function readResponseText(response: Response, limit: number): Promise<string> {
  const bytes = await readResponseBytes(response, limit)
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const attributePattern = /([^\s"'=<>`]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  for (const match of tag.matchAll(attributePattern)) {
    const name = match[1]?.toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (name) attributes[name] = value.trim()
  }
  return attributes
}

function iconSizeScore(value: string | undefined): number {
  if (!value) return 0
  if (value.toLowerCase() === 'any') return 1024

  let best = 0
  for (const match of value.matchAll(/(\d{1,4})\s*x\s*(\d{1,4})/gi)) {
    const width = Number(match[1])
    const height = Number(match[2])
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue
    best = Math.max(best, Math.min(width, height))
  }
  return best
}

function iconPriority(rel: string): number | null {
  const tokens = new Set(rel.toLowerCase().split(/\s+/).filter(Boolean))
  if (tokens.has('icon')) return 0
  if (tokens.has('apple-touch-icon')) return 1
  if (tokens.has('mask-icon')) return 2
  return null
}

function appendIconCandidate(
  candidates: LinkIconCandidate[],
  pageUrl: URL,
  href: string,
  priority: number,
  size: number
): void {
  try {
    const url = new URL(href, pageUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    url.hash = ''
    candidates.push({ url: url.toString(), priority, size })
  } catch {
    return
  }
}

function extractIconCandidates(html: string, pageUrl: URL): LinkIconCandidate[] {
  const candidates: LinkIconCandidate[] = []
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0])
    const href = attrs.href
    const priority = iconPriority(attrs.rel ?? '')
    if (!href || priority === null) continue
    appendIconCandidate(candidates, pageUrl, href, priority, iconSizeScore(attrs.sizes))
  }

  appendIconCandidate(candidates, pageUrl, '/favicon.ico', 3, 0)

  const seen = new Set<string>()
  return candidates
    .sort((left, right) => left.priority - right.priority || right.size - left.size)
    .filter((candidate) => {
      if (seen.has(candidate.url)) return false
      seen.add(candidate.url)
      return true
    })
}

function mimeTypeFromUrl(url: string): string | null {
  const extension = new URL(url).pathname.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'avif':
      return 'image/avif'
    case 'gif':
      return 'image/gif'
    case 'ico':
      return 'image/x-icon'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'svg':
      return 'image/svg+xml'
    case 'webp':
      return 'image/webp'
    default:
      return null
  }
}

function iconMimeType(response: Response, url: string): string | null {
  const header = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (header.startsWith('image/')) return header
  if (header === 'application/octet-stream') return mimeTypeFromUrl(url) ?? 'image/x-icon'
  return mimeTypeFromUrl(url)
}

async function fetchIconDataUrl(url: string): Promise<string | null> {
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/x-icon,image/*;q=0.8,*/*;q=0.5'
    },
    redirect: 'follow'
  })
  if (!response.ok) return null

  const mimeType = iconMimeType(response, response.url || url)
  if (!mimeType) return null

  const bytes = await readResponseBytes(response, LINK_ICON_IMAGE_LIMIT_BYTES)
  if (bytes.length === 0) return null
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
}

export async function resolveLinkIconDataUrl(value: string): Promise<string | null> {
  const pageUrl = normalizeLinkIconUrl(value)
  const response = await fetchWithTimeout(pageUrl.toString(), {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml'
    },
    redirect: 'follow'
  }).catch(() => null)
  let iconBaseUrl = pageUrl
  if (response?.url) {
    try {
      iconBaseUrl = normalizeLinkIconUrl(response.url)
    } catch {
      iconBaseUrl = pageUrl
    }
  }
  const contentType = response?.headers.get('content-type')?.toLowerCase() ?? ''
  let html = ''
  if (response?.ok && (!contentType || contentType.includes('html'))) {
    html = await readResponseText(response, LINK_ICON_HTML_LIMIT_BYTES)
  }
  const candidates = extractIconCandidates(html, iconBaseUrl)

  for (const candidate of candidates) {
    const dataUrl = await fetchIconDataUrl(candidate.url).catch(() => null)
    if (dataUrl) return dataUrl
  }

  return null
}
