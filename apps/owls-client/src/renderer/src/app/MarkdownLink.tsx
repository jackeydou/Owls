import { Button } from '@renderer/components/ui/button'
import { CheckIcon, CopyIcon, ExternalLinkIcon } from '@renderer/components/ui/icons'
import { AnchoredPopover, type PopoverPoint } from '@renderer/components/ui/popover'
import { type ComponentProps, type MouseEvent, type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const WEB_URL = /^https?:\/\//i

/** Main hands `window.open` for http(s) URLs to the system browser and denies the rest. */
function openExternal(url: string): void {
  window.open(url, '_blank', 'noreferrer')
}

const isMac = () => document.documentElement.dataset.platform === 'darwin'

/**
 * A Markdown link in agent output. A click asks first in a popover anchored to the
 * link; Cmd-click (Ctrl-click off macOS) opens it right away. Anything that is not a
 * web URL, including a link still streaming in, is plain text.
 */
export function MarkdownLink({ href = '', children }: ComponentProps<'a'>) {
  if (!WEB_URL.test(href)) return <span className="owls-markdown-link-text">{children}</span>
  return <WebLink href={href}>{children}</WebLink>
}

function WebLink({ href, children }: { href: string; children: ReactNode }) {
  const { t } = useTranslation()
  const anchorRef = useRef<HTMLAnchorElement | null>(null)
  const [point, setPoint] = useState<PopoverPoint | null>(null)
  const [copied, setCopied] = useState(false)
  const open = point !== null
  const close = (refocus: boolean) => {
    setPoint(null)
    setCopied(false)
    if (refocus) anchorRef.current?.focus({ preventScroll: true })
  }
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    if (isMac() ? event.metaKey : event.ctrlKey) {
      close(false)
      openExternal(href)
      return
    }
    if (open) return close(false)
    // A keyboard press has no pointer position; anchor to the link's first line then.
    const rect = event.currentTarget.getClientRects()[0]
    setPoint(
      event.detail > 0 || !rect
        ? { x: event.clientX, y: event.clientY }
        : { x: rect.left + 1, y: rect.top + 1 }
    )
  }
  return (
    <>
      <a
        ref={anchorRef}
        href={href}
        className="owls-markdown-link"
        data-open={open || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onClick}
      >
        {children}
      </a>
      <AnchoredPopover
        anchor={anchorRef.current}
        point={point}
        open={open}
        onClose={(reason) => close(reason === 'escape')}
        label={t('link.title')}
        className="owls-link-popover"
      >
        <div className="owls-link-popover-head">
          <ExternalLinkIcon size={15} />
          <span>{t('link.title')}</span>
        </div>
        <div className="owls-link-popover-url">{href}</div>
        <div className="owls-link-popover-foot">
          <span className="owls-link-popover-hint">
            {t(isMac() ? 'link.hintMac' : 'link.hintOther')}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              void navigator.clipboard.writeText(href).then(() => setCopied(true))
            }}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            {t(copied ? 'copied' : 'link.copy')}
          </Button>
          <Button
            size="sm"
            className="h-7 px-2.5"
            data-autofocus
            onClick={() => {
              close(false)
              openExternal(href)
            }}
          >
            {t('link.open')}
          </Button>
        </div>
      </AnchoredPopover>
    </>
  )
}

/** Streamdown components that route every Markdown link through {@link MarkdownLink}. */
export const markdownLinkComponents = { a: MarkdownLink }
