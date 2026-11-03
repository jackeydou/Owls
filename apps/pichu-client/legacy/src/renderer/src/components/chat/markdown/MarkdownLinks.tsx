import { cn } from '@renderer/lib/utils'
import { useEmbeddedBrowserStore } from '@renderer/stores/embedded-browser-store'
import { useSessionStore } from '@renderer/stores/session-store'
import {
  type ComponentPropsWithoutRef,
  createContext,
  useContext,
  useEffect,
  useState
} from 'react'
import { normalizeWebTargetUrl } from '../../../../../shared/web-targets'
import { localDirectoryIconForPath, localFileIconForPath } from './local-file-icons'

type MarkdownAnchorProps = ComponentPropsWithoutRef<'a'> & {
  node?: unknown
}
type MarkdownInlineCodeProps = ComponentPropsWithoutRef<'code'> & {
  node?: unknown
}

const MarkdownLinkTextContext = createContext(false)
const localFileLineFragmentPattern = /#(?:L\d+(?:-L?\d+)?|line-\d+)$/i

function decodeLocalPath(path: string): string {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

function stripLocalPathFragment(path: string): string {
  return path.replace(localFileLineFragmentPattern, '')
}

function localPathLineFragment(href: string): number | null {
  const match = href.match(localFileLineFragmentPattern)
  if (!match) return null
  const lineMatch = match[0].match(/\d+/)
  if (!lineMatch) return null
  const line = Number(lineMatch[0])
  return Number.isSafeInteger(line) && line > 0 ? line : null
}

export function localHrefFromHref(href: string): string | null {
  const localPath = localPathFromHref(href)
  if (!localPath) return null

  const targetLine = localPathLineFragment(href)
  return targetLine ? `${localPath}#L${targetLine}` : localPath
}

export function localPathFromHref(href: string): string | null {
  if (href.startsWith('/') && !href.startsWith('//')) {
    return decodeLocalPath(stripLocalPathFragment(href))
  }
  if (/^[A-Za-z]:[\\/]/.test(href)) return decodeLocalPath(stripLocalPathFragment(href))

  if (!href.startsWith('file://')) return null
  try {
    return decodeLocalPath(new URL(href).pathname)
  } catch {
    return null
  }
}

export function isWebHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

export function localPathFromAttachmentSrc(src: string): string | null {
  if (!src.startsWith('attachment:')) return null

  const rawPath = src.slice('attachment:'.length)
  const path = rawPath.startsWith('///') ? rawPath.slice(2) : rawPath
  if (!path.startsWith('/')) return null
  return decodeLocalPath(path)
}

export function localPathFromImageSrc(src: string): string | null {
  return localPathFromAttachmentSrc(src) ?? localPathFromHref(src)
}

function normalizeFileSystemPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/g, '')
}

function isAbsoluteLocalPath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

function workspaceRelativePathFromLinkPath(path: string): string | null {
  if (
    !path ||
    isAbsoluteLocalPath(path) ||
    path.startsWith('file://') ||
    /^[a-z][a-z0-9+.-]*:/i.test(path)
  ) {
    return null
  }

  const segments: string[] = []
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.length > 0 ? segments.join('/') : null
}

function joinWorkspacePath(workspacePath: string, relativePath: string): string {
  return `${normalizeFileSystemPath(workspacePath)}/${relativePath}`
}

function workspaceRelativePathForLocalPath(
  localPath: string,
  workspacePath: string
): string | null {
  const relativePath = workspaceRelativePathFromLinkPath(localPath)
  if (relativePath) return relativePath

  const normalizedWorkspacePath = normalizeFileSystemPath(workspacePath)
  const normalizedLocalPath = normalizeFileSystemPath(localPath)
  if (!normalizedWorkspacePath || normalizedLocalPath === normalizedWorkspacePath) return null
  if (!normalizedLocalPath.startsWith(`${normalizedWorkspacePath}/`)) return null
  return normalizedLocalPath.slice(normalizedWorkspacePath.length + 1)
}

