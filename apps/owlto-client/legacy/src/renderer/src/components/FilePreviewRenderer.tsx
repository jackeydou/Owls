import { MarkdownRenderer } from '@renderer/components/chat/MarkdownRenderer'
import { useI18n } from '@renderer/lib/i18n'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type BundledLanguage, codeToTokens, type ThemedToken } from 'shiki'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])

const CODE_LANGUAGE_BY_EXTENSION: Record<string, BundledLanguage> = {
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  go: 'go',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  jsx: 'jsx',
  kt: 'kotlin',
  less: 'less',
  lua: 'lua',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',
  mjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml'
}

type ShikiRenderState =
  | { status: 'loading' }
  | { status: 'ready'; lines: ThemedToken[][] }
  | { status: 'error'; message: string }

type ResolvedTheme = 'light' | 'dark'

function currentResolvedTheme(): ResolvedTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(() => currentResolvedTheme())

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(currentResolvedTheme())
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => observer.disconnect()
  }, [])

  return theme
}

function extensionForPath(path: string): string {
  const fileName = path.split('/').pop() ?? path
  const extension = fileName.includes('.') ? fileName.split('.').pop() : ''
  return extension?.toLowerCase() ?? ''
}

function languageForPath(path: string): BundledLanguage {
  const extension = extensionForPath(path)
  return CODE_LANGUAGE_BY_EXTENSION[extension] ?? 'text'
}

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionForPath(path))
}

function ShikiCodePreview({
  path,
  content,
  wordWrap,
  targetLine,
  targetLineRequestId
}: {
  path: string
  content: string
  wordWrap: boolean
  targetLine: number | null
  targetLineRequestId: number | null
}): React.JSX.Element {
  const { t } = useI18n()
  const language = useMemo(() => languageForPath(path), [path])
  const resolvedTheme = useResolvedTheme()
  const previewRef = useRef<HTMLDivElement | null>(null)
  const [renderState, setRenderState] = useState<ShikiRenderState>({ status: 'loading' })
  const targetScrollKey = targetLine ? `${targetLine}:${targetLineRequestId ?? ''}` : ''

  useEffect(() => {
    let cancelled = false
    setRenderState({ status: 'loading' })

    void codeToTokens(content, {
      lang: language,
      theme: resolvedTheme === 'dark' ? 'github-dark' : 'github-light'
    })
      .then((result) => {
        if (!cancelled) setRenderState({ status: 'ready', lines: result.tokens })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRenderState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [content, language, resolvedTheme])

  useEffect(() => {
    if (renderState.status !== 'ready' || !targetLine || !targetScrollKey) return

    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const lineElement = previewRef.current?.querySelector<HTMLElement>(
          `[data-file-preview-line="${targetLine}"]`
        )
        const scrollContainer = previewRef.current?.closest<HTMLElement>(
          '[data-file-preview-scroll-container="true"]'
        )
        if (!lineElement || !scrollContainer) return

        const lineRect = lineElement.getBoundingClientRect()
        const containerRect = scrollContainer.getBoundingClientRect()
        const nextScrollTop =
          scrollContainer.scrollTop +
          lineRect.top -
          containerRect.top -
          scrollContainer.clientHeight / 2 +
          lineRect.height / 2

        scrollContainer.scrollTo({ top: Math.max(0, nextScrollTop) })
      })
    })

    return () => cancelAnimationFrame(frame)
  }, [renderState.status, targetLine, targetScrollKey])

  if (renderState.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {t('rightSidebar.loadingPreview')}
      </div>
    )
  }

  if (renderState.status === 'error') {
    return (
      <pre
        className={`min-h-full bg-card px-4 py-3 font-mono text-[12px] leading-5 text-foreground ${
          wordWrap ? 'whitespace-pre-wrap wrap-break-word' : 'min-w-max whitespace-pre'
        }`}
      >
        {content}
      </pre>
    )
  }

  let lineOffset = 0
  const rows = renderState.lines.map((lineTokens) => {
    const lineContent = lineTokens.map((token) => token.content).join('')
    const row = {
      key: `${lineOffset}:${lineContent}`,
      tokens: lineTokens
    }
    lineOffset += lineContent.length + 1
    return row
  })
  const lineNumberWidth = Math.max(2, String(rows.length).length)
  let nextLineNumber = 1

  return (
    <div
      ref={previewRef}
      className={`file-preview-code min-h-full py-3 font-mono text-[12px] leading-5 ${
        wordWrap ? '' : 'min-w-max'
      }`}
    >
      {rows.map((row) => {
        const lineNumber = nextLineNumber
        nextLineNumber += 1
        let tokenOffset = 0
        const isTargetLine = targetLine === lineNumber

        return (
          <div
            key={row.key}
            className={`grid grid-cols-[auto_1fr] ${
              isTargetLine ? 'bg-blue-100/90 dark:bg-blue-500/20' : ''
            }`}
            data-file-preview-line={lineNumber}
          >
            <span
              className={`select-none pr-5 pl-3 text-right ${
                isTargetLine ? 'text-blue-700 dark:text-blue-200' : 'text-muted-foreground/70'
              }`}
              style={{ minWidth: `${lineNumberWidth + 3}ch` }}
            >
              {lineNumber}
            </span>
            <code
              className={
                wordWrap ? 'pr-6 whitespace-pre-wrap wrap-break-word' : 'pr-6 whitespace-pre'
              }
            >
              {row.tokens.map((token) => {
                const key = `${tokenOffset}:${token.content}`
                tokenOffset += token.content.length
                return (
                  <span key={key} style={{ color: token.color }}>
                    {token.content}
                  </span>
                )
              })}
            </code>
          </div>
        )
      })}
    </div>
  )
}

export function FilePreviewRenderer({
  path,
  content,
  wordWrap = true,
  richView = true,
  targetLine = null,
  targetLineRequestId = null
}: {
  path: string
  content: string
  wordWrap?: boolean
  richView?: boolean
  targetLine?: number | null
  targetLineRequestId?: number | null
}): React.JSX.Element {
  if (isMarkdownPath(path) && richView) {
    return (
      <div className="file-preview-markdown min-h-full max-w-3xl px-8 py-6">
        <MarkdownRenderer content={content} />
      </div>
    )
  }

  return (
    <ShikiCodePreview
      path={path}
      content={content}
      wordWrap={wordWrap}
      targetLine={targetLine}
      targetLineRequestId={targetLineRequestId}
    />
  )
}
