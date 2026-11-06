const LOCAL_HTML_EXTENSIONS = ['.html', '.htm']
const LOCAL_FILE_LIKE_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.doc',
  '.docx',
  '.gif',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.pdf',
  '.png',
  '.ppt',
  '.pptx',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.xls',
  '.xlsx',
  '.xml',
  '.yaml',
  '.yml',
  '.zip'
])
const URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i
const HTTP_URL_PATTERN = /^https?:\/\//i

export function hasLocalHtmlExtension(value: string): boolean {
  const normalized = value.split(/[?#]/, 1)[0]?.toLowerCase() ?? ''
  return LOCAL_HTML_EXTENSIONS.some((extension) => normalized.endsWith(extension))
}

function fileExtension(value: string): string {
  const normalized = value.split(/[?#]/, 1)[0]?.toLowerCase() ?? ''
  const filename = normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized
  const index = filename.lastIndexOf('.')
  return index <= 0 ? '' : filename.slice(index)
}

function decodeFileUrlPath(value: string): string | null {
  try {
    return decodeURIComponent(new URL(value).pathname)
  } catch {
    return null
  }
}

function normalizeLocalHtmlPath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || !hasLocalHtmlExtension(trimmed)) return null
  if ((!trimmed.startsWith('/') || trimmed.startsWith('//')) && !/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return null
  }
  const path = trimmed.replace(/\\/g, '/')
  const absolutePath = path.startsWith('/') ? path : `/${path}`
  return new URL(`file://${absolutePath}`).toString()
}

function isAbsoluteLocalPath(value: string): boolean {
  return (value.startsWith('/') && !value.startsWith('//')) || /^[A-Za-z]:[\\/]/.test(value)
}

function isLikelyIpv4Host(value: string): boolean {
  const parts = value.split('.')
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false
      const octet = Number(part)
      return octet >= 0 && octet <= 255
    })
  )
}

function hasLikelyDomainLabels(value: string): boolean {
  if (!value.includes('.') || value.startsWith('.') || value.endsWith('.')) return false
  if (LOCAL_FILE_LIKE_EXTENSIONS.has(fileExtension(value))) return false
  return value.split('.').every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
}

function isLikelyBareWebTarget(value: string): boolean {
  const candidate = value.startsWith('//') ? value.slice(2) : value
  if (!candidate || /\s/.test(candidate) || /^[.#?]/.test(candidate)) return false
  const hostAndPort = candidate.split(/[/?#]/, 1)[0]
  if (!hostAndPort || hostAndPort.includes('@')) return false

  if (hostAndPort.startsWith('[')) {
    return /^\[[0-9a-f:.]+\](?::\d+)?$/i.test(hostAndPort)
  }

  const [host, maybePort, extra] = hostAndPort.split(':')
  if (!host || extra !== undefined) return false
  const hasPort = maybePort !== undefined
  if (hasPort && !/^\d+$/.test(maybePort)) return false

  if (host.toLowerCase() === 'localhost') return true
  if (isLikelyIpv4Host(host)) return true
  if (hasLikelyDomainLabels(host)) return true
  return hasPort && /^[a-z\d-]+$/i.test(host)
}

function bareWebTargetPrefersHttp(value: string): boolean {
  const candidate = value.startsWith('//') ? value.slice(2) : value
  const hostAndPort = candidate.split(/[/?#]/, 1)[0]
  if (!hostAndPort) return false

  if (hostAndPort.startsWith('[')) {
    const host = hostAndPort.slice(1, hostAndPort.indexOf(']')).toLowerCase()
    return host === '::1'
  }

  const host = hostAndPort.split(':', 1)[0]?.toLowerCase() ?? ''
  return host === 'localhost' || host.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/.test(host)
}

function hasUrlCredentials(url: URL): boolean {
  return url.username.length > 0 || url.password.length > 0
}

export function normalizeWebTargetUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed === 'about:blank') return trimmed

  if (trimmed.startsWith('file://')) {
    const path = decodeFileUrlPath(trimmed)
    if (!path || !hasLocalHtmlExtension(path)) return null
    try {
      return new URL(trimmed).toString()
    } catch {
      return null
    }
  }

  const localHtml = normalizeLocalHtmlPath(trimmed)
  if (localHtml) return localHtml
  if (isAbsoluteLocalPath(trimmed)) return null

  if (HTTP_URL_PATTERN.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (hasUrlCredentials(url)) return null
      return url.toString()
    } catch {
      return null
    }
  }

  if (!isLikelyBareWebTarget(trimmed)) return null
  if (URL_SCHEME_PATTERN.test(trimmed) && !/^[^:/?#]+:\d+(?:[/?#]|$)/.test(trimmed)) {
    return null
  }

  const scheme = bareWebTargetPrefersHttp(trimmed) ? 'http' : 'https'
  const withScheme = trimmed.startsWith('//') ? `${scheme}:${trimmed}` : `${scheme}://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (hasUrlCredentials(url)) return null
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function isWebTargetUrl(value: string): boolean {
  return normalizeWebTargetUrl(value) !== null
}
