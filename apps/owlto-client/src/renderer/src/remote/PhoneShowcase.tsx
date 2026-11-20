import { type ReactNode, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import claudeCode from '../../../../resources/owl-avatars/claude-code.svg'
import codex from '../../../../resources/owl-avatars/codex.svg'
import router from '../../../../resources/owl-avatars/router.svg'
import claudeCodeWorking from '../../../../resources/owl-avatars/working/claude-code.svg'
import codexWorking from '../../../../resources/owl-avatars/working/codex.svg'
import routerWorking from '../../../../resources/owl-avatars/working/router.svg'
import './phone.css'

/**
 * A working mock of the Owlto iPhone app on a sample project, drawn at the app's own point
 * sizes (a 390-point-wide iPhone, `apps/owlto-ios/Owlto/UI`, Standard light theme) and scaled
 * into a phone frame. A finger taps through it on its own (open a thread, a worker, approve a
 * command); a click inside hands it over to the user, and every screen works by hand too.
 */

const OWLS = {
  router: [router, routerWorking],
  'claude-code': [claudeCode, claudeCodeWorking],
  codex: [codex, codexWorking]
} as const
type Owl = keyof typeof OWLS

type Tab = 'threads' | 'inbox' | 'devices'
type Page = 'thread' | 'worker'
type State = {
  /** Before pairing: the app's first screen, the scanner, then the safety code. */
  pairing: 'connect' | 'scanning' | 'paired' | null
  tab: Tab
  stack: Page[]
  sheet: boolean
  approved: boolean
  /** Which way the last move went, for the page's slide. */
  motion: 'push' | 'pop' | 'tab'
}
type Action =
  | { type: 'reset'; pairing: boolean }
  | { type: 'scan' }
  | { type: 'scanned' }
  | { type: 'paired' }
  | { type: 'tab'; tab: Tab }
  | { type: 'push'; page: Page }
  | { type: 'pop' }
  | { type: 'sheet'; open: boolean }
  | { type: 'approve' }

const initial = (pairing: boolean): State => ({
  pairing: pairing ? 'connect' : null,
  tab: 'threads',
  stack: [],
  sheet: false,
  approved: false,
  motion: 'tab'
})

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'reset':
      return initial(action.pairing)
    case 'scan':
      return { ...state, pairing: 'scanning', motion: 'push' }
    case 'scanned':
      return state.pairing === 'scanning' ? { ...state, pairing: 'paired', motion: 'push' } : state
    case 'paired':
      return { ...state, pairing: null, motion: 'tab' }
    case 'tab':
      return { ...state, tab: action.tab, stack: [], sheet: false, motion: 'tab' }
    case 'push':
      return { ...state, stack: [...state.stack, action.page], motion: 'push' }
    case 'pop':
      return { ...state, stack: state.stack.slice(0, -1), motion: 'pop' }
    case 'sheet':
      return { ...state, sheet: action.open }
    case 'approve':
      return { ...state, sheet: false, approved: true }
  }
}

/** One tap of the demo: the element marked `data-tap={target}`, then what the tap does. */
type TourStep = { target: string; action: Action; wait?: number }

const APP_TOUR: TourStep[] = [
  { target: 'thread-login', action: { type: 'push', page: 'thread' }, wait: 1400 },
  { target: 'worker-fix', action: { type: 'push', page: 'worker' }, wait: 2200 },
  { target: 'back', action: { type: 'pop' }, wait: 2200 },
  { target: 'back', action: { type: 'pop' }, wait: 1200 },
  { target: 'tab-inbox', action: { type: 'tab', tab: 'inbox' }, wait: 1000 },
  { target: 'inbox-command', action: { type: 'sheet', open: true }, wait: 1400 },
  { target: 'allow', action: { type: 'approve' }, wait: 1800 },
  { target: 'tab-threads', action: { type: 'tab', tab: 'threads' }, wait: 1600 },
  { target: 'thread-login', action: { type: 'push', page: 'thread' }, wait: 1600 }
]
const PAIR_TOUR: TourStep[] = [
  { target: 'scan', action: { type: 'scan' }, wait: 1600 },
  { target: 'match', action: { type: 'paired' }, wait: 2600 },
  ...APP_TOUR
]
const FINGER_MOVE_MS = 650
const TOUR_RESTART_MS = 3200
const SCAN_MS = 1700

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function Avatar({ owl, working = false, size }: { owl: Owl; working?: boolean; size: number }) {
  return (
    <img
      className="ph-owl"
      src={OWLS[owl][working ? 1 : 0]}
      alt=""
      style={{ width: size, height: size }}
    />
  )
}

