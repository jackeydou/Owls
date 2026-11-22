import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  GlobeIcon,
  HandIcon,
  LockIcon,
  PlusIcon,
  RefreshIcon,
  UserIcon,
  XIcon
} from '@renderer/components/ui/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BrowserAction, BrowserAsk, BrowserTab } from '../../../shared/browser-panel'
import { OwlAvatar } from '../app/OwlAvatar'
import { WorkingDots } from '../app/WorkingDots'
import { browserActions, tabNeed, useBrowserStore } from './store'
import './browser.css'

/** Matches the ring browser.css draws around a page a worker drives. */
const RING_WIDTH = 2

const ownerName = (tab: BrowserTab) => (tab.owner.kind === 'worker' ? tab.owner.title : null)

/** The tab's owner as a small mark: the worker's owl, or a person for the user's own tab. */
function OwnerMark({ tab }: { tab: BrowserTab }) {
  if (tab.owner.kind === 'user') return <UserIcon size={14} className="browser-tab-user" />
  return <OwlAvatar speaker={tab.owner.provider} working={tab.control.kind === 'agent'} />
}

function BrowserTabs({ tabs, activeId }: { tabs: BrowserTab[]; activeId: string | null }) {
  const { t } = useTranslation()
  return (
    <div className="browser-tabs" role="tablist" aria-label={t('browser.tabs')}>
      {tabs.map((tab) => {
        const owner = ownerName(tab)
        const ownerLabel = owner ? t('browser.tabOwner', { owner }) : t('browser.yourTab')
        const title = tab.title || t('browser.newTab')
        return (
          <div
            key={tab.id}
            className="browser-tab"
            data-active={tab.id === activeId || undefined}
            data-control={tab.control.kind}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.id === activeId}
                  onClick={() => void browserActions.activate(tab.id)}
                >
                  <OwnerMark tab={tab} />
                  <span>{title}</span>
                  <span className="sr-only">{ownerLabel}</span>
                  {tabNeed(tab) ? (
                    <i
                      className="browser-tab-alert"
                      role="img"
                      aria-label={t('browser.needsYou')}
                    />
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{ownerLabel}</TooltipContent>
            </Tooltip>
            <IconButton
              size="sm"
              className="browser-tab-close"
              label={t('browser.closeTab', { title })}
              icon={<XIcon size={13} />}
              onClick={() => void browserActions.close(tab.id)}
            />
          </div>
        )
      })}
      <IconButton
        size="sm"
        className="browser-tab-new"
        label={t('browser.newTab')}
        tooltip={t('browser.newTab')}
        tooltipSide="bottom"
        icon={<PlusIcon size={15} />}
        onClick={() => void browserActions.newTab()}
      />
    </div>
  )
}

/** The address: read-only while a worker drives, a field the user can type in otherwise. */
function AddressField({ tab, locked }: { tab: BrowserTab; locked: boolean }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<string | null>(null)
  const { host, rest } = splitUrl(tab.url)
  const blank = !tab.url || tab.url === 'about:blank'
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const url = (draft ?? '').trim()
    setDraft(null)
    if (url) void browserActions.navigate(tab.id, url)
  }
  return (
    <form className="browser-address" data-locked={locked || undefined} onSubmit={submit}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="browser-address-scheme"
            role="img"
            aria-label={t(tab.secure ? 'browser.secure' : 'browser.notSecure')}
          >
            {tab.secure ? <LockIcon size={13} /> : <GlobeIcon size={13} />}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t(tab.secure ? 'browser.secure' : 'browser.notSecure')}
        </TooltipContent>
      </Tooltip>
      {locked ? (
        <span className="browser-address-text">
          <span className="sr-only">{t('browser.address')}</span>
          <strong>{host}</strong>
          {rest}
        </span>
      ) : (
        <input
          className="browser-address-input"
          aria-label={t('browser.address')}
          placeholder={t('browser.addressPlaceholder')}
          spellCheck={false}
          value={draft ?? (blank ? '' : tab.url)}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft(null)
              event.currentTarget.blur()
            }
          }}
        />
      )}
    </form>
  )
}

