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
import { useTranslation } from 'react-i18next'
import type { BrowserTab } from '../../../shared/browser-panel'
import { OwlAvatar } from '../app/OwlAvatar'
import { WorkingDots } from '../app/WorkingDots'
import { PrototypePage } from './PrototypePage'
import { useBrowserStore } from './store'
import './browser.css'

const ownerName = (tab: BrowserTab) => (tab.owner.kind === 'worker' ? tab.owner.title : null)

/** The tab's owner as a small mark: the worker's owl, or a person for the user's own tab. */
function OwnerMark({ tab }: { tab: BrowserTab }) {
  if (tab.owner.kind === 'user') return <UserIcon size={14} className="browser-tab-user" />
  return <OwlAvatar speaker={tab.owner.provider} working={tab.control.kind === 'agent'} />
}

function BrowserTabs({ tabs, activeId }: { tabs: BrowserTab[]; activeId: string | null }) {
  const { t } = useTranslation()
  const activate = useBrowserStore((s) => s.activate)
  const close = useBrowserStore((s) => s.close)
  return (
    <div className="browser-tabs" role="tablist" aria-label={t('browser.tabs')}>
      {tabs.map((tab) => {
        const owner = ownerName(tab)
        const ownerLabel = owner ? t('browser.tabOwner', { owner }) : t('browser.yourTab')
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
                  onClick={() => activate(tab.id)}
                >
                  <OwnerMark tab={tab} />
                  <span>{tab.title}</span>
                  <span className="sr-only">{ownerLabel}</span>
                  {tab.control.kind === 'handoff' ? (
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
              label={t('browser.closeTab', { title: tab.title })}
              icon={<XIcon size={13} />}
              onClick={() => close(tab.id)}
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
        onClick={() => {}}
      />
    </div>
  )
}

/** Back, forward, reload, the address, and the button that moves the controls. */
function BrowserToolbar({ tab }: { tab: BrowserTab }) {
  const { t } = useTranslation()
  const takeOver = useBrowserStore((s) => s.takeOver)
  const handBack = useBrowserStore((s) => s.handBack)
  const owner = ownerName(tab)
  const locked = tab.control.kind === 'agent'
  const { host, rest } = splitUrl(tab.url)
  return (
    <div className="browser-toolbar">
      <IconButton
        size="sm"
        label={t('browser.back')}
        tooltip={t('browser.back')}
        tooltipSide="bottom"
        disabled={locked || !tab.canGoBack}
        icon={<ArrowLeftIcon size={16} />}
        onClick={() => {}}
      />
      <IconButton
        size="sm"
        label={t('browser.forward')}
        tooltip={t('browser.forward')}
        tooltipSide="bottom"
        disabled={locked || !tab.canGoForward}
        icon={<ArrowRightIcon size={16} />}
        onClick={() => {}}
      />
      <IconButton
        size="sm"
        label={t('browser.reload')}
        tooltip={t('browser.reload')}
        tooltipSide="bottom"
        disabled={locked}
        icon={<RefreshIcon size={15} />}
        onClick={() => {}}
      />
      <div className="browser-address" data-locked={locked || undefined}>
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
        <span className="sr-only">{t('browser.address')}</span>
        <span className="browser-address-text">
          <strong>{host}</strong>
          {rest}
        </span>
      </div>
      {owner && tab.control.kind === 'agent' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="browser-control"
              onClick={() => takeOver(tab.id)}
            >
              <HandIcon size={15} />
              {t('browser.takeOver')}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('browser.takeOverHint', { owner })}</TooltipContent>
        </Tooltip>
      ) : null}
      {owner && tab.control.kind === 'user' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="browser-control"
              onClick={() => handBack(tab.id)}
            >
              <OwlAvatar speaker={tab.owner.kind === 'worker' ? tab.owner.provider : 'router'} />
              {t('browser.handBack')}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('browser.handBackHint', { owner })}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

/** One line under the toolbar that says who drives the page, and asks when it needs the user. */
function BrowserStatus({ tab }: { tab: BrowserTab }) {
  const { t } = useTranslation()
  const handBack = useBrowserStore((s) => s.handBack)
  if (tab.owner.kind === 'user') return null
  const { provider, title } = tab.owner
  if (tab.control.kind === 'agent')
    return (
      <div className="browser-status" data-control="agent" role="status">
        <strong>{title}</strong>
        <span>{t('browser.driving')}</span>
        <WorkingDots speaker={provider} />
        {tab.control.action ? <em>{tab.control.action}</em> : null}
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
        <Button size="sm" onClick={() => handBack(tab.id)}>
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

function splitUrl(url: string): { host: string; rest: string } {
  const match = /^[a-z]+:\/\/([^/]+)(.*)$/i.exec(url)
  return match ? { host: match[1], rest: match[2] } : { host: url, rest: '' }
}

/**
 * The right sidebar's browser. In the real panel the page area is a placeholder whose bounds
 * main follows with the tab's WebContentsView; the prototype draws a stand-in page there.
 */
export function BrowserPane() {
  const { t } = useTranslation()
  const tabs = useBrowserStore((s) => s.tabs)
  const activeId = useBrowserStore((s) => s.activeId)
  const tab = tabs.find((x) => x.id === activeId) ?? null
  return (
    <section className="router-right-pane browser-pane" aria-label={t('router.panel.browser')}>
      <BrowserTabs tabs={tabs} activeId={activeId} />
      {tab ? (
        <>
          <BrowserToolbar tab={tab} />
          <BrowserStatus tab={tab} />
          <div
            className="browser-viewport"
            role="tabpanel"
            data-control={tab.control.kind}
            data-speaker={tab.owner.kind === 'worker' ? tab.owner.provider : undefined}
          >
            <PrototypePage
              tab={tab}
              cursorLabel={
                tab.owner.kind === 'worker'
                  ? t('browser.agentCursor', { owner: tab.owner.title })
                  : ''
              }
            />
          </div>
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
