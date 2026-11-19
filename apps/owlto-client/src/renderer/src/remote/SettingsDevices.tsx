import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Failure } from '../../../shared/app'
import {
  formatRemoteAddress,
  parseRemoteInvite,
  type RemoteClient,
  type RemoteDevice,
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
    <div className="remote-pairing">
      <span className="sr-only">{t('remote.pairCodeLabel')}</span>
      <code>{shown}</code>
      <span>
        {t('remote.pairExpires', {
          time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
        })}
      </span>
      <Button size="sm" variant="ghost" onClick={() => void cancelPairing()}>
        {t('remote.pairCancel')}
      </Button>
      {pairing.invite ? <PairingInvite invite={pairing.invite} /> : null}
    </div>
  )
}

/** The invite for a device on another network: copied here, pasted there. */
function PairingInvite({ invite }: { invite: string }) {
  const { t } = useTranslation()
  return (
    <div className="remote-invite">
      <span>{t('remote.inviteHelp')}</span>
      <span className="sr-only">{t('remote.inviteLabel')}</span>
      <code>{invite}</code>
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
  )
}

/** The relay switch's status line: connected, connecting, or why it cannot connect. */
function RelayStatus({ relay }: { relay: RemoteRelayState }) {
  const { t } = useTranslation()
  if (relay.state === 'off') return null
  const state =
    relay.state === 'online' ? 'online' : relay.state === 'connecting' ? 'connecting' : 'offline'
  return (
    <p className="remote-relay-status">
      <i className={`remote-status remote-status-${state}`} aria-hidden />
      {t(`remote.relay.${state}`)}
      {relay.state === 'offline' && relay.error ? ` (${relay.error})` : null}
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
  // A pasted invite carries its own code and the way to reach the other Mac.
  const invite = parseRemoteInvite(address) ? address.trim() : null
  const input = invite ? { invite } : { address, code }
  const valid = remotePairSchema.safeParse(input).success
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid || pending) return
    setPending(true)
    setFailure(null)
    const result = await pair(input)
    setPending(false)
    setFailure(result)
    if (!result) {
      setAddress('')
      setCode('')
    }
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
      {invite ? null : (
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
          <SettingRow label={t('remote.pair')} description={t('remote.pairHelp')}>
            <PairingCode />
          </SettingRow>
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