/** SF Symbols stand-ins, drawn on a 24-unit grid. */
const GLYPHS = {
  threads: (
    <>
      <path d="M4 5.5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" />
      <path d="M17 9h3a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v3l-3.5-3H12" />
    </>
  ),
  tray: (
    <>
      <path d="M3 13.5 5.5 5h13L21 13.5V19H3Z" />
      <path d="M3 13.5h5.5a3.5 3.5 0 0 0 7 0H21" />
    </>
  ),
  desktop: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  compose: (
    <>
      <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
      <path d="m10 14 .5-3L18.5 3l2.5 2.5-8 8Z" />
    </>
  ),
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronDown: <path d="m7 10 5 5 5-5" />,
  archive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v10h14V9M10 13h4" />
    </>
  ),
  qr: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <rect x="8" y="8" width="3" height="3" />
      <rect x="13" y="8" width="3" height="3" />
      <rect x="8" y="13" width="3" height="3" />
      <path d="M13 13h3v3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  pr: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M6 8v8M18 16V9a2 2 0 0 0-2-2h-4m2-2-2 2 2 2" />
    </>
  ),
  diff: <path d="M12 4v8M8 8h8M8 18h8" />,
  check: <path d="m5 12 4.5 4.5L19 7" />
}

function Glyph({ name, size = 22 }: { name: keyof typeof GLYPHS; size?: number }) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative (aria-hidden); the mock app's text says what each control is.
    <svg
      className="ph-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {GLYPHS[name]}
    </svg>
  )
}

/** A tappable part of the mock app; `tap` names it for the demo's finger. */
function Tap({
  tap,
  onTap,
  className,
  label,
  children
}: {
  tap: string
  onTap: () => void
  className?: string
  label?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-tap={tap}
      aria-label={label}
      className={`ph-tap ${className ?? ''}`}
      onClick={onTap}
    >
      {children}
    </button>
  )
}

type ScreenProps = { state: State; go: (action: Action) => void }

function StatusBar({ dark = false }: { dark?: boolean }) {
  return (
    <div className="ph-status" data-dark={dark || undefined}>
      <span>9:41</span>
      <span className="ph-status-icons">
        <i className="ph-signal">
          <b />
          <b />
          <b />
          <b />
        </i>
        <i className="ph-battery" />
      </span>
    </div>
  )
}

function TabBar({ state, go }: ScreenProps) {
  const { t } = useTranslation()
  const waiting = state.approved ? 1 : 2
  return (
    <nav className="ph-tabs">
      <Tap
        tap="tab-threads"
        onTap={() => go({ type: 'tab', tab: 'threads' })}
        className={state.tab === 'threads' ? 'ph-tab-active' : undefined}
      >
        <Glyph name="threads" size={26} />
        {t('remote.phone.threads')}
      </Tap>
      <Tap
        tap="tab-inbox"
        onTap={() => go({ type: 'tab', tab: 'inbox' })}
        className={state.tab === 'inbox' ? 'ph-tab-active' : undefined}
      >
        <span className="ph-tab-icon">
          <Glyph name="tray" size={26} />
          <b className="ph-badge">{waiting}</b>
        </span>
        {t('remote.phone.needsYou')}
      </Tap>
      <Tap
        tap="tab-devices"
        onTap={() => go({ type: 'tab', tab: 'devices' })}
        className={state.tab === 'devices' ? 'ph-tab-active' : undefined}
      >
        <Glyph name="desktop" size={26} />
        {t('remote.phone.devices')}
      </Tap>
    </nav>
  )
}

function BackBar({
  title,
  go,
  trailing
}: {
  title: string
  go: ScreenProps['go']
  trailing?: ReactNode
}) {
  return (
    <div className="ph-nav ph-nav-inline">
      <Tap tap="back" onTap={() => go({ type: 'pop' })} className="ph-back">
        <Glyph name="chevronLeft" size={26} />
      </Tap>
      <strong>{title}</strong>
      {trailing ?? <span />}
    </div>
  )
}

