import { AnchoredTooltip } from '@renderer/components/ui/tooltip'
import { copyTextToClipboard } from '@renderer/lib/clipboard'
import { useI18n } from '@renderer/lib/i18n'
import { code } from '@streamdown/code'
import { Check, Copy } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Components, Streamdown } from 'streamdown'
import type { ArtifactRecord } from '../../../../shared/artifacts'
import { normalizeWebTargetUrl } from '../../../../shared/web-targets'
import { type MarkdownImageSaveRequest, MarkdownImageWithSave } from './markdown/MarkdownImage'
import {
  isWebHref,
  localPathFromHref,
  MarkdownInlineCode,
  MarkdownLink,
  openLocalFileLinkTarget
} from './markdown/MarkdownLinks'
import { MarkdownTable } from './markdown/MarkdownTable'
import { markdownRehypePlugins, markdownUrlTransform } from './markdown/markdown-streamdown-config'
import type { ChatLinkOpener } from './useChatExternalLink'

export { MarkdownLocalFileLink, MarkdownWebLinkIcon } from './markdown/MarkdownLinks'

const plugins = { code }
const controls = {
  code: { copy: true, download: false },
  mermaid: true,
  table: { copy: true, download: true, fullscreen: false }
} as const
const icons = {
  CheckIcon: Check,
  CopyIcon: Copy
}
const linkSafety = { enabled: false } as const
export const MARKDOWN_LINK_TOOLTIP_MAX_WIDTH = 480
export const MARKDOWN_LINK_TOOLTIP_CLASS_NAME =
  'w-max whitespace-normal wrap-anywhere px-3 py-2 text-[12px]'

const linkContextMenuActions = {
  openInBrowser: 'open-in-browser',
  openExternally: 'open-externally',
  copyLink: 'copy-link'
} as const

type LinkTooltipState = {
  url: string
  anchor: HTMLAnchorElement
}

function rawAnchorHref(anchor: HTMLAnchorElement): string {
  return anchor.getAttribute('href')?.trim() ?? ''
}

function localPathFromLinkTarget(url: string): string | null {
  const localPath = localPathFromHref(url)
  if (localPath) return localPath

  const normalizedUrl = normalizeWebTargetUrl(url)
  if (!normalizedUrl?.startsWith('file://')) return null
  return localPathFromHref(normalizedUrl)
}

