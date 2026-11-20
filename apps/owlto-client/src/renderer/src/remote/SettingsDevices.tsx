import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { LoaderIcon } from '@renderer/components/ui/icons'
import { Switch } from '@renderer/components/ui/switch'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Failure } from '../../../shared/app'
import {
  formatRemoteAddress,
  parseRelayCode,
  parseRemoteInvite,
  REMOTE_RELAY_PROVIDERS,
  type RemoteClient,
  type RemoteDevice,
  type RemotePair,
  type RemotePaired,
  type RemoteRelayAccount,
  type RemoteRelayMac,
  type RemoteRelayState,
  remotePairSchema
} from '../../../shared/remote'
import { failureMessage } from '../app/failures'
import { SettingRow } from '../app/SettingRow'
import { AsciiBackdrop } from './AsciiBackdrop'
import { PairWizard, SafetyCode } from './PairWizard'
import { useRemoteStore, watchRemote } from './store'
import './remote.css'

function LastSeen({ at }: { at: string | null }) {
  const { t } = useTranslation()
  if (!at) return t('remote.neverSeen')
  return t('remote.lastSeen', {
    time: new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  })
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

/**
 * The relay account: a host signs in once, with one of the identity providers, so the relay
 * knows the Mac is the user's. Turning the relay on asks for it. Shows the device code while signing in, and the account's Macs after.
 */
function RelayAccountPanel({
  account,
  waiting
}: {
  account: RemoteRelayAccount
  /** The switch was turned on while signed out; the relay starts after the sign-in. */
  waiting: boolean
}) {
  const { t } = useTranslation()
  const signIn = useRemoteStore((s) => s.relaySignIn)
  const cancel = useRemoteStore((s) => s.relayCancelSignIn)
  const signOut = useRemoteStore((s) => s.relaySignOut)
  if (account.status === 'pending') {
    const openGitHub = () => {
      // The code is on screen as well, so a blocked clipboard costs one more step.
      void navigator.clipboard.writeText(account.userCode).catch(() => {})
      window.open(account.verificationUri, '_blank')
    }
    return (
      <div className="remote-relay-account">
        <p>{t('remote.account.pendingHelp')}</p>
        <div className="github-device">
          <code>{account.userCode}</code>
          <LoaderIcon size={17} className="animate-spin" aria-label={t('remote.account.waiting')} />
          <Button size="sm" onClick={openGitHub}>
            {t('remote.account.copyAndOpen')}
          </Button>
          <ActionButton size="sm" variant="ghost" onAction={cancel}>
            {t('remote.pairCancel')}
          </ActionButton>
        </div>
      </div>
    )
  }
  if (account.status === 'signed-out')
    return (
      <div className="remote-relay-account">
        <p>{t(waiting ? 'remote.account.signInToEnable' : 'remote.account.signedOutHelp')}</p>
        {account.failure ? (
          <p className="remote-error" role="alert">
            {t(`remote.account.failure.${account.failure}`)}
          </p>
        ) : null}
        <div className="remote-relay-providers">
          {REMOTE_RELAY_PROVIDERS.map((provider) => (
            <ActionButton key={provider} size="sm" onAction={() => signIn(provider)}>
              {t(`remote.account.signInWith.${provider}`)}
            </ActionButton>
          ))}
        </div>
      </div>
    )
  return (
    <div className="remote-relay-account">
      <div className="remote-relay-login">
        <span>
          {t('remote.account.signedInAs', {
            login: account.login,
            provider: t(`remote.account.provider.${account.provider}`)
          })}
        </span>
        <ActionButton size="sm" variant="ghost" onAction={signOut}>
          {t('remote.account.signOut')}
        </ActionButton>
      </div>
      <RelayMacs />
    </div>
  )
}

/** The Macs on the relay account, each removable; removing one cuts it off at once. */
function RelayMacs() {
  const { t } = useTranslation()
  const macs = useRemoteStore((s) => s.relayMacs)
  const failure = useRemoteStore((s) => s.relayMacsError)
  const load = useRemoteStore((s) => s.loadRelayMacs)
  useEffect(() => {
    void load()
  }, [load])
  return (
    <>
      <p className="remote-relay-macs-label">{t('remote.account.macs')}</p>
      {failure ? (
        <p className="remote-error" role="alert">
          {failureMessage(failure)}
        </p>
      ) : null}
      {macs ? (
        <ul className="remote-device-list">
          {macs.map((mac) => (
            <RelayMacRow key={mac.mailbox} mac={mac} />
          ))}
        </ul>
      ) : null}
    </>
  )
}

function RelayMacRow({ mac }: { mac: RemoteRelayMac }) {
  const { t } = useTranslation()
  const remove = useRemoteStore((s) => s.relayRemoveMac)
  const name = mac.name || t('remote.account.unnamedMac')
  return (
    <li className="remote-device-row">
      <i
        className={`remote-status remote-status-${mac.online ? 'online' : 'offline'}`}
        aria-hidden
      />
      <div>
        <strong>{mac.thisMac ? t('remote.thisMacNamed', { name }) : name}</strong>
        <small>
          {mac.online ? (
            t('remote.status.online')
          ) : (
            <LastSeen
              at={mac.lastHostAt === null ? null : new Date(mac.lastHostAt).toISOString()}
            />
          )}
        </small>
      </div>
      <ActionButton size="sm" variant="ghost" onAction={() => remove(mac.mailbox)}>
        {t('remote.remove')}
      </ActionButton>
    </li>
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
  const [wizardShowsAccount, setWizardShowsAccount] = useState(false)
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
      <AsciiBackdrop />
      <h2>{t('remote.title')}</h2>
      <p className="remote-intro">{t('remote.intro')}</p>
      {overview ? (
        <PairWizard
          overview={overview}
          onRelayAccountShown={setWizardShowsAccount}
          relayAccount={
            <RelayAccountPanel
              account={overview.relay.account}
              waiting={overview.relay.signInToEnable}
            />
          }
        />
      ) : null}
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
            detail={
              <>
                <RelayStatus relay={overview.relay} />
                {(overview.relay.enabled || overview.relay.signInToEnable) &&
                !wizardShowsAccount ? (
                  <RelayAccountPanel
                    account={overview.relay.account}
                    waiting={overview.relay.signInToEnable}
                  />
                ) : null}
              </>
            }
          >
            <Switch
              id="remote-relay"
              checked={overview.relay.enabled || overview.relay.signInToEnable}
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
