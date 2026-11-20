import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LoaderIcon,
  NetworkIcon,
  RefreshIcon
} from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { renderSVG } from 'uqr'
import {
  formatRemoteAddress,
  formatRemoteInvite,
  type RemoteJustPaired,
  type RemoteOverview
} from '../../../shared/remote'
import { PhoneShowcase } from './PhoneShowcase'
import { useRemoteStore } from './store'

/**
 * Where the phone app installs from. The App Store listing does not exist yet, so this is
 * the website's page for it, which can point at TestFlight or the listing once there is one.
 */
export const OWLTO_IOS_INSTALL_URL = 'https://owlto.dev/ios/'

type Step = 'install' | 'pair'
type Platform = 'ios' | 'android'
/** How the phone reaches this Mac: through the relay from anywhere, or on this network. */
type Route = 'relay' | 'lan'

export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

function QrCode({ value, label }: { value: string; label: string }) {
  const svg = useMemo(() => renderSVG(value, { border: 1 }), [value])
  return (
    <div
      className="remote-qr"
      role="img"
      aria-label={label}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: uqr renders the QR code as an SVG string from the value alone.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/** The square a QR code would fill, holding a status or an action while there is none. */
function QrPlaceholder({ children }: { children: ReactNode }) {
  return <div className="remote-qr remote-qr-empty">{children}</div>
}

export function SafetyCode({ code }: { code: string }) {
  const { t } = useTranslation()
  return (
    <p className="remote-safety-code">
      <span className="sr-only">{t('remote.safetyLabel')}</span>
      <code>{`${code.slice(0, 3)} ${code.slice(3)}`}</code>
    </p>
  )
}

/** The device that just paired, with the digits it should show too. */
function JustPaired({ paired }: { paired: RemoteJustPaired }) {
  const { t } = useTranslation()
  const dismiss = useRemoteStore((s) => s.dismissJustPaired)
  const revoke = useRemoteStore((s) => s.revokeClient)
  return (
    <div className="remote-just-paired" role="status">
      <p>{t('remote.justPaired', { name: paired.name })}</p>
      <SafetyCode code={paired.safetyCode} />
      <p className="remote-safety-help">{t('remote.safetyHelpHost')}</p>
      <div className="remote-just-paired-actions">
        <Button size="sm" variant="outline" onClick={() => void dismiss()}>
          {t('remote.safetyMatch')}
        </Button>
        <ActionButton size="sm" variant="ghost" onAction={() => revoke(paired.deviceId)}>
          {t('remote.safetyMismatch')}
        </ActionButton>
      </div>
    </div>
  )
}

function StepHead({ step, title, help }: { step: 1 | 2; title: string; help: string }) {
  const { t } = useTranslation()
  return (
    <header className="remote-step-head">
      <span>{t('remote.wizard.step', { step, total: 2 })}</span>
      <h3>{title}</h3>
      <p>{help}</p>
    </header>
  )
}

/** Step 1: get Owlto on the phone. Only iOS for now; Android says it is coming. */
function InstallStep({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation()
  const [platform, setPlatform] = useState<Platform>('ios')
  return (
    <>
      <StepHead
        step={1}
        title={t('remote.wizard.installTitle')}
        help={t('remote.wizard.installHelp')}
      />
      <div className="remote-tabs" role="tablist" aria-label={t('remote.wizard.platform')}>
        {(['ios', 'android'] as const).map((each) => (
          <button
            key={each}
            type="button"
            role="tab"
            aria-selected={platform === each}
            className="remote-tab"
            onClick={() => setPlatform(each)}
          >
            {t(`remote.wizard.platform.${each}`)}
          </button>
        ))}
      </div>
      {platform === 'ios' ? (
        <div className="remote-step-body">
          <QrCode value={OWLTO_IOS_INSTALL_URL} label={t('remote.wizard.installQr')} />
          <div className="remote-step-actions">
            <p>{t('remote.wizard.installScan')}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(OWLTO_IOS_INSTALL_URL, '_blank')}
            >
              <ExternalLinkIcon />
              {t('remote.wizard.openAppStore')}
            </Button>
            <ActionButton
              size="sm"
              variant="ghost"
              doneLabel={t('remote.inviteCopied')}
              onAction={async () => {
                await navigator.clipboard.writeText(OWLTO_IOS_INSTALL_URL)
                return 'done'
              }}
            >
              <CopyIcon />
              {t('remote.wizard.copyInstallLink')}
            </ActionButton>
          </div>
        </div>
      ) : (
        <div className="remote-step-body">
          <QrPlaceholder>{t('remote.wizard.androidSoon')}</QrPlaceholder>
          <div className="remote-step-actions">
            <p>{t('remote.wizard.androidHelp')}</p>
          </div>
        </div>
      )}
      <footer className="remote-step-foot">
        <span />
        <Button size="sm" onClick={onContinue}>
          {t('remote.wizard.continue')}
          <ArrowRightIcon />
        </Button>
      </footer>
    </>
  )
}

function RouteChoice({
  route,
  value,
  icon,
  onPick
}: {
  route: Route
  value: Route
  icon: ReactNode
  onPick: (route: Route) => void
}) {
  const { t } = useTranslation()
  return (
    <label className="remote-route" data-checked={route === value || undefined}>
      <input
        type="radio"
        name="remote-route"
        value={value}
        checked={route === value}
        onChange={() => onPick(value)}
      />
      <span className="remote-route-icon">{icon}</span>
      <span className="remote-route-text">
        <strong>{t(`remote.wizard.route.${value}`)}</strong>
        <small>{t(`remote.wizard.route.${value}Help`)}</small>
      </span>
    </label>
  )
}

/**
 * Step 2: show a QR code for the phone to scan. Relay works from any network once this Mac
 * is signed in; the same-network code goes straight to one of this Mac's addresses.
 */
function PairStep({
  overview,
  onBack,
  relayAccount,
  onRelayAccountShown
}: {
  overview: RemoteOverview
  onBack: () => void
  /** The relay sign-in, shown while Relay is picked and the relay is not connected yet. */
  relayAccount: ReactNode
  onRelayAccountShown: (shown: boolean) => void
}) {
  const { t } = useTranslation()
  const setAccess = useRemoteStore((s) => s.setAccess)
  const setRelay = useRemoteStore((s) => s.setRelay)
  const startPairing = useRemoteStore((s) => s.startPairing)
  const [route, setRoute] = useState<Route>(() => (overview.relay.enabled ? 'relay' : 'lan'))
  const [address, setAddress] = useState<string | null>(null)
  const { pairing, relay, justPaired } = overview
  const now = useNow(pairing !== null)
  const addresses = overview.addresses.map((host) =>
    formatRemoteAddress({ host, port: overview.port })
  )
  const shownAddress = address && addresses.includes(address) ? address : (addresses[0] ?? null)

  // Showing this step means pairing a phone now: turn access on and show a code.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      if (!useRemoteStore.getState().overview?.listening) await setAccess(true)
      const state = useRemoteStore.getState().overview
      if (state?.listening && !state.pairing) await startPairing()
    })()
  }, [setAccess, startPairing])

  // A code shown before the relay connected has no relay invite; show a new one once it has.
  const relayOnline = relay.state === 'online'
  const needsInvite = route === 'relay' && relayOnline && pairing !== null && !pairing.invite
  useEffect(() => {
    if (needsInvite) void startPairing()
  }, [needsInvite, startPairing])

  const showsAccount = route === 'relay' && !relayOnline && relay.account.status !== 'signed-in'
  useEffect(() => {
    onRelayAccountShown(showsAccount)
    return () => onRelayAccountShown(false)
  }, [showsAccount, onRelayAccountShown])

  function pick(next: Route) {
    setRoute(next)
    if (next === 'relay' && !relay.enabled && !relay.signInToEnable) void setRelay(true)
  }

  const lanInvite =
    pairing?.key && shownAddress
      ? formatRemoteInvite({ host: shownAddress, code: pairing.code, key: pairing.key })
      : null
  const invite = route === 'relay' ? (pairing?.invite ?? null) : lanInvite
  const left = pairing ? Math.max(0, Math.round((Date.parse(pairing.expiresAt) - now) / 1000)) : 0
  const shortCode = pairing ? `${pairing.code.slice(0, 4)}-${pairing.code.slice(4)}` : null

  const showsQr =
    !justPaired &&
    overview.listening &&
    pairing !== null &&
    invite !== null &&
    !(route === 'relay' && !relayOnline)
  let qr: ReactNode
  if (justPaired) qr = null
  else if (!overview.listening)
    qr = (
      <QrPlaceholder>
        {overview.listenError ?? <LoaderIcon className="animate-spin" />}
      </QrPlaceholder>
    )
  else if (!pairing)
    qr = (
      <QrPlaceholder>
        <ActionButton size="sm" variant="outline" onAction={startPairing}>
          {t('remote.wizard.newCode')}
        </ActionButton>
      </QrPlaceholder>
    )
  else if (route === 'relay' && !relayOnline)
    qr = (
      <QrPlaceholder>
        {relay.enabled && relay.account.status === 'signed-in' ? (
          <>
            <LoaderIcon className="animate-spin" />
            {t('remote.relay.connecting')}
          </>
        ) : (
          t('remote.wizard.relaySignIn')
        )}
      </QrPlaceholder>
    )
  else if (route === 'lan' && !lanInvite)
    qr = <QrPlaceholder>{t('remote.noAddress')}</QrPlaceholder>
  else if (invite) qr = <QrCode value={invite} label={t('remote.qrLabel')} />
  else
    qr = (
      <QrPlaceholder>
        <LoaderIcon className="animate-spin" />
      </QrPlaceholder>
    )

  // What to type on a phone or Mac that cannot scan.
  const typed =
    route === 'relay' ? (pairing?.relayCode ?? null) : shownAddress && shortCode ? shortCode : null

  return (
    <>
      <StepHead step={2} title={t('remote.wizard.pairTitle')} help={t('remote.wizard.pairHelp')} />
      <div className="remote-step-body">
        <div className="remote-step-qr">
          {justPaired ? <JustPaired paired={justPaired} /> : qr}
          {showsQr ? (
            <div className="remote-step-qr-meta">
              <span>
                {t('remote.pairExpires', {
                  time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
                })}
              </span>
              <ActionButton size="sm" variant="ghost" onAction={startPairing}>
                <RefreshIcon />
                {t('remote.wizard.regenerate')}
              </ActionButton>
            </div>
          ) : null}
        </div>
        <div className="remote-step-actions">
          <div
            className="remote-routes"
            role="radiogroup"
            aria-label={t('remote.wizard.routeLabel')}
          >
            <RouteChoice route={route} value="relay" icon={<GlobeIcon size={18} />} onPick={pick} />
            <RouteChoice route={route} value="lan" icon={<NetworkIcon size={18} />} onPick={pick} />
          </div>
          {route === 'lan' && addresses.length > 1 ? (
            <div className="remote-network">
              <label htmlFor="remote-network">{t('remote.wizard.network')}</label>
              <Select
                id="remote-network"
                value={shownAddress ?? ''}
                onChange={(event) => setAddress(event.target.value)}
              >
                {addresses.map((each) => (
                  <option key={each} value={each}>
                    {each}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {showsAccount ? relayAccount : null}
        </div>
      </div>
      {typed && showsQr ? (
        <div className="remote-cant-scan">
          <span>{t('remote.wizard.cantScan')}</span>
          {route === 'lan' && shownAddress ? <code>{shownAddress}</code> : null}
          <code>{typed}</code>
          <ActionButton
            size="sm"
            variant="ghost"
            doneLabel={t('remote.inviteCopied')}
            onAction={async () => {
              await navigator.clipboard.writeText(typed)
              return 'done'
            }}
          >
            <CopyIcon />
            {t('remote.wizard.copyCode')}
          </ActionButton>
        </div>
      ) : null}
      <footer className="remote-step-foot">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeftIcon />
          {t('remote.wizard.back')}
        </Button>
      </footer>
    </>
  )
}

/** Pair a phone with this Mac: install the app, then scan a code. */
export function PairWizard({
  overview,
  relayAccount,
  onRelayAccountShown
}: {
  overview: RemoteOverview
  /** The relay sign-in panel; the wizard shows it while Relay is picked and not connected. */
  relayAccount: ReactNode
  /** Whether the wizard shows `relayAccount` now, so the page does not show it twice. */
  onRelayAccountShown: (shown: boolean) => void
}) {
  const [step, setStep] = useState<Step>('install')
  return (
    <div className="remote-wizard">
      <div className="remote-wizard-card">
        {step === 'install' ? (
          <InstallStep onContinue={() => setStep('pair')} />
        ) : (
          <PairStep
            overview={overview}
            onBack={() => setStep('install')}
            relayAccount={relayAccount}
            onRelayAccountShown={onRelayAccountShown}
          />
        )}
      </div>
      <PhoneShowcase pairing={step === 'pair'} />
    </div>
  )
}