function parentDirectoryForRelativePath(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

async function workspaceLocalPathKind(localPath: string): Promise<'file' | 'directory' | null> {
  const sessionState = useSessionStore.getState()
  const sessionId = sessionState.sessionId
  const cwd = sessionState.sessionIndex.find((entry) => entry.sessionId === sessionId)?.cwd
  if (!sessionId || !cwd) return null

  const normalizedCwd = normalizeFileSystemPath(cwd)
  const normalizedLocalPath = normalizeFileSystemPath(localPath)
  if (normalizedLocalPath === normalizedCwd) return 'directory'

  const relativePath = workspaceRelativePathForLocalPath(localPath, cwd)
  if (!relativePath) return null

  const parentDirectory = parentDirectoryForRelativePath(relativePath)
  if (!sessionState.sessionFileLoadedDirectories.includes(parentDirectory)) {
    await sessionState.loadSessionFiles(parentDirectory)
  }
  const latestSessionState = useSessionStore.getState()
  if (latestSessionState.sessionId !== sessionId) return null

  const entry = latestSessionState.sessionFiles.find((item) => item.path === relativePath)
  if (!entry) return null
  return entry.isDirectory ? 'directory' : 'file'
}

async function workspaceFilePathForLocalPath(
  localPath: string
): Promise<{ absolutePath: string; relativePath: string; sessionId: string } | null> {
  const sessionState = useSessionStore.getState()
  const sessionId = sessionState.sessionId
  const cwd = sessionState.sessionIndex.find((entry) => entry.sessionId === sessionId)?.cwd
  if (!sessionId || !cwd) return null

  const relativePath = workspaceRelativePathForLocalPath(localPath, cwd)
  if (!relativePath) return null
  const absolutePath = isAbsoluteLocalPath(localPath)
    ? normalizeFileSystemPath(localPath)
    : joinWorkspacePath(cwd, relativePath)
  return { absolutePath, relativePath, sessionId }
}

async function requestWorkspaceFileSelection(
  localPath: string,
  targetLine: number | null
): Promise<boolean> {
  const sessionId = useSessionStore.getState().sessionId
  if (!sessionId) return false

  const filePath = await workspaceFilePathForLocalPath(localPath)
  const absolutePath =
    filePath?.absolutePath ?? normalizeFileSystemPath(localPathForFileOperation(localPath))
  const [attachment] = await window.api.attachments.statPaths([{ path: absolutePath }])
  if (normalizeFileSystemPath(attachment?.path ?? '') !== absolutePath) return false

  if (!filePath) {
    useEmbeddedBrowserStore
      .getState()
      .requestFileSelection(absolutePath, sessionId, targetLine, absolutePath)
    return true
  }

  useEmbeddedBrowserStore
    .getState()
    .requestFileSelection(filePath.relativePath, filePath.sessionId, targetLine)
  return true
}

function localPathForFileOperation(localPath: string): string {
  if (isAbsoluteLocalPath(localPath)) return localPath

  const sessionState = useSessionStore.getState()
  const sessionId = sessionState.sessionId
  const cwd = sessionState.sessionIndex.find((entry) => entry.sessionId === sessionId)?.cwd
  const relativePath = workspaceRelativePathFromLinkPath(localPath)
  if (!cwd || !relativePath) return localPath

  return joinWorkspacePath(cwd, relativePath)
}

export async function openLocalFileLinkTarget({
  href,
  localPath,
  action = 'reveal'
}: {
  href?: string
  localPath: string
  action?: 'open' | 'reveal'
}): Promise<void> {
  const targetLine = href ? localPathLineFragment(href) : null
  if (await requestWorkspaceFileSelection(localPath, targetLine)) return

  const browserUrl = href ? normalizeWebTargetUrl(href) : null
  if (browserUrl?.startsWith('file://')) {
    await window.api.embeddedBrowser.open(browserUrl)
    return
  }

  const operation = action === 'open' ? window.api.attachments.open : window.api.attachments.reveal
  await operation(localPathForFileOperation(localPath))
}

export function MarkdownLocalFileLink({
  href,
  localPath,
  children,
  className,
  action = 'reveal',
  onClick,
  ...props
}: ComponentPropsWithoutRef<'a'> & {
  localPath: string
  action?: 'open' | 'reveal'
}): React.JSX.Element {
  const [localPathKind, setLocalPathKind] = useState<'file' | 'directory' | null>(null)
  const { Icon, kind } =
    localPathKind === 'directory' ? localDirectoryIconForPath() : localFileIconForPath(localPath)

  useEffect(() => {
    let cancelled = false
    setLocalPathKind(null)

    void workspaceLocalPathKind(localPath)
      .then((kind) => {
        if (!cancelled) setLocalPathKind(kind)
      })
      .catch((error: unknown) => {
        console.error('Failed to resolve markdown local path kind', error)
        if (!cancelled) setLocalPathKind(null)
      })

    return () => {
      cancelled = true
    }
  }, [localPath])

  return (
    <a
      href={href}
      className={cn('pichu-markdown-local-file-link', className)}
      data-pichu-file-kind={kind}
      data-pichu-local-file="true"
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        event.preventDefault()
        void openLocalFileLinkTarget({ href, localPath, action }).catch(console.error)
      }}
      {...props}
    >
      <Icon className="pichu-markdown-local-file-icon" strokeWidth={1.9} aria-hidden />
      {children}
    </a>
  )
}