/** Back, forward, reload, the address, and the button that moves the controls. */
function BrowserToolbar({ tab }: { tab: BrowserTab }) {
  const { t } = useTranslation()
  const owner = ownerName(tab)
  const locked = tab.control.kind === 'agent' && tab.owner.kind === 'worker'
  return (
    <div className="browser-toolbar">
      <IconButton
        size="sm"
        label={t('browser.back')}
        tooltip={t('browser.back')}
        tooltipSide="bottom"
        disabled={locked || !tab.canGoBack}
        icon={<ArrowLeftIcon size={16} />}
        onClick={() => void browserActions.history(tab.id, 'back')}
      />
      <IconButton
        size="sm"
        label={t('browser.forward')}
        tooltip={t('browser.forward')}
        tooltipSide="bottom"
        disabled={locked || !tab.canGoForward}
        icon={<ArrowRightIcon size={16} />}
        onClick={() => void browserActions.history(tab.id, 'forward')}
      />
      <IconButton
        size="sm"
        label={t('browser.reload')}
        tooltip={t('browser.reload')}
        tooltipSide="bottom"
        disabled={locked}
        icon={<RefreshIcon size={15} className={tab.loading ? 'animate-spin' : undefined} />}
        onClick={() => void browserActions.history(tab.id, 'reload')}
      />
      <AddressField key={tab.id} tab={tab} locked={locked} />
      {owner && tab.control.kind === 'agent' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="browser-control"
              onClick={() => void browserActions.takeOver(tab.id)}
            >
              <HandIcon size={15} />
              {t('browser.takeOver')}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('browser.takeOverHint', { owner })}</TooltipContent>
        </Tooltip>
      ) : null}
      {owner && tab.control.kind === 'user' && tab.owner.kind === 'worker' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="browser-control"
              onClick={() => void browserActions.handBack(tab.id)}
            >
              <OwlAvatar speaker={tab.owner.provider} />
              {t('browser.handBack')}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('browser.handBackHint', { owner })}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

function ActionText({ action }: { action: BrowserAction }) {
  const { t } = useTranslation()
  if (action.kind === 'open') return <em>{t('browser.action.open', { host: action.host })}</em>
  return <em>{t(`browser.action.${action.kind}`)}</em>
}

/** A site rule holds the worker until the user allows the site or the form post. */
function AskStrip({ tab, ask }: { tab: BrowserTab; ask: BrowserAsk }) {
  const { t } = useTranslation()
  if (tab.owner.kind !== 'worker') return null
  const answer = (value: 'allow' | 'always' | 'block') =>
    browserActions.answer({ tabId: tab.id, askId: ask.id, answer: value })
  return (
    <div className="browser-status" data-control="ask" role="alert">
      <OwlAvatar speaker={tab.owner.provider} />
      <p>
        <strong>{t(`browser.ask.${ask.kind}`, { owner: tab.owner.title, host: ask.host })}</strong>
        <span>{t(`browser.ask.${ask.kind}Hint`, { host: ask.host })}</span>
      </p>
      <div className="browser-ask-actions">
        <ActionButton variant="ghost" size="sm" onAction={() => answer('block')}>
          {t('browser.ask.block')}
        </ActionButton>
        <ActionButton variant="outline" size="sm" onAction={() => answer('always')}>
          {t('browser.ask.always')}
        </ActionButton>
        <ActionButton size="sm" onAction={() => answer('allow')}>
          {t('browser.ask.allow')}
        </ActionButton>
      </div>
    </div>
  )
}

/** One line under the toolbar that says who drives the page, and asks when it needs the user. */
function BrowserStatus({ tab }: { tab: BrowserTab }) {
  const { t } = useTranslation()
  if (tab.owner.kind === 'user') return null
  if (tab.ask) return <AskStrip tab={tab} ask={tab.ask} />
  const { provider, title } = tab.owner
  if (tab.control.kind === 'agent')
    return (
      <div className="browser-status" data-control="agent" role="status">
        <strong>{title}</strong>
        <span>{t('browser.driving')}</span>
        <WorkingDots speaker={provider} />
        {tab.control.action ? <ActionText action={tab.control.action} /> : null}
      </div>
    )
  if (tab.control.kind === 'handoff')
    return (
      <div className="browser-status" data-control="handoff" role="alert">
        <OwlAvatar speaker={provider} />
        <p>
          <strong>
            {title} {t('browser.needsYou')}
          </strong>
          <span>{tab.control.reason}</span>
        </p>
        <Button size="sm" onClick={() => void browserActions.handBack(tab.id)}>
          {t('browser.done')}
        </Button>
      </div>
    )
  return (
    <div className="browser-status" data-control="user" role="status">
      <HandIcon size={14} />
      <span>{t('browser.paused', { owner: title })}</span>
    </div>
  )
}

