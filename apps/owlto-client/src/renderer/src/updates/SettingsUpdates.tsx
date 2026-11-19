import { ActionButton } from '@renderer/components/ui/action-button'
import { RefreshIcon, RotateCcwIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import type { TFunction } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type UpdateState, updateChannelSchema } from '../../../shared/updates'
import { SettingRow } from '../app/SettingRow'
import { useAppStore } from '../app/store'
import { checkForUpdates, installUpdate } from './update-actions'
import { useUpdateSnapshot } from './use-update-snapshot'
import './updates.css'

const clock = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

function statusText(state: UpdateState, t: TFunction): string {
  switch (state.status) {
    case 'unsupported':
      return t(`updates.unsupported.${state.reason}`)
    case 'idle':
    case 'checking':
      return t(`updates.state.${state.status}`)
    case 'up-to-date':
      return t('updates.state.up-to-date', { time: clock(state.checkedAt) })
    case 'downloading':
    case 'ready':
      return t(`updates.state.${state.status}`, { version: state.version })
    case 'failed':
      return t(`updates.failure.${state.failure}`)
  }
}

function UpdateAction({ state }: { state: UpdateState }) {
  const { t } = useTranslation()
  if (state.status === 'ready') {
    return (
      <ActionButton
        size="sm"
        icon={<RotateCcwIcon size={15} aria-hidden />}
        onAction={installUpdate}
      >
        {t('updates.install')}
      </ActionButton>
    )
  }
  return (
    <ActionButton
      size="sm"
      variant="outline"
      // A background check or download keeps the button busy too.
      pending={state.status === 'checking' || state.status === 'downloading'}
      icon={<RefreshIcon size={15} aria-hidden />}
      doneLabel={t('updates.upToDate')}
      failedLabel={t('updates.checkFailed')}
      onAction={checkForUpdates}
    >
      {t('updates.check')}
    </ActionButton>
  )
}

/** Clicks on the device id that reveal the update channel, each within this gap of the last. */
const REVEAL_CLICKS = 5
const REVEAL_GAP_MS = 800

/**
 * This device's id as one small centered line at the bottom of the page. Five quick clicks on it
 * reveal the hidden update channel setting.
 */
function DeviceIdFooter({ onReveal }: { onReveal: () => void }) {
  const { t } = useTranslation()
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const clicks = useRef({ count: 0, at: 0 })
  useEffect(() => {
    let active = true
    void window.owlto.deviceId().then((reply) => {
      if (active && reply.ok) setDeviceId(reply.value)
    })
    return () => {
      active = false
    }
  }, [])
  if (!deviceId) return null
  return (
    <footer className="owlto-device-id">
      <button
        type="button"
        onClick={() => {
          const now = Date.now()
          const next = now - clicks.current.at <= REVEAL_GAP_MS ? clicks.current.count + 1 : 1
          clicks.current = { count: next >= REVEAL_CLICKS ? 0 : next, at: now }
          if (next >= REVEAL_CLICKS) onReveal()
        }}
      >
        {t('updates.deviceId', { id: deviceId })}
      </button>
    </footer>
  )
}

export function SettingsUpdatesPane() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const snapshot = useUpdateSnapshot()
  const [revealed, setRevealed] = useState(false)
  // Hidden until revealed from the device id, but kept in view once the user is on beta.
  // A debug package always follows the debug feed, so it has no channel to pick.
  const channelVisible = snapshot?.channel !== 'debug' && (revealed || snapshot?.channel === 'beta')
  return (
    <section className="owlto-settings-section owlto-updates-section">
      <h2>{t('updates.title')}</h2>
      <p>{t('updates.body')}</p>
      {snapshot === undefined ? null : snapshot === null ? (
        <p role="alert">{t('updates.loadFailed')}</p>
      ) : (
        <>
          <SettingRow label={t('updates.version')}>
            <span>{t('updates.versionValue', { version: snapshot.currentVersion })}</span>
          </SettingRow>
          {snapshot.state.status === 'unsupported' ? (
            <SettingRow label={t('updates.status')} description={statusText(snapshot.state, t)} />
          ) : (
            <>
              {channelVisible ? (
                <SettingRow
                  label={t('updates.channel')}
                  description={t('updates.channelHelp')}
                  htmlFor="owlto-update-channel"
                >
                  <Select
                    id="owlto-update-channel"
                    value={snapshot.channel}
                    onChange={(event) =>
                      void saveSettings({
                        ...settings,
                        updateChannel: updateChannelSchema.parse(event.target.value)
                      })
                    }
                  >
                    {updateChannelSchema.options.map((channel) => (
                      <option value={channel} key={channel}>
                        {t(`updates.channel.${channel}`)}
                      </option>
                    ))}
                  </Select>
                </SettingRow>
              ) : null}
              <SettingRow
                label={t('updates.status')}
                description={
                  // Re-keyed per result, so even an unchanged sentence visibly refreshes.
                  <span
                    role="status"
                    className="owlto-status-refresh"
                    key={`${snapshot.state.status}-${'checkedAt' in snapshot.state ? snapshot.state.checkedAt : ''}`}
                  >
                    {statusText(snapshot.state, t)}
                  </span>
                }
              >
                <UpdateAction state={snapshot.state} />
              </SettingRow>
            </>
          )}
        </>
      )}
      {__OWLTO_ANALYTICS__ ? (
        <SettingRow
          label={t('updates.usageData')}
          htmlFor="owlto-usage-data"
          description={t('updates.usageDataBody')}
        >
          <Switch
            id="owlto-usage-data"
            checked={settings.usageData}
            onCheckedChange={(usageData) => void saveSettings({ ...settings, usageData })}
          />
        </SettingRow>
      ) : null}
      <DeviceIdFooter onReveal={() => setRevealed(true)} />
    </section>
  )
}