export function MarkdownLink({
  href,
  children,
  className,
  node: _node,
  ...props
}: MarkdownAnchorProps): React.JSX.Element {
  const rawHref = typeof href === 'string' ? href : ''
  const localPath = localPathFromHref(rawHref)

  if (!localPath && !isWebHref(rawHref)) {
    return (
      <a href={href} className={className} {...props}>
        <MarkdownLinkTextContext.Provider value={true}>{children}</MarkdownLinkTextContext.Provider>
      </a>
    )
  }

  if (!localPath) {
    return (
      <a
        href={href}
        className={cn('pichu-markdown-web-link', className)}
        data-pichu-web-link="true"
        {...props}
      >
        <MarkdownWebLinkIcon href={rawHref} />
        <MarkdownLinkTextContext.Provider value={true}>{children}</MarkdownLinkTextContext.Provider>
      </a>
    )
  }

  return (
    <MarkdownLocalFileLink href={rawHref} localPath={localPath} className={className} {...props}>
      <MarkdownLinkTextContext.Provider value={true}>{children}</MarkdownLinkTextContext.Provider>
    </MarkdownLocalFileLink>
  )
}

export function MarkdownInlineCode({
  children,
  className,
  node: _node,
  ...props
}: MarkdownInlineCodeProps): React.JSX.Element {
  const insideMarkdownLink = useContext(MarkdownLinkTextContext)
  const text = typeof children === 'string' ? children.trim() : ''
  const localPath =
    !insideMarkdownLink && text && !text.includes('\n') ? localPathFromHref(text) : null
  const [verifiedPath, setVerifiedPath] = useState<string | null>(null)

  useEffect(() => {
    if (!localPath) {
      setVerifiedPath(null)
      return
    }

    let cancelled = false
    setVerifiedPath(null)

    void window.api.attachments
      .statPaths([{ path: localPath }])
      .then(([attachment]) => {
        if (!cancelled) setVerifiedPath(attachment?.path === localPath ? localPath : null)
      })
      .catch((error: unknown) => {
        console.error('Failed to resolve markdown inline file path', error)
        if (!cancelled) setVerifiedPath(null)
      })

    return () => {
      cancelled = true
    }
  }, [localPath])

  if (insideMarkdownLink) {
    return <>{children}</>
  }

  if (verifiedPath) {
    return (
      <MarkdownLocalFileLink href={verifiedPath} localPath={verifiedPath}>
        {children}
      </MarkdownLocalFileLink>
    )
  }

  return (
    <code className={className} {...props}>
      {children}
    </code>
  )
}

export function MarkdownWebLinkIcon({ href }: { href: string }): React.JSX.Element {
  const [loadedIconDataUrl, setLoadedIconDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadedIconDataUrl(null)

    void window.api.app
      .resolveLinkIcon(href)
      .then((dataUrl) => {
        if (cancelled || !dataUrl) return

        const image = new Image()
        image.onload = () => {
          if (!cancelled) setLoadedIconDataUrl(dataUrl)
        }
        image.src = dataUrl
      })
      .catch((error: unknown) => {
        console.error('Failed to resolve markdown link icon', error)
      })

    return () => {
      cancelled = true
    }
  }, [href])

  if (loadedIconDataUrl) {
    return (
      <img
        src={loadedIconDataUrl}
        alt=""
        className="pichu-markdown-web-link-icon"
        draggable={false}
        aria-hidden
        onError={() => setLoadedIconDataUrl(null)}
      />
    )
  }

  return <span className="pichu-markdown-web-link-icon pichu-markdown-web-link-fallback-icon" />
}