function ThreadRow({
  tap,
  onTap,
  title,
  time,
  preview,
  meta,
  working = false,
  badge = false
}: {
  tap: string
  onTap: () => void
  title: string
  time: string
  preview: string
  meta: string
  working?: boolean
  badge?: boolean
}) {
  return (
    <Tap tap={tap} onTap={onTap} className="ph-row">
      <span className="ph-row-avatar">
        <Avatar owl="router" working={working} size={40} />
        {badge ? <i className="ph-dot ph-dot-wait ph-dot-badge" /> : null}
      </span>
      <span className="ph-row-body">
        <span className="ph-row-head">
          <strong>{title}</strong>
          <small>{time}</small>
        </span>
        <span className="ph-row-preview">{preview}</span>
        <span className="ph-row-meta">{meta}</span>
      </span>
    </Tap>
  )
}

function ThreadsScreen({ state, go }: ScreenProps) {
  const { t } = useTranslation()
  const open = () => go({ type: 'push', page: 'thread' })
  return (
    <>
      <div className="ph-nav">
        <span className="ph-device">
          <Glyph name="desktop" size={19} />
          Mac mini
          <i className="ph-dot ph-dot-ok" />
          <Glyph name="chevronDown" size={13} />
        </span>
        <Glyph name="compose" />
      </div>
      <h1 className="ph-large-title">{t('remote.phone.threads')}</h1>
      <div className="ph-pills">
        <span className="ph-pill ph-pill-run">
          <span className="ph-stack">
            {state.approved ? null : <Avatar owl="claude-code" working size={20} />}
            <Avatar owl="codex" working size={20} />
          </span>
          {t('remote.phone.working', { count: state.approved ? 1 : 2 })}
        </span>
        <span className="ph-pill ph-pill-wait">
          <i className="ph-dot ph-dot-wait" />
          {t('remote.phone.waiting', { count: state.approved ? 1 : 2 })}
        </span>
      </div>
      <p className="ph-section">{t('remote.phone.today')}</p>
      <ThreadRow
        tap="thread-login"
        onTap={open}
        title={t('remote.phone.thread1')}
        time={state.approved ? '9:42' : '9:38'}
        preview={t(state.approved ? 'remote.phone.thread1Passed' : 'remote.phone.thread1Preview')}
        meta={t('remote.phone.thread1Meta')}
        working={!state.approved}
        badge={!state.approved}
      />
      <ThreadRow
        tap="thread-deps"
        onTap={open}
        title={t('remote.phone.thread2')}
        time="8:15"
        preview={t('remote.phone.thread2Preview')}
        meta={t('remote.phone.thread2Meta')}
      />
      <p className="ph-section">{t('remote.phone.yesterday')}</p>
      <ThreadRow
        tap="thread-notes"
        onTap={open}
        title={t('remote.phone.thread3')}
        time={t('remote.phone.yesterday')}
        preview={t('remote.phone.thread3Preview')}
        meta={t('remote.phone.thread3Meta')}
        working
        badge
      />
    </>
  )
}

function Speaker({ owl, name, children }: { owl: Owl | 'you'; name: string; children: ReactNode }) {
  return (
    <div className="ph-speaker">
      {owl === 'you' ? <span className="ph-you">Y</span> : <Avatar owl={owl} size={28} />}
      <div>
        <small>{name}</small>
        {children}
      </div>
    </div>
  )
}

function ThreadScreen({ state, go }: ScreenProps) {
  const { t } = useTranslation()
  return (
    <>
      <BackBar title={t('remote.phone.thread1')} go={go} trailing={<Glyph name="archive" />} />
      <div className="ph-timeline">
        <Speaker owl="you" name={t('remote.phone.you')}>
          <p className="ph-bubble">{t('remote.phone.userAsk')}</p>
        </Speaker>
        <Speaker owl="router" name="Router">
          <p>{t('remote.phone.routerPlan')}</p>
        </Speaker>
        <div className="ph-dispatches">
          <Tap
            tap="worker-fix"
            onTap={() => go({ type: 'push', page: 'worker' })}
            className="ph-dispatch"
          >
            <Avatar owl="claude-code" working={!state.approved} size={24} />
            <span>{t('remote.phone.workerFix')}</span>
            {state.approved ? (
              <em data-tone="done">
                <i className="ph-dot ph-dot-ok" />
                {t('remote.phone.done')}
              </em>
            ) : (
              <em data-tone="wait">
                <i className="ph-dot ph-dot-wait" />
                {t('remote.phone.waitingApproval')}
              </em>
            )}
            <Glyph name="chevronRight" size={16} />
          </Tap>
          <Tap
            tap="worker-test"
            onTap={() => go({ type: 'push', page: 'worker' })}
            className="ph-dispatch"
          >
            <Avatar owl="codex" size={24} />
            <span>{t('remote.phone.workerTest')}</span>
            <em data-tone="done">
              <i className="ph-dot ph-dot-ok" />
              {t('remote.phone.done')}
            </em>
            <Glyph name="chevronRight" size={16} />
          </Tap>
        </div>
        <Speaker owl="router" name="Router">
          <p>{t('remote.phone.routerUpdate')}</p>
        </Speaker>
        {state.approved ? (
          <Speaker owl="router" name="Router">
            <p>{t('remote.phone.routerPassed')}</p>
          </Speaker>
        ) : null}
      </div>
      <div className="ph-composer">
        <span>{t('remote.phone.composer')}</span>
        <i>
          <Glyph name="send" size={18} />
        </i>
      </div>
    </>
  )
}