function extractCodeBlockText(codeBlock: HTMLElement): string | null {
  const code = codeBlock.querySelector<HTMLElement>('[data-streamdown="code-block-body"] code')
  if (!code) return null

  const lines = Array.from(code.querySelectorAll<HTMLElement>(':scope > span'))
  const text =
    lines.length > 0
      ? lines.map((line) => line.textContent ?? '').join('\n')
      : (code.textContent ?? '')

  return text.replace(/\n+$/, '')
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  isStreaming = false,
  onOpenLink,
  onSaveImage
}: {
  content: string
  isStreaming?: boolean
  onOpenLink?: ChatLinkOpener
  onSaveImage?: (request: MarkdownImageSaveRequest) => Promise<ArtifactRecord | null>
}) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const [linkTooltip, setLinkTooltip] = useState<LinkTooltipState | null>(null)

  const closeLinkTooltip = useCallback(() => setLinkTooltip(null), [])

  const showLinkTooltip = useCallback((anchor: HTMLAnchorElement) => {
    const url = rawAnchorHref(anchor)
    if (!normalizeWebTargetUrl(url) && !localPathFromHref(url)) return

    const rect = anchor.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    setLinkTooltip({ url, anchor })
  }, [])

  const openLinkInBrowser = useCallback(
    (url: string) => {
      const normalizedUrl = normalizeWebTargetUrl(url)
      if (!normalizedUrl) return
      if (onOpenLink) {
        onOpenLink(normalizedUrl, 'embedded')
        return
      }
      void window.api.embeddedBrowser.open(normalizedUrl).catch(console.error)
    },
    [onOpenLink]
  )

  const openLinkExternally = useCallback((url: string) => {
    const localPath = localPathFromLinkTarget(url)
    if (localPath) {
      void window.api.attachments.open(localPath).catch(console.error)
      return
    }

    const normalizedUrl = normalizeWebTargetUrl(url)
    if (!normalizedUrl || !isWebHref(normalizedUrl)) return
    void window.api.app.openExternal(normalizedUrl).catch(console.error)
  }, [])

  const copyLink = useCallback((url: string) => {
    void copyTextToClipboard(url).catch(console.error)
  }, [])

  const showLinkContextMenu = useCallback(
    (url: string, x: number, y: number) => {
      closeLinkTooltip()
      const canOpenInBrowser = Boolean(normalizeWebTargetUrl(url))
      void window.api.app
        .showContextMenu({
          x,
          y,
          items: [
            ...(canOpenInBrowser
              ? [
                  {
                    id: linkContextMenuActions.openInBrowser,
                    label: t('chat.linkContext.openInBrowser')
                  }
                ]
              : []),
            {
              id: linkContextMenuActions.openExternally,
              label: t('chat.linkContext.openInExternalBrowser')
            },
            { type: 'separator' },
            {
              id: linkContextMenuActions.copyLink,
              label: t('chat.linkContext.copyLink')
            }
          ]
        })
        .then((action) => {
          if (action === linkContextMenuActions.openInBrowser) {
            openLinkInBrowser(url)
            return
          }
          if (action === linkContextMenuActions.openExternally) {
            openLinkExternally(url)
            return
          }
          if (action === linkContextMenuActions.copyLink) {
            copyLink(url)
          }
        })
        .catch(console.error)
    },
    [closeLinkTooltip, copyLink, openLinkExternally, openLinkInBrowser, t]
  )

  const components = useMemo<Components>(() => {
    const MarkdownImage = ({
      ...props
    }: React.ComponentPropsWithoutRef<'img'> & { node?: unknown }) => {
      return <MarkdownImageWithSave {...props} onSaveImage={onSaveImage} />
    }

    return {
      a: MarkdownLink,
      img: MarkdownImage,
      inlineCode: MarkdownInlineCode,
      table: MarkdownTable
    }
  }, [onSaveImage])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !onOpenLink) return

    const handleClick = (event: globalThis.MouseEvent) => {
      if (!onOpenLink || event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor) return

      const href = rawAnchorHref(anchor)
      const webTargetUrl = normalizeWebTargetUrl(href)
      if (webTargetUrl === 'about:blank') {
        event.preventDefault()
        return
      }
      if (webTargetUrl?.startsWith('file://')) {
        event.preventDefault()
        openLinkInBrowser(webTargetUrl)
        return
      }

      const localPath = localPathFromHref(href)
      if (localPath) {
        event.preventDefault()
        void openLocalFileLinkTarget({ href, localPath }).catch(console.error)
        return
      }

      if (webTargetUrl) {
        event.preventDefault()
        onOpenLink(webTargetUrl)
        return
      }

      if (isWebHref(href)) {
        event.preventDefault()
        console.warn('Blocked malformed web URL navigation:', href)
        return
      }
    }

    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [onOpenLink, openLinkInBrowser])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleContextMenu = (event: globalThis.MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || !container.contains(anchor)) return

      const url = rawAnchorHref(anchor)
      if (!normalizeWebTargetUrl(url) && !localPathFromHref(url)) return

      event.preventDefault()
      showLinkContextMenu(url, event.clientX, event.clientY)
    }

    container.addEventListener('contextmenu', handleContextMenu)
    return () => container.removeEventListener('contextmenu', handleContextMenu)
  }, [showLinkContextMenu])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseOver = (event: globalThis.MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || !container.contains(anchor)) return
      showLinkTooltip(anchor)
    }
    const handleMouseOut = (event: globalThis.MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || !container.contains(anchor)) return
      const relatedTarget = event.relatedTarget as Node | null
      if (relatedTarget && anchor.contains(relatedTarget)) return
      closeLinkTooltip()
    }
    const handleFocusIn = (event: globalThis.FocusEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || !container.contains(anchor)) return
      showLinkTooltip(anchor)
    }
    const handleFocusOut = () => closeLinkTooltip()
    const handleScroll = () => closeLinkTooltip()

    container.addEventListener('mouseover', handleMouseOver)
    container.addEventListener('mouseout', handleMouseOut)
    container.addEventListener('focusin', handleFocusIn)
    container.addEventListener('focusout', handleFocusOut)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      container.removeEventListener('mouseover', handleMouseOver)
      container.removeEventListener('mouseout', handleMouseOut)
      container.removeEventListener('focusin', handleFocusIn)
      container.removeEventListener('focusout', handleFocusOut)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [closeLinkTooltip, showLinkTooltip])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleCodeCopy = (event: globalThis.MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        '[data-streamdown="code-block-copy-button"]'
      )
      if (!button) return

      const codeBlock = button.closest<HTMLElement>('[data-streamdown="code-block"]')
      if (!codeBlock) return

      const text = extractCodeBlockText(codeBlock)
      if (text === null) return

      window.setTimeout(() => {
        void navigator.clipboard?.writeText(text).catch(console.error)
      }, 0)
    }

    container.addEventListener('click', handleCodeCopy)
    return () => container.removeEventListener('click', handleCodeCopy)
  }, [])

  return (
    <div ref={containerRef} className="markdown-body">
      <Streamdown
        plugins={plugins}
        controls={controls}
        icons={icons}
        linkSafety={linkSafety}
        components={components}
        rehypePlugins={markdownRehypePlugins}
        urlTransform={markdownUrlTransform}
        lineNumbers={false}
        isAnimating={isStreaming}
        caret={isStreaming ? 'block' : undefined}
      >
        {content}
      </Streamdown>
      {linkTooltip ? (
        <AnchoredTooltip
          open
          reference={linkTooltip.anchor}
          placement="top-start"
          maxWidth={MARKDOWN_LINK_TOOLTIP_MAX_WIDTH}
          className={MARKDOWN_LINK_TOOLTIP_CLASS_NAME}
        >
          {linkTooltip.url}
        </AnchoredTooltip>
      ) : null}
    </div>
  )
})
