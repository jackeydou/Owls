import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  CheckIcon,
  ChevronDownIcon,
  HomeIcon,
  LockIcon,
  PowerIcon,
  RefreshIcon,
  SmartphoneIcon,
  XIcon
} from '@renderer/components/ui/icons'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger
} from '@renderer/components/ui/menu'
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  SimulatorAsk,
  SimulatorDevice,
  SimulatorInputMessage,
  SimulatorLease
} from '../../../shared/simulator'
import { hidUsageForCode } from '../../../shared/simulator-keys'
import { OwlAvatar } from '../app/OwlAvatar'
import { WorkingDots } from '../app/WorkingDots'
import { simulatorActions, useSimulatorStore } from './store'
import { useSimulatorStream } from './stream'
import '../browser/browser.css'
import './simulator.css'

function DeviceMenu({
  devices,
  active
}: {
  devices: SimulatorDevice[]
  active: SimulatorDevice | null
}) {
  const { t } = useTranslation()
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" className="simulator-device-trigger">
          <SmartphoneIcon size={15} />
          <span>{active ? active.name : t('simulator.pickDevice')}</span>
          {active ? <em>{active.runtime}</em> : null}
          <ChevronDownIcon size={13} />
        </Button>
      </MenuTrigger>
      <MenuContent align="start" className="simulator-device-menu">
        {devices.map((device) => (
          <MenuItem key={device.udid} onSelect={() => void simulatorActions.attach(device.udid)}>
            <span className="simulator-device-check">
              {device.udid === active?.udid ? <CheckIcon size={13} /> : null}
            </span>
            <span className="simulator-device-name">{device.name}</span>
            <em>
              {device.runtime} · {t(`simulator.${device.state}`)}
            </em>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => void simulatorActions.refresh()}>
          <RefreshIcon size={13} />
          {t('simulator.refresh')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

function Toolbar({
  devices,
  active,
  attached,
  send
}: {
  devices: SimulatorDevice[]
  active: SimulatorDevice | null
  attached: boolean
  send: (message: SimulatorInputMessage) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="browser-toolbar simulator-toolbar">
      <DeviceMenu devices={devices} active={active} />
      <span className="simulator-toolbar-gap" />
      <IconButton
        size="sm"
        label={t('simulator.home')}
        tooltip={`${t('simulator.home')} (⇧⌘H)`}
        tooltipSide="bottom"
        disabled={!attached}
        icon={<HomeIcon size={15} />}
        onClick={() => send({ type: 'button', name: 'home' })}
      />
      <IconButton
        size="sm"
        label={t('simulator.lock')}
        tooltip={`${t('simulator.lock')} (⌘L)`}
        tooltipSide="bottom"
        disabled={!attached}
        icon={<LockIcon size={14} />}
        onClick={() => send({ type: 'button', name: 'lock' })}
      />
      {active && attached ? (
        <IconButton
          size="sm"
          label={t('simulator.detach')}
          tooltip={t('simulator.detachHint')}
          tooltipSide="bottom"
          icon={<XIcon size={15} />}
          onClick={() => void simulatorActions.detach(active.udid)}
        />
      ) : null}
      {active && active.state === 'booted' ? (
        <IconButton
          size="sm"
          label={t('simulator.shutdownDevice')}
          tooltip={t('simulator.shutdownHint')}
          tooltipSide="bottom"
          icon={<PowerIcon size={15} />}
          onClick={() => void simulatorActions.shutdown(active.udid)}
        />
      ) : null}
    </div>
  )
}

function AskStrip({ ask, device }: { ask: SimulatorAsk; device: SimulatorDevice | null }) {
  const { t } = useTranslation()
  const values = { owner: ask.title, device: device?.name ?? '', detail: ask.detail }
  const answer = (value: 'allow' | 'deny') =>
    simulatorActions.answer({ askId: ask.id, answer: value })
  return (
    <div className="browser-status" data-control="ask" role="alert">
      <OwlAvatar speaker={ask.provider} />
      <p>
        <strong>{t(`simulator.ask.${ask.kind}`, values)}</strong>
        <span>{ask.kind === 'device' ? t('simulator.ask.deviceHint') : ask.detail}</span>
      </p>
      <div className="browser-ask-actions">
        <ActionButton variant="ghost" size="sm" onAction={() => answer('deny')}>
          {t('simulator.ask.deny')}
        </ActionButton>
        <ActionButton size="sm" onAction={() => answer('allow')}>
          {t('simulator.ask.allow')}
        </ActionButton>
      </div>
    </div>
  )
}

/** Who drives the device: the worker holding it, or nobody. */
function Status({ lease }: { lease: SimulatorLease | null }) {
  const { t } = useTranslation()
  if (!lease)
    return (
      <div className="browser-status" data-control="user" role="status">
        <span>{t('simulator.yours')}</span>
      </div>
    )
  const action = lease.action
  return (
    <div className="browser-status" data-control="agent" role="status">
      <strong>{lease.title}</strong>
      <span>{t('simulator.driving')}</span>
      {lease.busy ? <WorkingDots speaker={lease.provider} /> : null}
      {action ? (
        <em>
          {action.kind === 'launch'
            ? t('simulator.action.launch', { bundleId: action.bundleId })
            : t(`simulator.action.${action.kind}`)}
        </em>
      ) : null}
    </div>
  )
}

/** The live screen. Pointer drags become touches; keys go to the device while it has focus. */
function Screen({
  udid,
  lease,
  send,
  canvas,
  state,
  size,
  reconnect
}: {
  udid: string
  lease: SimulatorLease | null
  send: (message: SimulatorInputMessage) => void
  canvas: React.RefObject<HTMLCanvasElement | null>
  state: ReturnType<typeof useSimulatorStream>['state']
  size: { width: number; height: number } | null
  reconnect: () => void
}) {
  const { t } = useTranslation()
  const pressed = useRef(false)
  const frame = useRef(0)
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height
    }
  }
  const onKey = (event: KeyboardEvent<HTMLCanvasElement>, phase: 'down' | 'up') => {
    if (event.metaKey) {
      if (phase === 'down' && event.shiftKey && event.code === 'KeyH') {
        event.preventDefault()
        send({ type: 'button', name: 'home' })
      } else if (phase === 'down' && event.code === 'KeyL') {
        event.preventDefault()
        send({ type: 'button', name: 'lock' })
      }
      return
    }
    const usage = hidUsageForCode(event.code)
    if (usage === null || (phase === 'down' && event.repeat)) return
    event.preventDefault()
    send({ type: 'key', phase, usage })
  }
  const aspect = size ? `${size.width} / ${size.height}` : '9 / 19.5'
  return (
    <div
      className="simulator-screen-area"
      data-control={lease ? 'agent' : 'user'}
      data-speaker={lease?.provider}
    >
      <div className="simulator-device" style={{ aspectRatio: aspect }}>
        <canvas
          ref={canvas}
          key={udid}
          tabIndex={0}
          role="img"
          aria-label={t('simulator.screen')}
          aria-description={t('simulator.screenHint')}
          className="simulator-canvas"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            pressed.current = true
            send({ type: 'touch', phase: 'begin', ...point(event) })
          }}
          onPointerMove={(event) => {
            if (!pressed.current) return
            const at = point(event)
            cancelAnimationFrame(frame.current)
            frame.current = requestAnimationFrame(() =>
              send({ type: 'touch', phase: 'move', ...at })
            )
          }}
          onPointerUp={(event) => {
            if (!pressed.current) return
            pressed.current = false
            cancelAnimationFrame(frame.current)
            send({ type: 'touch', phase: 'end', ...point(event) })
          }}
          onPointerCancel={(event) => {
            if (!pressed.current) return
            pressed.current = false
            send({ type: 'touch', phase: 'end', ...point(event) })
          }}
          onKeyDown={(event) => onKey(event, 'down')}
          onKeyUp={(event) => onKey(event, 'up')}
        />
        {state !== 'live' ? (
          <div className="simulator-overlay" role="status">
            {state === 'connecting' ? <p>{t('simulator.connecting')}</p> : null}
            {state === 'unsupported' ? <p>{t('simulator.unsupportedStream')}</p> : null}
            {state === 'ended' ? (
              <>
                <p>{t('simulator.ended')}</p>
                <Button size="sm" variant="outline" onClick={reconnect}>
                  {t('simulator.reconnect')}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Empty({ devices }: { devices: SimulatorDevice[] }) {
  const { t } = useTranslation()
  const availability = useSimulatorStore((s) => s.availability)
  const loaded = useSimulatorStore((s) => s.loaded)
  if (!loaded) return null
  if (availability !== 'ready')
    return (
      <div className="browser-empty">
        <SmartphoneIcon size={22} />
        <p>{t(`simulator.unavailable.${availability}`)}</p>
        {availability !== 'unsupported' ? (
          <ActionButton variant="outline" size="sm" onAction={() => simulatorActions.refresh()}>
            {t('simulator.refresh')}
          </ActionButton>
        ) : null}
      </div>
    )
  const first = devices[0]
  return (
    <div className="browser-empty">
      <SmartphoneIcon size={22} />
      <p>{t('simulator.empty')}</p>
      {first ? (
        <ActionButton size="sm" onAction={() => simulatorActions.attach(first.udid)}>
          {t('simulator.attach')}
        </ActionButton>
      ) : null}
    </div>
  )
}

/** The right sidebar's iOS Simulator: the device menu, who drives it, and its live screen. */
export function SimulatorPane() {
  const { t } = useTranslation()
  const devices = useSimulatorStore((s) => s.devices)
  const activeUdid = useSimulatorStore((s) => s.activeUdid)
  const attachedList = useSimulatorStore((s) => s.attached)
  const leases = useSimulatorStore((s) => s.leases)
  const ask = useSimulatorStore((s) => s.ask)
  const active = devices.find((x) => x.udid === activeUdid) ?? null
  const attached = Boolean(activeUdid && attachedList.includes(activeUdid))
  const lease = activeUdid ? (leases[activeUdid] ?? null) : null
  const canvas = useRef<HTMLCanvasElement>(null)
  const [generation, setGeneration] = useState(0)
  const stream = useSimulatorStream(attached ? activeUdid : null, canvas, generation)
  const askDevice = ask ? (devices.find((x) => x.udid === ask.udid) ?? null) : null
  return (
    <section
      className="router-right-pane browser-pane simulator-pane"
      aria-label={t('router.panel.simulator')}
    >
      <Toolbar devices={devices} active={active} attached={attached} send={stream.send} />
      {ask ? <AskStrip ask={ask} device={askDevice} /> : attached ? <Status lease={lease} /> : null}
      {attached && activeUdid ? (
        <Screen
          udid={activeUdid}
          lease={lease}
          send={stream.send}
          canvas={canvas}
          state={stream.state}
          size={stream.size}
          reconnect={() => setGeneration((n) => n + 1)}
        />
      ) : (
        <Empty devices={devices} />
      )}
    </section>
  )
}