function WorkerScreen({ state, go }: ScreenProps) {
  const { t } = useTranslation()
  const done = state.approved
  return (
    <>
      <BackBar title={t('remote.phone.workerFix')} go={go} />
      <div className="ph-worker">
        <div className="ph-worker-head">
          <Avatar owl="claude-code" working={!done} size={44} />
          <div>
            <strong>
              {done ? 'Claude Code' : t('remote.phone.isWorking', { agent: 'Claude Code' })}
            </strong>
            {done ? (
              <em data-tone="done">
                <i className="ph-dot ph-dot-ok" />
                {t('remote.phone.done')}
              </em>
            ) : (
              <em data-tone="wait">
                <i className="ph-dot ph-dot-wait" />
                {t('remote.phone.waitingApproval')}
              </em>
            )}
          </div>
        </div>
        <p className={`ph-label ${done ? 'ph-label-info' : ''}`}>
          {t(done ? 'remote.phone.reportDone' : 'remote.phone.reportProgress')}
        </p>
        <p className="ph-report">{t(done ? 'remote.phone.report' : 'remote.phone.reportSoFar')}</p>
        <div className="ph-card">
          <Glyph name="pr" />
          <div>
            <strong>{t('remote.phone.pullRequest', { number: 212 })}</strong>
            <small>acme/web-app</small>
          </div>
        </div>
        <div className="ph-card">
          <Glyph name="diff" />
          <div>
            <strong>
              {t('remote.phone.changes')} <b className="ph-add">+42</b> <b className="ph-del">−7</b>
            </strong>
            <small>src/auth/redirect.ts · 2 files</small>
          </div>
        </div>
        <p className="ph-label">{t('remote.phone.conversation')}</p>
        <p className="ph-step">
          <small>{t('remote.phone.stepRead')}</small>src/auth/redirect.ts
        </p>
        <p className="ph-step">
          <small>{t('remote.phone.stepEdit')}</small>src/auth/redirect.ts
        </p>
        <p className="ph-step">
          <small>{t('remote.phone.stepRun')}</small>pnpm test:e2e
          {done ? <Glyph name="check" size={14} /> : <i className="ph-dot ph-dot-wait" />}
        </p>
      </div>
    </>
  )
}

function InboxScreen({ state, go }: ScreenProps) {
  const { t } = useTranslation()
  return (
    <>
      <div className="ph-nav" />
      <h1 className="ph-large-title">{t('remote.phone.needsYou')}</h1>
      {state.approved ? null : (
        <Tap
          tap="inbox-command"
          onTap={() => go({ type: 'sheet', open: true })}
          className="ph-inbox-row"
        >
          <span className="ph-row-avatar">
            <Avatar owl="claude-code" working size={36} />
            <i className="ph-dot ph-dot-wait ph-dot-badge" />
          </span>
          <span className="ph-row-body">
            <span className="ph-row-head">
              <strong>{t('remote.phone.thread1')}</strong>
              <small>Mac mini</small>
            </span>
            <span className="ph-row-preview">
              <b className="ph-warn">{t('remote.phone.runCommand')}</b> · pnpm test:e2e
            </span>
          </span>
        </Tap>
      )}
      <Tap tap="inbox-question" onTap={() => undefined} className="ph-inbox-row">
        <span className="ph-row-avatar">
          <Avatar owl="codex" working size={36} />
          <i className="ph-dot ph-dot-info ph-dot-badge" />
        </span>
        <span className="ph-row-body">
          <span className="ph-row-head">
            <strong>{t('remote.phone.thread3')}</strong>
            <small>Mac mini</small>
          </span>
          <span className="ph-row-preview">
            <b className="ph-info">{t('remote.phone.hasQuestion')}</b> ·{' '}
            {t('remote.phone.question')}
          </span>
        </span>
      </Tap>
      {state.approved ? <p className="ph-toast">{t('remote.phone.approved')}</p> : null}
    </>
  )
}

