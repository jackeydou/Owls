import { CheckIcon, ChevronDownIcon, LaptopIcon } from '@renderer/components/ui/icons'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger
} from '@renderer/components/ui/menu'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDevice } from '../../../shared/remote'
import { useAppStore } from '../app/store'
import { useFilesStore } from '../files/store'
import { REMOTE_ROUTER_ENABLED } from './enabled'
import { useRemoteStore, watchRemote } from './store'
import { useViewingStore } from './viewing'
import './remote.css'

function StatusDot({ status }: { status: RemoteDevice['status'] | 'local' }) {
  return <i className={`remote-status remote-status-${status}`} aria-hidden />
}

/**
 * Picks whose Router the window shows: this Mac or a paired device. Shown only once a
 * device is paired, so a single-Mac setup looks as it always did.
 */
export function DevicePicker() {
  const { t } = useTranslation()
  const overview = useRemoteStore((s) => s.overview)
  const viewing = useViewingStore((s) => s.deviceId)
  const viewDevice = useAppStore((s) => s.viewDevice)
  const showSettings = useAppStore((s) => s.showSettings)
  useEffect(() => watchRemote(), [])
  const devices = overview?.devices ?? []
  if (!REMOTE_ROUTER_ENABLED || !devices.length) return null
  const current = devices.find((d) => d.deviceId === viewing) ?? null
  const label = current ? current.name : t('remote.thisMac')
  const pick = (deviceId: string | null) => {
    // Open files belong to the device they were read from.
    useFilesStore.setState({ tabs: [], activeId: null })
    void viewDevice(deviceId)
  }
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="router-sidebar-item router-sidebar-action remote-device-picker"
          aria-label={t('remote.pickerLabel', { device: label })}
        >
          <LaptopIcon size={17} />
          <span>{label}</span>
          {current ? <StatusDot status={current.status} /> : null}
          <ChevronDownIcon size={14} className="remote-device-chevron" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="min-w-[220px]">
        <MenuLabel>{t('remote.pickerTitle')}</MenuLabel>
        <MenuItem onSelect={() => pick(null)}>
          <StatusDot status="local" />
          <span className="min-w-0 flex-1 truncate">
            {t('remote.thisMacNamed', { name: overview?.deviceName ?? '' })}
          </span>
          {viewing === null ? <CheckIcon size={14} /> : null}
        </MenuItem>
        {devices.map((device) => (
          <MenuItem key={device.deviceId} onSelect={() => pick(device.deviceId)}>
            <StatusDot status={device.status} />
            <span className="min-w-0 flex-1 truncate">{device.name}</span>
            <small className="remote-device-state">{t(`remote.status.${device.status}`)}</small>
            {viewing === device.deviceId ? <CheckIcon size={14} /> : null}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => showSettings('devices')}>{t('remote.manage')}</MenuItem>
      </MenuContent>
    </Menu>
  )
}
