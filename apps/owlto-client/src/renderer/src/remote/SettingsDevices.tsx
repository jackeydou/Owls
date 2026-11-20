import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { renderSVG } from 'uqr'
import type { Failure } from '../../../shared/app'
import {
  formatRemoteAddress,
  parseRelayCode,
  parseRemoteInvite,
  type RemoteClient,
  type RemoteDevice,
  type RemotePair,
  type RemotePaired,
  type RemoteRelayState,
  remotePairSchema
} from '../../../shared/remote'
import { failureMessage } from '../app/failures'
import { SettingRow } from '../app/SettingRow'
import { useRemoteStore, watchRemote } from './store'
import './remote.css'

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

function LastSeen({ at }: { at: string | null }) {
  const { t } = useTranslation()
  if (!at) return t('remote.neverSeen')
  return t('remote.lastSeen', {
    time: new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  })
}

/** The one-time code another device types, with how long it still works. */
function PairingCode() {
  const { t } = useTranslation()
  const pairing = useRemoteStore((s) => s.overview?.pairing ?? null)
  const startPairing = useRemoteStore((s) => s.startPairing)
  const cancelPairing = useRemoteStore((s) => s.cancelPairing)
  const now = useNow(pairing !== null)
  if (!pairing)
    return (
      <ActionButton size="sm" variant="outline" onAction={startPairing}>
        {t('remote.pairStart')}
      </ActionButton>
    )
  const left = Math.max(0, Math.round((Date.parse(pairing.expiresAt) - now) / 1000))
  const shown = `${pairing.code.slice(0, 4)}-${pairing.code.slice(4)}`
  return (
    <div className="remote-pairing-card">
      {pairing.invite ? (
        <PairingInvite invite={pairing.invite} relayCode={pairing.relayCode} />
      ) : null}
      <div className="remote-pairing">
        <span>{t(pairing.invite ? 'remote.pairSameNetwork' : 'remote.pairCodeLabel')}</span>
        <code>{shown}</code>
        <span>
          {t('remote.pairExpires', {
            time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
          })}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void cancelPairing()}>
          {t('remote.pairCancel')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Pairing from another network: a QR code to scan with the iPhone, a code to type on a
 * device that cannot scan, and the invite link to paste on another Mac.
 */
function PairingInvite({ invite, relayCode }: { invite: string; relayCode: string | null }) {
  const { t } = useTranslation()
  const svg = useMemo(() => renderSVG(invite, { border: 1 }), [invite])
  return (
    <div className="remote-invite">
      <div
        className="remote-qr"
        role="img"
        aria-label={t('remote.qrLabel')}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: uqr renders the QR code as an SVG string from the invite alone.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="remote-invite-text">
        <strong>{t('remote.qrHelp')}</strong>
        <span>{t('remote.relayCodeHelp')}</span>
        <code className="remote-relay-code">{relayCode ?? t('remote.relayCodeWaiting')}</code>
        <ActionButton
          size="sm"
          variant="outline"
          doneLabel={t('remote.inviteCopied')}
          onAction={async () => {
            await navigator.clipboard.writeText(invite)
            return 'done'
          }}
        >
          {t('remote.inviteCopy')}
        </ActionButton>
      </div>
    </div>
  )
}

/** The device that just paired, with the digits it should show too. */
function JustPaired() {
  const { t } = useTranslation()
  const paired = useRemoteStore((s) => s.overview?.justPaired ?? null)
  const dismiss = useRemoteStore((s) => s.dismissJustPaired)
  const revoke = useRemoteStore((s) => s.revokeClient)
  if (!paired) return null
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

function SafetyCode({ code }: { code: string }) {
  const { t } = useTranslation()
  return (
    <p className="remote-safety-code">
      <span className="sr-only">{t('remote.safetyLabel')}</span>
      <code>{`${code.slice(0, 3)} ${code.slice(3)}`}</code>
    </p>
  )
}

const RELAY_ERRORS = new Set(['relay_login', 'relay_quota', 'relay_replaced', 'relay_denied'])

/** The relay switch's status line: connected, connecting, or why it cannot connect. */
function RelayStatus({ relay }: { relay: RemoteRelayState }) {
  const { t } = useTranslation()
  if (relay.state === 'off') return null
  const state =
    relay.state === 'online' ? 'online' : relay.state === 'connecting' ? 'connecting' : 'offline'
  return (
    <p className="remote-relay-status">
      <i className={`remote-status remote-status-${state}`} aria-hidden />
      {relay.state === 'offline' && relay.error && RELAY_ERRORS.has(relay.error)
        ? t(`remote.relayError.${relay.error}`)
        : t(`remote.relay.${state}`)}
      {relay.state === 'offline' && relay.error && !RELAY_ERRORS.has(relay.error)
        ? ` (${relay.error})`
        : null}
    </p>
  )
}

function ClientRow({ client }: { client: RemoteClient }) {
  const { t } = useTranslation()
  const revoke = useRemoteStore((s) => s.revokeClient)
  return (
    <li className="remote-device-row">
      <i
        className={`remote-status remote-status-${client.connected ? 'online' : 'offline'}`}
        aria-hidden
      />
      <div>
        <strong>{client.name}</strong>
        <small>
          {client.connected ? t('remote.connected') : <LastSeen at={client.lastSeenAt} />}
        </small>
      </div>
      <ActionButton size="sm" variant="ghost" onAction={() => revoke(client.deviceId)}>
        {t('remote.revoke')}
      </ActionButton>
    </li>
  )
}

function DeviceRow({ device }: { device: RemoteDevice }) {
  const { t } = useTranslation()
  const remove = useRemoteStore((s) => s.removeDevice)
  return (
    <li className="remote-device-row">
      <i className={`remote-status remote-status-${device.status}`} aria-hidden />
      <div>
        <strong>{device.name}</strong>
        <small>
          {device.address ?? t('remote.viaRelayOnly')}
          {device.via === 'relay' ? ` · ${t('remote.viaRelay')}` : null} ·{' '}
          {device.status === 'offline' ? (
            <LastSeen at={device.lastSeenAt} />
          ) : (
            t(`remote.status.${device.status}`)
          )}
        </small>
      </div>
      <ActionButton size="sm" variant="ghost" onAction={() => remove(device.deviceId)}>
        {t('remote.remove')}
      </ActionButton>
    </li>
  )
}

/** Pairs with a device that shows a code: its address and the code, then Pair. */
function AddDevice() {
  const { t } = useTranslation()
  const pair = useRemoteStore((s) => s.pair)
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [paired, setPaired] = useState<RemotePaired | null>(null)
  // A pasted invite carries its own code and the way to reach the other Mac; a relay code
  // (`K7Q2-ABCD-EFGH`) finds it through the relay.
  const invite = parseRemoteInvite(address) ? address.trim() : null
  const relayCode = !invite && parseRelayCode(address) ? address.trim() : null
  const input: RemotePair = invite ? { invite } : relayCode ? { relayCode } : { address, code }
  const valid = remotePairSchema.safeParse(input).success
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid || pending) return
    setPending(true)
    setFailure(null)
    setPaired(null)
    const result = await pair(input)
    setPending(false)
    if ('failure' in result) {
      setFailure(result.failure)
      return
    }
    setPaired(result.paired)
    setAddress('')
    setCode('')
  }
  return (
    <form className="remote-add" onSubmit={(event) => void submit(event)}>
      <input
        className="router-input"
        aria-label={t('remote.addAddress')}
        placeholder={t('remote.addAddressPlaceholder')}
        autoComplete="off"
        spellCheck={false}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
      {invite || relayCode ? null : (
        <input
          className="router-input remote-add-code"
          aria-label={t('remote.addCode')}
          placeholder={t('remote.addCodePlaceholder')}
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      )}
      <Button type="submit" size="sm" disabled={!valid} pending={pending}>
        {t('remote.addSubmit')}
      </Button>
      {failure ? (
        <p className="remote-error" role="alert">
          {failureMessage(failure)}
        </p>
      ) : null}
      {paired ? (
        <div className="remote-just-paired" role="status">
          <p>{t('remote.pairedWith', { name: paired.name })}</p>
          <SafetyCode code={paired.safetyCode} />
          <p className="remote-safety-help">{t('remote.safetyHelpClient')}</p>
        </div>
      ) : null}
    </form>
  )
}

/**
 * Settings → Devices: let paired devices drive this Mac's Router, and pair with other
 * devices to drive theirs. Connections are direct (same network or Tailscale) for now.
 */
export function DevicesSettingsPane() {
  const { t } = useTranslation()
  const overview = useRemoteStore((s) => s.overview)
  const error = useRemoteStore((s) => s.error)
  const setAccess = useRemoteStore((s) => s.setAccess)
  const setRelay = useRemoteStore((s) => s.setRelay)
  const setKeepAwake = useRemoteStore((s) => s.setKeepAwake)
  const [switching, setSwitching] = useState(false)
  useEffect(() => watchRemote(), [])
  const listening = overview?.listening ?? false
  const addresses = (overview?.addresses ?? []).map((host) =>
    formatRemoteAddress({ host, port: overview?.port ?? 0 })
  )
  async function toggle(enabled: boolean) {
    setSwitching(true)
    await setAccess(enabled)
    setSwitching(false)
  }
  async function toggleRelay(enabled: boolean) {
    setSwitching(true)
    await setRelay(enabled)
    setSwitching(false)
  }
  return (
    <section className="owlto-settings-section remote-settings">
      <h2>{t('remote.title')}</h2>
      <p className="remote-intro">{t('remote.intro')}</p>
      <h3 className="remote-group">
        {t('remote.thisMacGroup', { name: overview?.deviceName ?? '' })}
      </h3>
      <SettingRow
        label={t('remote.access')}
        description={t('remote.accessHelp')}
        htmlFor="remote-access"
      >
        <Switch
          id="remote-access"
          checked={listening}
          disabled={switching || !overview}
          onCheckedChange={(checked) => void toggle(checked)}
        />
      </SettingRow>
      {overview?.listenError ? (
        <p className="remote-error" role="alert">
          {overview.listenError}
        </p>
      ) : null}
      {error ? (
        <p className="remote-error" role="alert">
          {failureMessage(error)}
        </p>
      ) : null}
      {listening && overview ? (
        <>
          <SettingRow
            label={t('remote.relayAccess')}
            description={t('remote.relayAccessHelp')}
            htmlFor="remote-relay"
            detail={<RelayStatus relay={overview.relay} />}
          >
            <Switch
              id="remote-relay"
              checked={overview.relay.enabled}
              disabled={switching}
              onCheckedChange={(checked) => void toggleRelay(checked)}
            />
          </SettingRow>
          <SettingRow
            label={t('remote.keepAwake')}
            description={t('remote.keepAwakeHelp')}
            htmlFor="remote-keep-awake"
          >
            <Switch
              id="remote-keep-awake"
              checked={overview.keepAwake.enabled}
              disabled={switching}
              onCheckedChange={(checked) => {
                setSwitching(true)
                void setKeepAwake(checked).finally(() => setSwitching(false))
              }}
            />
          </SettingRow>
          <SettingRow
            label={t('remote.addresses')}
            description={t('remote.addressesHelp')}
            labelId="remote-addresses"
          >
            <ul className="remote-addresses" aria-labelledby="remote-addresses">
              {addresses.length ? (
                addresses.map((address) => (
                  <li key={address}>
                    <code>{address}</code>
                  </li>
                ))
              ) : (
                <li>{t('remote.noAddress')}</li>
              )}
            </ul>
          </SettingRow>
          <SettingRow
            label={t('remote.pair')}
            description={t(overview.relay.enabled ? 'remote.pairHelpRelay' : 'remote.pairHelp')}
            detail={
              <>
                <PairingCode />
                <JustPaired />
              </>
            }
          />
        </>
      ) : null}
      {overview?.clients.length ? (
        <SettingRow
          label={t('remote.clients')}
          description={t('remote.clientsHelp')}
          detail={
            <ul className="remote-device-list">
              {overview.clients.map((client) => (
                <ClientRow key={client.deviceId} client={client} />
              ))}
            </ul>
          }
        />
      ) : null}
      <h3 className="remote-group">{t('remote.otherGroup')}</h3>
      <SettingRow
        label={t('remote.add')}
        description={t('remote.addHelp')}
        detail={<AddDevice />}
      />
      {overview?.devices.length ? (
        <SettingRow
          label={t('remote.devices')}
          description={t('remote.devicesHelp')}
          detail={
            <ul className="remote-device-list">
              {overview.devices.map((device) => (
                <DeviceRow key={device.deviceId} device={device} />
              ))}
            </ul>
          }
        />
      ) : null}
    </section>
  )
}