function ApprovalSheet({ go }: { go: ScreenProps['go'] }) {
  const { t } = useTranslation()
  return (
    <>
      <Tap
        tap="sheet-backdrop"
        onTap={() => go({ type: 'sheet', open: false })}
        className="ph-backdrop"
        label={t('remote.phone.decline')}
      >
        {null}
      </Tap>
      <div className="ph-sheet">
        <i className="ph-grabber" />
        <span className="ph-pill ph-pill-wait ph-pill-sm">{t('remote.phone.runCommand')}</span>
        <h2>{t('remote.phone.sheetTitle')}</h2>
        <p className="ph-sheet-meta">{t('remote.phone.sheetMeta')}</p>
        <code>pnpm test:e2e --project=chromium</code>
        <Tap tap="allow" onTap={() => go({ type: 'approve' })} className="ph-button">
          {t('remote.phone.allow')}
        </Tap>
        <Tap
          tap="decline"
          onTap={() => go({ type: 'sheet', open: false })}
          className="ph-button ph-button-outline"
        >
          {t('remote.phone.decline')}
        </Tap>
      </div>
    </>
  )
}

function DevicesScreen() {
  const { t } = useTranslation()
  return (
    <>
      <div className="ph-nav" />
      <h1 className="ph-large-title">{t('remote.phone.devices')}</h1>
      <p className="ph-section">{t('remote.phone.pairedMacs')}</p>
      <div className="ph-group">
        <div className="ph-group-row">
          <Glyph name="desktop" />
          <span>
            <strong>Mac mini</strong>
            <small>
              <i className="ph-dot ph-dot-ok" /> {t('remote.phone.online')}
            </small>
          </span>
          <Glyph name="check" size={18} />
        </div>
        <div className="ph-group-row ph-group-add">
          <Glyph name="plus" />
          <span>{t('remote.phone.addMac')}</span>
        </div>
      </div>
    </>
  )
}

function ConnectScreen({ go }: ScreenProps) {
  const { t } = useTranslation()
  return (
    <div className="ph-connect">
      <div className="ph-connect-owls">
        <Avatar owl="router" size={44} />
        <Avatar owl="claude-code" working size={44} />
        <Avatar owl="codex" working size={44} />
      </div>
      <h1>{t('remote.phone.connectTitle')}</h1>
      <p>{t('remote.phone.connectHelp')}</p>
      <Tap tap="scan" onTap={() => go({ type: 'scan' })} className="ph-button ph-button-big">
        <Glyph name="qr" />
        {t('remote.phone.scan')}
      </Tap>
      <small className="ph-field-label">{t('remote.phone.codeLabel')}</small>
      <span className="ph-field">{t('remote.phone.codePlaceholder')}</span>
      <p className="ph-lock">
        <Glyph name="lock" size={15} />
        {t('remote.phone.encrypted')}
      </p>
    </div>
  )
}

function ScannerScreen({ go }: ScreenProps) {
  const { t } = useTranslation()
  useEffect(() => {
    const timer = window.setTimeout(() => go({ type: 'scanned' }), SCAN_MS)
    return () => window.clearTimeout(timer)
  }, [go])
  return (
    <div className="ph-scanner">
      <div className="ph-viewfinder">
        <i />
        <i />
        <i />
        <i />
        <span className="ph-scan-qr" />
        <span className="ph-scan-line" />
      </div>
      <p>{t('remote.phone.scanHelp')}</p>
    </div>
  )
}

function PairedScreen({ go }: ScreenProps) {
  const { t } = useTranslation()
  return (
    <div className="ph-paired">
      <span className="ph-paired-icon">
        <Glyph name="shield" size={40} />
      </span>
      <h2>{t('remote.phone.pairedWith', { name: 'Mac mini' })}</h2>
      <p>{t('remote.phone.safetyHelp')}</p>
      <code>482 913</code>
      <small>{t('remote.phone.safetyWarn')}</small>
      <Tap tap="match" onTap={() => go({ type: 'paired' })} className="ph-button">
        {t('remote.phone.match')}
      </Tap>
    </div>
  )
}

