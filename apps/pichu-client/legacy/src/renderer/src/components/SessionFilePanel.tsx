import { copyTextToClipboard } from '@renderer/lib/clipboard'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import {
  getEmbeddedBrowserStateForSession,
  useEmbeddedBrowserStore
} from '@renderer/stores/embedded-browser-store'
import { useSessionStore } from '@renderer/stores/session-store'
import {
  ArrowRightToLine,
  Braces,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  Folders,
  ImageIcon,
  Loader2,
  MoreHorizontal,
  Search,
  WrapText,
  X
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FileTreeEntry } from '../../../preload/index.d'
import { hasLocalHtmlExtension } from '../../../shared/web-targets'
import { localFileIconForPath } from './chat/markdown/local-file-icons'
import { FilePreviewRenderer, isMarkdownPath } from './FilePreviewRenderer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

type FileTreeNode = FileTreeEntry & {
  children: FileTreeNode[]
}

const FILE_TREE_DEFAULT_WIDTH = 300
const FILE_TREE_MIN_WIDTH = 220
const FILE_TREE_MAX_WIDTH = 480
const FILE_PREVIEW_RICH_VIEW_STORAGE_KEY = 'pichu:filePreviewRichView:v1'

function readStoredFilePreviewRichView(): boolean {
  try {
    return localStorage.getItem(FILE_PREVIEW_RICH_VIEW_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function writeStoredFilePreviewRichView(value: boolean): void {
  try {
    localStorage.setItem(FILE_PREVIEW_RICH_VIEW_STORAGE_KEY, value ? 'true' : 'false')
  } catch {
    // Ignore storage failures; the in-memory state still reflects the user's choice.
  }
}

function buildFileTree(entries: FileTreeEntry[]): FileTreeNode[] {
  const root: FileTreeNode = {
    path: '',
    name: '',
    isDirectory: true,
    size: 0,
    modifiedAt: '',
    children: []
  }

  for (const entry of entries) {
    const segments = entry.path.split('/').filter(Boolean)
    let current = root

    for (const [index, segment] of segments.entries()) {
      const path = segments.slice(0, index + 1).join('/')
      const isLeaf = index === segments.length - 1
      let child = current.children.find((node) => node.path === path)

      if (!child) {
        child = {
          path,
          name: segment,
          isDirectory: isLeaf ? entry.isDirectory : true,
          size: isLeaf ? entry.size : 0,
          modifiedAt: isLeaf ? entry.modifiedAt : '',
          children: []
        }
        current.children.push(child)
      }

      if (isLeaf) {
        child.isDirectory = entry.isDirectory
        child.size = entry.size
        child.modifiedAt = entry.modifiedAt
      }

      current = child
    }
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    for (const node of nodes) {
      sortNodes(node.children)
    }
  }

  sortNodes(root.children)
  return root.children
}

function filterFileTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return nodes

  return nodes.flatMap((node) => {
    const children = filterFileTree(node.children, normalizedQuery)
    const matches =
      node.name.toLowerCase().includes(normalizedQuery) ||
      node.path.toLowerCase().includes(normalizedQuery)

    if (!matches && children.length === 0) return []

    return [
      {
        ...node,
        children
      }
    ]
  })
}

function findFirstFilePath(nodes: FileTreeNode[]): string | null {
  for (const node of nodes) {
    if (!node.isDirectory) return node.path
    const childPath = findFirstFilePath(node.children)
    if (childPath) return childPath
  }
  return null
}

function parentDirectoriesForPath(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'))
}

function absoluteFilePath(cwd: string, path: string): string {
  const trimmedCwd = cwd.trim().replace(/\/+$/g, '')
  const trimmedPath = path.trim().replace(/^\/+/g, '')
  if (!trimmedCwd) return trimmedPath
  if (!trimmedPath) return trimmedCwd
  return `${trimmedCwd}/${trimmedPath}`
}

function workspaceFolderName(cwd: string): string | null {
  const segments = cwd.trim().replace(/\\/g, '/').split('/').filter(Boolean)
  return segments.at(-1) ?? null
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function FileBreadcrumb({
  rootLabel,
  selectedPath
}: {
  rootLabel: string
  selectedPath: string | null
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const segments = selectedPath?.split('/').filter(Boolean) ?? []
  const breadcrumbSegments = segments.map((segment, index) => ({
    segment,
    path: segments.slice(0, index + 1).join('/'),
    isLeaf: index === segments.length - 1
  }))
  const scrollKey = `${rootLabel}\0${selectedPath ?? ''}`

  useLayoutEffect(() => {
    if (!scrollKey) return
    const element = scrollRef.current
    if (!element) return
    element.scrollLeft = element.scrollWidth
  }, [scrollKey])

  return (
    <div
      ref={scrollRef}
      className="flex min-w-0 items-center gap-1.5 overflow-x-auto text-[13px] leading-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <span className="shrink-0 font-normal text-muted-foreground">{rootLabel}</span>
      {breadcrumbSegments.map(({ segment, path, isLeaf }) => {
        return (
          <div key={path} className="flex shrink-0 items-center gap-1.5">
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground/70"
              strokeWidth={1.8}
            />
            <span
              className={cn(
                'whitespace-nowrap',
                isLeaf ? 'font-medium text-foreground' : 'font-normal text-muted-foreground'
              )}
            >
              {segment}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function FileTreeEmptyState({
  title,
  description
}: {
  title: string
  description: string
}): React.JSX.Element {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center px-5 py-8 text-center">
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-[190px] text-[12px] leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

function FileTreeItemBase({
  node,
  depth,
  expandedPaths,
  loadingDirectories,
  selectedPath,
  onToggleDirectory,
  onSelectFile
}: {
  node: FileTreeNode
  depth: number
  expandedPaths: Set<string>
  loadingDirectories: Set<string>
  selectedPath: string | null
  onToggleDirectory: (path: string) => void
  onSelectFile: (path: string) => void
}): React.JSX.Element {
  const isExpanded = expandedPaths.has(node.path)
  const isLoading = loadingDirectories.has(node.path)
  const isSelected = selectedPath === node.path

  if (node.isDirectory) {
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggleDirectory(node.path)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition hover:bg-card-muted',
            isSelected && 'bg-card-muted'
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {isLoading ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <ChevronRight
              className={cn('size-3 shrink-0 transition-transform', isExpanded && 'rotate-90')}
              strokeWidth={2}
            />
          )}
          {isExpanded ? (
            <FolderOpen className="size-3.5 shrink-0 text-foreground/70" strokeWidth={1.8} />
          ) : (
            <Folder className="size-3.5 shrink-0 text-foreground/70" strokeWidth={1.8} />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded ? (
          <div>
            {node.children.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                loadingDirectories={loadingDirectories}
                selectedPath={selectedPath}
                onToggleDirectory={onToggleDirectory}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  const { Icon } = localFileIconForPath(node.path)

  return (
    <button
      type="button"
      onClick={() => onSelectFile(node.path)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition hover:bg-card-muted',
        isSelected && 'bg-card-muted text-foreground'
      )}
      style={{ paddingLeft: `${depth * 12 + 24}px` }}
      title={node.path}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.9} />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

const FileTreeItem = memo(FileTreeItemBase)
FileTreeItem.displayName = 'FileTreeItem'

type SessionFilePanelProps = {
  showHeader?: boolean
  className?: string
  onClose?: () => void
}

export function SessionFilePanel({
  showHeader = true,
  className,
  onClose
}: SessionFilePanelProps = {}): React.JSX.Element {
  const { t } = useI18n()
  const sessionId = useSessionStore((state) => state.sessionId)
  const sessionCwd = useSessionStore(
    (state) => state.sessionIndex.find((entry) => entry.sessionId === state.sessionId)?.cwd ?? ''
  )
  const sessionFiles = useSessionStore((state) => state.sessionFiles)
  const sessionFilesLoaded = useSessionStore((state) => state.sessionFilesLoaded)
  const sessionFileLoadedDirectories = useSessionStore(
    (state) => state.sessionFileLoadedDirectories
  )
  const sessionFileLoadingDirectories = useSessionStore(
    (state) => state.sessionFileLoadingDirectories
  )
  const openEmbeddedBrowserUrl = useEmbeddedBrowserStore((state) => state.openUrl)
  const setEmbeddedBrowserError = useEmbeddedBrowserStore((state) => state.setError)
  const fileSelectionRequest = useEmbeddedBrowserStore(
    (state) => getEmbeddedBrowserStateForSession(state).fileSelectionRequest
  )
  const toggleFilePanel = useSessionStore((state) => state.toggleFilePanel)
  const loadSessionFiles = useSessionStore((state) => state.loadSessionFiles)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedExternalPath, setSelectedExternalPath] = useState<string | null>(null)
  const [selectedExternalFileSize, setSelectedExternalFileSize] = useState<number | null>(null)
  const [previewContent, setPreviewContent] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [fileFilter, setFileFilter] = useState('')
  const [fileTreeOpen, setFileTreeOpen] = useState(true)
  const [fileTreeWidth, setFileTreeWidth] = useState(FILE_TREE_DEFAULT_WIDTH)
  const [previewWordWrap, setPreviewWordWrap] = useState(true)
  const [previewRichView, setPreviewRichView] = useState(readStoredFilePreviewRichView)
  const [previewTargetLine, setPreviewTargetLine] = useState<number | null>(null)
  const [previewTargetLineRequestId, setPreviewTargetLineRequestId] = useState<number | null>(null)
  const previewRequestIdRef = useRef(0)
  const handledFileSelectionRequestIdRef = useRef<number | null>(null)
  const directSelectedPathsRef = useRef<Set<string>>(new Set())

  const tree = useMemo(() => buildFileTree(sessionFiles), [sessionFiles])
  const filteredTree = useMemo(() => filterFileTree(tree, fileFilter), [fileFilter, tree])
  const selectedFile = useMemo(
    () => sessionFiles.find((entry) => entry.path === selectedPath),
    [selectedPath, sessionFiles]
  )
  const selectedAbsolutePath = useMemo(() => {
    if (selectedExternalPath) return selectedExternalPath
    if (!selectedPath || !sessionCwd.trim()) return null
    return absoluteFilePath(sessionCwd, selectedPath)
  }, [selectedExternalPath, selectedPath, sessionCwd])
  const selectedPreviewPath = selectedAbsolutePath ?? selectedPath
  const selectedFileSupportsRichView = Boolean(
    selectedPreviewPath && isMarkdownPath(selectedPreviewPath)
  )
  const selectedDisplaySize = selectedFile?.size ?? selectedExternalFileSize ?? 0
  const workspaceRootLabel = useMemo(
    () =>
      selectedExternalPath
        ? t('rightSidebar.files')
        : (workspaceFolderName(sessionCwd) ?? t('rightSidebar.files')),
    [selectedExternalPath, sessionCwd, t]
  )
  const loadedDirectories = useMemo(
    () => new Set(sessionFileLoadedDirectories),
    [sessionFileLoadedDirectories]
  )
  const loadingDirectories = useMemo(
    () => new Set(sessionFileLoadingDirectories),
    [sessionFileLoadingDirectories]
  )

  useEffect(() => {
    if (!sessionId) return
    void loadSessionFiles()
  }, [loadSessionFiles, sessionId])

  useEffect(() => {
    directSelectedPathsRef.current = new Set()

    if (!sessionId) {
      setExpandedPaths(new Set())
      setSelectedPath(null)
      setSelectedExternalPath(null)
      setSelectedExternalFileSize(null)
      setPreviewContent('')
      setPreviewError(null)
      setPreviewTargetLine(null)
      setPreviewTargetLineRequestId(null)
      setFileFilter('')
      return
    }

    setExpandedPaths(new Set())
    setSelectedPath(null)
    setSelectedExternalPath(null)
    setSelectedExternalFileSize(null)
    setPreviewContent('')
    setPreviewError(null)
    setPreviewTargetLine(null)
    setPreviewTargetLineRequestId(null)
    setFileFilter('')
  }, [sessionId])

  useEffect(() => {
    if (!selectedPath) return
    if (selectedExternalPath) return
    if (directSelectedPathsRef.current.has(selectedPath)) return
    const exists = sessionFiles.some((entry) => !entry.isDirectory && entry.path === selectedPath)
    if (!exists) {
      setSelectedPath(null)
      setSelectedExternalPath(null)
      setSelectedExternalFileSize(null)
      setPreviewContent('')
      setPreviewError(null)
      setPreviewTargetLine(null)
      setPreviewTargetLineRequestId(null)
    }
  }, [selectedExternalPath, selectedPath, sessionFiles])

  const handleToggleDirectory = useCallback(
    (path: string) => {
      const isExpanded = expandedPaths.has(path)
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
          return next
        }

        next.add(path)
        return next
      })

      if (!isExpanded && !loadedDirectories.has(path) && !loadingDirectories.has(path)) {
        void loadSessionFiles(path)
      }
    },
    [expandedPaths, loadSessionFiles, loadedDirectories, loadingDirectories]
  )

  const handleSelectFile = useCallback(
    async (
      path: string,
      options?: {
        absolutePath?: string | null
        openHtmlInBrowser?: boolean
        targetLine?: number | null
      }
    ) => {
      if (!sessionId) return

      const requestId = previewRequestIdRef.current + 1
      previewRequestIdRef.current = requestId
      const targetLine = options?.targetLine ?? null
      const absolutePath = options?.absolutePath?.trim() || null
      setPreviewTargetLine(targetLine)
      setPreviewTargetLineRequestId(targetLine ? requestId : null)

      if (!absolutePath && hasLocalHtmlExtension(path) && options?.openHtmlInBrowser !== false) {
        setSelectedPath(path)
        setSelectedExternalPath(null)
        setSelectedExternalFileSize(null)
        setPreviewContent('')
        setPreviewLoading(false)
        setPreviewError(null)
        try {
          const url = await window.api.agent.sessionFileUrl(sessionId, path)
          if (previewRequestIdRef.current !== requestId) return
          const sessionKey = openEmbeddedBrowserUrl(url, sessionId)
          void window.api.embeddedBrowser.open({ sessionKey, url }).catch((error) => {
            setEmbeddedBrowserError(
              error instanceof Error ? error.message : String(error),
              sessionKey
            )
          })
        } catch (error) {
          if (previewRequestIdRef.current !== requestId) return
          setPreviewContent('')
          setPreviewError(error instanceof Error ? error.message : String(error))
          setPreviewLoading(false)
        }
        return
      }

      setSelectedPath(path)
      setSelectedExternalPath(absolutePath)
      setSelectedExternalFileSize(null)
      setPreviewLoading(true)
      setPreviewError(null)

      try {
        if (absolutePath) {
          const [attachment, content] = await Promise.all([
            window.api.attachments.statPaths([{ path: absolutePath }]),
            window.api.attachments.readTextFile(absolutePath)
          ])
          if (previewRequestIdRef.current !== requestId) return
          setSelectedExternalFileSize(attachment[0]?.size ?? null)
          setPreviewContent(content)
          return
        }

        const content = await window.api.agent.readSessionFile(sessionId, path)
        if (previewRequestIdRef.current !== requestId) return
        setPreviewContent(content)
      } catch (error) {
        if (previewRequestIdRef.current !== requestId) return
        const message = error instanceof Error ? error.message : String(error)
        setPreviewContent('')
        setPreviewError(message)
      } finally {
        if (previewRequestIdRef.current === requestId) {
          setPreviewLoading(false)
        }
      }
    },
    [openEmbeddedBrowserUrl, sessionId, setEmbeddedBrowserError]
  )

  const copySelectedPath = useCallback(() => {
    if (!selectedAbsolutePath) return
    void copyTextToClipboard(selectedAbsolutePath).catch(console.error)
  }, [selectedAbsolutePath])

  const revealSelectedFile = useCallback(() => {
    if (!selectedAbsolutePath) return
    void window.api.attachments.reveal(selectedAbsolutePath).catch(console.error)
  }, [selectedAbsolutePath])

  const copySelectedFileContents = useCallback(() => {
    if (!selectedPreviewPath || previewLoading || previewError) return
    void copyTextToClipboard(previewContent).catch(console.error)
  }, [previewContent, previewError, previewLoading, selectedPreviewPath])

  const togglePreviewRichView = useCallback(() => {
    setPreviewRichView((value) => {
      const nextValue = !value
      writeStoredFilePreviewRichView(nextValue)
      return nextValue
    })
  }, [])

  useEffect(() => {
    const request = fileSelectionRequest
    if (!request || !sessionId) return
    if (handledFileSelectionRequestIdRef.current === request.requestId) return

    let cancelled = false
    void (async () => {
      const parentDirectories = request.absolutePath ? [] : parentDirectoriesForPath(request.path)
      directSelectedPathsRef.current.add(request.path)
      setFileFilter('')
      setFileTreeOpen(true)
      setExpandedPaths((previous) => new Set([...previous, ...parentDirectories]))
      await handleSelectFile(request.path, {
        absolutePath: request.absolutePath,
        openHtmlInBrowser: false,
        targetLine: request.targetLine
      })
      handledFileSelectionRequestIdRef.current = request.requestId
      if (cancelled) return

      if (request.absolutePath) return

      const initialState = useSessionStore.getState()
      if (!initialState.sessionFilesLoaded) {
        await initialState.loadSessionFiles()
      }

      for (const directory of parentDirectories) {
        const latestState = useSessionStore.getState()
        if (latestState.sessionId !== sessionId) return
        if (latestState.sessionFileLoadedDirectories.includes(directory)) {
          continue
        }
        await latestState.loadSessionFiles(directory)
      }

      if (cancelled) return
    })().catch(console.error)

    return () => {
      cancelled = true
    }
  }, [fileSelectionRequest, handleSelectFile, sessionId])

  const startFileTreeResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = fileTreeWidth
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = startX - moveEvent.clientX
        const nextWidth = Math.min(
          FILE_TREE_MAX_WIDTH,
          Math.max(FILE_TREE_MIN_WIDTH, startWidth + delta)
        )
        setFileTreeWidth(nextWidth)
      }

      const handlePointerUp = () => {
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp, { once: true })
    },
    [fileTreeWidth]
  )

  useEffect(() => {
    if (!sessionId || !sessionFilesLoaded || selectedPath || fileSelectionRequest) return
    const firstFilePath = findFirstFilePath(tree)
    if (firstFilePath) {
      void handleSelectFile(firstFilePath, { openHtmlInBrowser: false })
    }
  }, [fileSelectionRequest, handleSelectFile, selectedPath, sessionFilesLoaded, sessionId, tree])

  const closePanel = onClose ?? toggleFilePanel
  const renderTreeContent = (nodes: FileTreeNode[]): React.JSX.Element => {
    if (!sessionId) {
      return (
        <FileTreeEmptyState
          title={t('rightSidebar.fileTreeNoSessionTitle')}
          description={t('rightSidebar.noSessionFiles')}
        />
      )
    }

    if (!sessionFilesLoaded) {
      return (
        <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('rightSidebar.loadingFiles')}
        </div>
      )
    }

    if (sessionFiles.length === 0) {
      return (
        <FileTreeEmptyState
          title={t('rightSidebar.fileTreeEmptyTitle')}
          description={t('rightSidebar.emptySessionFiles')}
        />
      )
    }

    if (nodes.length === 0) {
      return (
        <FileTreeEmptyState
          title={t('rightSidebar.noMatchingFiles')}
          description={t('rightSidebar.fileTreeNoMatchesDescription')}
        />
      )
    }

    return (
      <>
        {nodes.map((node) => (
          <FileTreeItem
            key={node.path}
            node={node}
            depth={0}
            expandedPaths={expandedPaths}
            loadingDirectories={loadingDirectories}
            selectedPath={selectedPath}
            onToggleDirectory={handleToggleDirectory}
            onSelectFile={handleSelectFile}
          />
        ))}
      </>
    )
  }

  return (
    <aside
      className={cn(
        'flex min-h-0 w-full shrink-0 flex-col bg-card',
        showHeader && 'border-l border-border',
        className
      )}
    >
      {showHeader ? (
        <div className="drag-region relative flex items-center justify-between border-b border-border px-4 py-3">
          <div className="no-drag absolute inset-y-0 right-0 w-20" aria-hidden="true" />
          <div className="flex items-center gap-2">
            <Folders className="size-4 text-foreground/70" strokeWidth={1.8} />
            <div>
              <p className="text-[13px] font-medium text-foreground">
                {t('rightSidebar.sessionFiles')}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {sessionFiles.length === 0
                  ? t('rightSidebar.noSavedFiles')
                  : t('rightSidebar.itemCount', { count: sessionFiles.length })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closePanel}
            className="rounded-md p-1 text-muted-foreground transition hover:bg-card-muted hover:text-foreground"
            aria-label={t('rightSidebar.closeFilesPanel')}
          >
            <X className="size-4" strokeWidth={1.8} />
          </button>
        </div>
      ) : null}

      {showHeader ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-[0.9] overflow-y-auto border-b border-border px-2 py-2">
            {renderTreeContent(tree)}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-border px-4 py-2">
              <p className="truncate text-[12px] font-medium text-foreground">
                {selectedPreviewPath || t('rightSidebar.preview')}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              {selectedPreviewPath ? (
                previewLoading ? (
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t('rightSidebar.loadingPreview')}
                  </div>
                ) : previewError ? (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-[12px] text-destructive">
                    {previewError}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="truncate">{selectedPreviewPath}</span>
                      <span className="shrink-0">{formatFileSize(selectedDisplaySize)}</span>
                    </div>
                    <div
                      className="max-h-80 overflow-auto rounded-lg border border-border bg-card"
                      data-file-preview-scroll-container="true"
                    >
                      <FilePreviewRenderer
                        path={selectedPreviewPath}
                        content={previewContent}
                        wordWrap={previewWordWrap}
                        richView={previewRichView}
                        targetLine={previewTargetLine}
                        targetLineRequestId={previewTargetLineRequestId}
                      />
                    </div>
                  </div>
                )
              ) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-[12px] leading-relaxed text-muted-foreground">
                  {t('rightSidebar.selectFilePreview')}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/60 pr-2 pl-3">
            <FileBreadcrumb rootLabel={workspaceRootLabel} selectedPath={selectedPreviewPath} />
            <div className="flex shrink-0 items-center gap-1">
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        disabled={!selectedPreviewPath}
                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                        aria-label={t('rightSidebar.filePreviewActions')}
                      >
                        <MoreHorizontal className="size-4" strokeWidth={1.8} />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t('rightSidebar.filePreviewActions')}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" side="bottom" className="w-56">
                  <DropdownMenuItem disabled={!selectedPreviewPath} onSelect={copySelectedPath}>
                    <Copy className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
                    <span>{t('rightSidebar.copyFilePath')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!selectedPreviewPath || previewLoading || Boolean(previewError)}
                    onSelect={copySelectedFileContents}
                  >
                    <Copy className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.7} />
                    <span>{t('rightSidebar.copyFileContents')}</span>
                  </DropdownMenuItem>
                  {selectedFileSupportsRichView ? (
                    <DropdownMenuItem onSelect={togglePreviewRichView}>
                      {previewRichView ? (
                        <Braces
                          className="size-3.5 shrink-0 text-muted-foreground"
                          strokeWidth={1.7}
                        />
                      ) : (
                        <ImageIcon
                          className="size-3.5 shrink-0 text-muted-foreground"
                          strokeWidth={1.7}
                        />
                      )}
                      <span>
                        {previewRichView
                          ? t('rightSidebar.disableRichView')
                          : t('rightSidebar.enableRichView')}
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                  {!selectedFileSupportsRichView || !previewRichView ? (
                    <DropdownMenuItem onSelect={() => setPreviewWordWrap((value) => !value)}>
                      {previewWordWrap ? (
                        <ArrowRightToLine
                          className="size-3.5 shrink-0 text-muted-foreground"
                          strokeWidth={1.7}
                        />
                      ) : (
                        <WrapText
                          className="size-3.5 shrink-0 text-muted-foreground"
                          strokeWidth={1.7}
                        />
                      )}
                      <span>
                        {previewWordWrap
                          ? t('rightSidebar.disableWordWrap')
                          : t('rightSidebar.enableWordWrap')}
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={!selectedAbsolutePath}
                    onClick={revealSelectedFile}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                    aria-label={t('nav.context.openFinder')}
                  >
                    <FolderOpen className="size-4" strokeWidth={1.8} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('nav.context.openFinder')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setFileTreeOpen((open) => !open)}
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground',
                      fileTreeOpen && 'bg-sidebar-hover text-foreground'
                    )}
                    aria-label={
                      fileTreeOpen ? t('rightSidebar.hideFileTree') : t('rightSidebar.showFileTree')
                    }
                    aria-pressed={fileTreeOpen}
                  >
                    <Folders className="size-4" strokeWidth={1.8} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {fileTreeOpen ? t('rightSidebar.hideFileTree') : t('rightSidebar.showFileTree')}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col bg-card">
              <div className="min-h-0 flex-1 overflow-hidden">
                {selectedPreviewPath ? (
                  previewLoading ? (
                    <div className="flex h-full items-center justify-center gap-2 text-[12px] text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      {t('rightSidebar.loadingPreview')}
                    </div>
                  ) : previewError ? (
                    <div className="flex h-full items-center justify-center px-6">
                      <div className="max-w-md rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-[12px] text-destructive">
                        {previewError}
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-0 flex-col">
                      <div
                        className="min-h-0 flex-1 overflow-auto bg-card"
                        data-file-preview-scroll-container="true"
                      >
                        <FilePreviewRenderer
                          path={selectedPreviewPath}
                          content={previewContent}
                          wordWrap={previewWordWrap}
                          richView={previewRichView}
                          targetLine={previewTargetLine}
                          targetLineRequestId={previewTargetLineRequestId}
                        />
                      </div>
                    </div>
                  )
                ) : (
                  <div className="flex h-full items-center justify-center px-6 py-8">
                    <div className="flex flex-col items-center text-center">
                      <Folders className="mb-4 size-7 text-muted-foreground" strokeWidth={1.7} />
                      <p className="text-[14px] font-semibold text-foreground">
                        {t('rightSidebar.openFile')}
                      </p>
                      <p className="mt-2 text-[12px] font-medium text-muted-foreground">
                        {t('rightSidebar.selectWorkspaceFilePreview')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <AnimatePresence initial={false}>
              {fileTreeOpen ? (
                <motion.aside
                  key="file-tree"
                  initial={{ width: 0, opacity: 0, x: 12 }}
                  animate={{ width: fileTreeWidth, opacity: 1, x: 0 }}
                  exit={{ width: 0, opacity: 0, x: 12 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="relative flex shrink-0 flex-col overflow-hidden border-l border-border/70 bg-card"
                >
                  <button
                    type="button"
                    aria-label={t('rightSidebar.resizeFileTree')}
                    onPointerDown={startFileTreeResize}
                    className="no-drag absolute top-0 left-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition hover:bg-border-strong/50"
                  />
                  <div className="shrink-0 px-2 pt-2 pb-1" style={{ width: `${fileTreeWidth}px` }}>
                    <label className="sr-only" htmlFor="session-file-filter">
                      {t('rightSidebar.filterFiles')}
                    </label>
                    <div className="relative">
                      <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                      <input
                        id="session-file-filter"
                        value={fileFilter}
                        onChange={(event) => setFileFilter(event.target.value)}
                        placeholder={t('rightSidebar.filterFiles')}
                        className="h-8 w-full rounded-lg border border-border/65 bg-background pr-3 pl-8 text-[12px] text-foreground outline-none transition placeholder:text-muted-foreground/65 focus:border-border-strong focus:ring-1 focus:ring-border-strong"
                      />
                    </div>
                  </div>
                  <div
                    className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
                    style={{ width: `${fileTreeWidth}px` }}
                  >
                    {renderTreeContent(filteredTree)}
                  </div>
                </motion.aside>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      )}
    </aside>
  )
}