/**
 * True while a menu, popover, or dialog overlaps the page area. The page is a native view
 * drawn above every DOM element, so it would hide them. Tooltips are left out: they are small
 * and brief, and hiding the page for each would flicker.
 */
function overlayOver(area: DOMRect): boolean {
  const overlays = document.body.querySelectorAll<HTMLElement>(
    ':scope > [data-radix-popper-content-wrapper], :scope > [role="dialog"], :scope [role="dialog"][data-state="open"]'
  )
  for (const overlay of overlays) {
    if (overlay.querySelector('[role="tooltip"]')) continue
    const rect = overlay.getBoundingClientRect()
    if (
      rect.right > area.left &&
      rect.left < area.right &&
      rect.bottom > area.top &&
      rect.top < area.bottom
    )
      return true
  }
  return false
}

function splitUrl(url: string): { host: string; rest: string } {
  const match = /^[a-z]+:\/\/([^/]+)(.*)$/i.exec(url)
  return match ? { host: match[1], rest: match[2] } : { host: url, rest: '' }
}

/**
 * Where the page goes. The box itself stays empty: main lays the active tab's
 * WebContentsView over its bounds, so this reports them whenever they change, and null
 * once the box leaves the screen.
 */
function Viewport({ tab }: { tab: BrowserTab }) {
  const box = useRef<HTMLDivElement>(null)
  const report = useRef<() => void>(() => {})
  // A driven page sits inside its colored ring; the native view would cover it otherwise.
  const inset = tab.control.kind === 'user' ? 0 : RING_WIDTH
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    let frame = 0
    report.current = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect()
        const edge = Number(element.dataset.inset ?? 0)
        if (overlayOver(rect)) return browserActions.setBounds(null)
        browserActions.setBounds({
          x: Math.max(0, rect.left + edge),
          y: Math.max(0, rect.top + edge),
          width: Math.max(0, rect.width - edge * 2),
          height: Math.max(0, rect.height - edge * 2)
        })
      })
    }
    const observer = new ResizeObserver(() => report.current())
    observer.observe(element)
    const resized = () => report.current()
    window.addEventListener('resize', resized)
    // Menus, popovers, and dialogs portal into body; the page steps aside while one covers it.
    const overlays = new MutationObserver(resized)
    overlays.observe(document.body, { childList: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      overlays.disconnect()
      window.removeEventListener('resize', resized)
      browserActions.setBounds(null)
    }
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new tab or ring re-reports the same box.
  useLayoutEffect(() => report.current(), [tab.id, inset])
  return (
    <div
      ref={box}
      className="browser-viewport"
      role="tabpanel"
      data-inset={inset}
      data-control={tab.control.kind}
      data-speaker={tab.owner.kind === 'worker' ? tab.owner.provider : undefined}
    />
  )
}

/** The right sidebar's browser: the tabs main owns, and the active tab's page. */
export function BrowserPane() {
  const { t } = useTranslation()
  const tabs = useBrowserStore((s) => s.tabs)
  const activeId = useBrowserStore((s) => s.activeId)
  const tab = tabs.find((x) => x.id === activeId) ?? null
  // Without a page to show, the view must not stay over the panel.
  useEffect(() => {
    if (!tab) browserActions.setBounds(null)
  }, [tab])
  return (
    <section className="router-right-pane browser-pane" aria-label={t('router.panel.browser')}>
      <BrowserTabs tabs={tabs} activeId={activeId} />
      {tab ? (
        <>
          <BrowserToolbar tab={tab} />
          <BrowserStatus tab={tab} />
          <Viewport tab={tab} />
        </>
      ) : (
        <div className="browser-empty">
          <GlobeIcon size={22} />
          <p>{t('browser.empty')}</p>
        </div>
      )}
    </section>
  )
}