function CurrentPage({ state, go }: ScreenProps) {
  if (state.pairing === 'connect') return <ConnectScreen state={state} go={go} />
  if (state.pairing === 'scanning') return <ScannerScreen state={state} go={go} />
  if (state.pairing === 'paired') return <PairedScreen state={state} go={go} />
  const page = state.tab === 'threads' ? state.stack.at(-1) : undefined
  if (page === 'worker') return <WorkerScreen state={state} go={go} />
  if (page === 'thread') return <ThreadScreen state={state} go={go} />
  if (state.tab === 'inbox') return <InboxScreen state={state} go={go} />
  if (state.tab === 'devices') return <DevicesScreen />
  return <ThreadsScreen state={state} go={go} />
}

function pageKey(state: State): string {
  return state.pairing ?? `${state.tab}/${state.stack.join('/')}`
}

/** The mock app in its phone, with the demo finger, and a way to replay the demo. */
export function PhoneShowcase({ pairing }: { pairing: boolean }) {
  const { t } = useTranslation()
  const [state, dispatch] = useReducer(reduce, pairing, initial)
  const [touring, setTouring] = useState(() => !prefersReducedMotion())
  const [run, setRun] = useState(0)
  const [finger, setFinger] = useState<{ x: number; y: number; tap: number } | null>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const go = useCallback((action: Action) => dispatch(action), [])

  // The steps beside the phone changed: start over from the right first screen.
  useEffect(() => {
    dispatch({ type: 'reset', pairing })
    setRun((n) => n + 1)
  }, [pairing])

  // `run` restarts the demo from its first step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `run` is the restart trigger.
  useEffect(() => {
    if (!touring) {
      setFinger(null)
      return
    }
    let stopped = false
    const steps = pairing ? PAIR_TOUR : APP_TOUR
    void (async () => {
      while (!stopped) {
        dispatch({ type: 'reset', pairing })
        for (const step of steps) {
          await sleep(step.wait ?? 1200)
          if (stopped) return
          const target = canvas.current?.querySelector<HTMLElement>(`[data-tap="${step.target}"]`)
          const box = canvas.current?.getBoundingClientRect()
          if (!target || !box) continue
          const rect = target.getBoundingClientRect()
          const scale = box.width / 390
          setFinger((current) => ({
            x: (rect.left + rect.width / 2 - box.left) / scale,
            y: (rect.top + rect.height / 2 - box.top) / scale,
            tap: current?.tap ?? 0
          }))
          await sleep(FINGER_MOVE_MS)
          if (stopped) return
          setFinger((current) => (current ? { ...current, tap: current.tap + 1 } : current))
          await sleep(160)
          if (stopped) return
          dispatch(step.action)
        }
        await sleep(TOUR_RESTART_MS)
      }
    })()
    return () => {
      stopped = true
    }
  }, [touring, pairing, run])

  return (
    <div className="ph-stage">
      <section
        className="ph-device-frame"
        aria-label={t('remote.phone.demoLabel')}
        // A real click takes over from the demo.
        onPointerDownCapture={(event) => {
          if (event.isTrusted && touring) setTouring(false)
        }}
      >
        <div className="ph-island" />
        <div className="ph-glass">
          <div className="ph-canvas" ref={canvas}>
            <StatusBar dark={state.pairing === 'scanning'} />
            <div className="ph-page" key={pageKey(state)} data-motion={state.motion}>
              <CurrentPage state={state} go={go} />
            </div>
            {state.pairing === null && state.stack.length === 0 ? (
              <TabBar state={state} go={go} />
            ) : null}
            {state.sheet && state.tab === 'inbox' ? <ApprovalSheet go={go} /> : null}
            {finger ? (
              <span
                className="ph-finger"
                style={{ transform: `translate(${finger.x}px, ${finger.y}px)` }}
              >
                <span
                  key={finger.tap}
                  className="ph-finger-dot"
                  data-tapped={finger.tap > 0 || undefined}
                />
              </span>
            ) : null}
          </div>
        </div>
      </section>
      <button
        type="button"
        className="ph-replay"
        onClick={() => {
          setTouring(true)
          setRun((n) => n + 1)
        }}
        data-touring={touring || undefined}
      >
        <span className="ph-replay-dot" />
        {t(touring ? 'remote.phone.demoPlaying' : 'remote.phone.demoReplay')}
      </button>
    </div>
  )
}
