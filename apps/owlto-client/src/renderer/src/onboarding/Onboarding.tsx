import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { ArrowLeftIcon, CheckIcon, SettingsIcon } from '@renderer/components/ui/icons'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AgentProvider, providerSchema } from '../../../shared/app'
import type { RouterEngineId } from '../../../shared/router'
import { failureMessage } from '../app/failures'
import { type AgentSpeaker, OwlAvatar } from '../app/OwlAvatar'
import { agentConnection, isAgentReady, useAppStore } from '../app/store'
import { AgentIcon } from '../router/AgentIcon'
import { OwltoModelFields } from '../router/RouterSettings'
import { OwlFlock } from './OwlFlock'
import type { OwlId } from './owl-art'
import { useOnboardingStore } from './store'
import './onboarding.css'

type Step = 'agents' | 'router' | 'done'
type EngineAgent = Exclude<RouterEngineId, 'owlto'>
/** Agents that can also run the Router. Cursor runs workers only. */
const ENGINE_AGENTS: EngineAgent[] = ['claude-code', 'codex']
const ENGINES: RouterEngineId[] = [...ENGINE_AGENTS, 'owlto']
const isAgent = (engine: RouterEngineId): engine is EngineAgent => engine !== 'owlto'

function useAgentReady(provider: AgentProvider) {
  return useAppStore((s) => isAgentReady(agentConnection(s, provider)))
}
/** Agents that are connected now, so their owls can hop the moment they connect. */
function useReadyAgents(): AgentProvider[] {
  const key = useAppStore((s) =>
    providerSchema.options.filter((p) => isAgentReady(agentConnection(s, p))).join(',')
  )
  return key ? (key.split(',') as AgentProvider[]) : []
}

function ConnectedMark() {
  const { t } = useTranslation()
  return (
    <span className="onb-connected">
      <CheckIcon size={14} />
      {t('onboarding.connected')}
    </span>
  )
}

/** Starts an agent's connection. Signing in and custom paths stay in Settings. */
function ConnectButton({ provider }: { provider: AgentProvider }) {
  const { t } = useTranslation()
  const status = useAppStore((s) => agentConnection(s, provider).status)
  const connect = useAppStore((s) =>
    provider === 'codex' ? s.connect : provider === 'cursor' ? s.connectCursor : s.connectClaude
  )
  return (
    <Button size="sm" pending={status === 'connecting'} onClick={() => void connect()}>
      {t('onboarding.connect')}
    </Button>
  )
}

function AgentCard({ provider }: { provider: AgentProvider }) {
  const { t } = useTranslation()
  const ready = useAgentReady(provider)
  const error = useAppStore((s) => agentConnection(s, provider).error)
  return (
    <li className="onb-card onb-agent" data-ready={ready || undefined}>
      <div className="onb-agent-head">
        <OwlAvatar speaker={provider} />
        <AgentIcon provider={provider} />
      </div>
      <strong>{t(`agent.${provider}`)}</strong>
      <p>{t(`onboarding.agentHelp.${provider}`)}</p>
      <div className="onb-agent-foot">
        {ready ? <ConnectedMark /> : <ConnectButton provider={provider} />}
      </div>
      {error && !ready ? (
        <p role="alert" className="onb-error">
          {failureMessage(error)}
        </p>
      ) : null}
    </li>
  )
}

function AgentsStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation()
  const ready = useReadyAgents()
  return (
    <>
      <ul className="onb-agents">
        {providerSchema.options.map((provider) => (
          <AgentCard key={provider} provider={provider} />
        ))}
      </ul>
      <footer className="onb-actions">
        <span className="onb-note">
          {ready.length
            ? t('onboarding.agentsReady', { count: ready.length })
            : t('onboarding.agentsLater')}
        </span>
        <Button className="onb-primary" onClick={onNext}>
          {t('onboarding.next')}
        </Button>
      </footer>
    </>
  )
}

function EngineOption({
  engine,
  selected,
  onSelect
}: {
  engine: RouterEngineId
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const ready = useAppStore((s) =>
    isAgent(engine) ? isAgentReady(agentConnection(s, engine)) : false
  )
  const speaker: AgentSpeaker = isAgent(engine) ? engine : 'router'
  return (
    <button
      type="button"
      className="onb-card onb-engine"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <OwlAvatar speaker={speaker} />
      <span className="onb-engine-text">
        <strong>{isAgent(engine) ? t(`agent.${engine}`) : t('routerSettings.engine.owlto')}</strong>
        <small>{t(`routerSettings.engineHelp.${engine}`)}</small>
      </span>
      {ready ? <ConnectedMark /> : null}
      <i className="onb-radio" aria-hidden="true" />
    </button>
  )
}

/** The Router's engine is picked here but saved only on Finish, so a skip leaves it alone. */
function RouterStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const save = useAppStore((s) => s.saveSettings)
  const readyAgents = useReadyAgents()
  const [chosen, setChosen] = useState<RouterEngineId | null>(() => {
    if (settings.router.engine !== 'owlto') return settings.router.engine
    return ENGINE_AGENTS.find((a) => readyAgents.includes(a)) ?? null
  })
  const chosenReady = useAppStore((s) =>
    chosen && isAgent(chosen) ? isAgentReady(agentConnection(s, chosen)) : false
  )
  async function finish() {
    if (!chosen || !isAgent(chosen)) return 'quiet'
    const { settings } = useAppStore.getState()
    await save({ ...settings, router: { ...settings.router, engine: chosen }, onboarding: 'done' })
    if (useAppStore.getState().settings.router.engine === chosen) onDone()
    return 'quiet'
  }
  return (
    <>
      <fieldset className="onb-engines" aria-label={t('onboarding.routerTitle')}>
        {ENGINES.map((engine) => (
          <EngineOption
            key={engine}
            engine={engine}
            selected={chosen === engine}
            onSelect={() => setChosen(engine)}
          />
        ))}
      </fieldset>
      {chosen && isAgent(chosen) && !chosenReady ? (
        <div className="onb-card onb-detail">
          <p>{t('onboarding.routerConnect', { agent: t(`agent.${chosen}`) })}</p>
          <ConnectButton provider={chosen} />
        </div>
      ) : null}
      {chosen === 'owlto' ? (
        <div className="onb-card onb-detail onb-owlto">
          <OwltoModelFields
            guided
            onGuidedSave={async (router) => {
              const { settings } = useAppStore.getState()
              await save({
                ...settings,
                router: { ...router, engine: 'owlto' },
                onboarding: 'done'
              })
              onDone()
            }}
          />
        </div>
      ) : null}
      <p className="onb-note onb-workers">{t('onboarding.workersDefault')}</p>
      <footer className="onb-actions">
        <Button variant="ghost" className="onb-back" onClick={onBack}>
          <ArrowLeftIcon size={16} />
          {t('onboarding.back')}
        </Button>
        {chosen === 'owlto' ? null : (
          <ActionButton className="onb-primary" disabled={!chosenReady} onAction={finish}>
            {t('onboarding.finish')}
          </ActionButton>
        )}
      </footer>
    </>
  )
}

function DoneStep({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const showSettings = useAppStore((s) => s.showSettings)
  return (
    <footer className="onb-actions onb-actions-center">
      <Button
        variant="outline"
        onClick={() => {
          onClose()
          showSettings('agents')
        }}
      >
        <SettingsIcon size={16} />
        {t('onboarding.openSettings')}
      </Button>
      <Button className="onb-primary" onClick={onClose}>
        {t('onboarding.start')}
      </Button>
    </footer>
  )
}

function SkipDialog({ onClose, onSkip }: { onClose: () => void; onSkip: () => Promise<void> }) {
  const { t } = useTranslation()
  const titleId = useId()
  return (
    <Dialog
      onClose={onClose}
      aria-labelledby={titleId}
      className="owlto-settings-dialog onb-skip-dialog"
    >
      <h2 id={titleId}>{t('onboarding.skipTitle')}</h2>
      <p>{t('onboarding.skipBody')}</p>
      <footer>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('onboarding.keepGoing')}
        </Button>
        <ActionButton
          size="sm"
          onAction={async () => {
            await onSkip()
            return 'quiet'
          }}
        >
          {t('onboarding.skip')}
        </ActionButton>
      </footer>
    </Dialog>
  )
}

const STEP_COPY: Record<Step, { title: string; body: string }> = {
  agents: { title: 'onboarding.agentsTitle', body: 'onboarding.agentsBody' },
  router: { title: 'onboarding.routerTitle', body: 'onboarding.routerBody' },
  done: { title: 'onboarding.doneTitle', body: 'onboarding.doneBody' }
}

function Steps({ step }: { step: Step }) {
  const { t } = useTranslation()
  const items: [Exclude<Step, 'done'>, string][] = [
    ['agents', t('onboarding.stepAgents')],
    ['router', t('onboarding.stepRouter')]
  ]
  const at = step === 'done' ? 2 : step === 'router' ? 1 : 0
  return (
    <ol
      className="onb-steps"
      aria-label={t('onboarding.progress', { step: Math.min(at + 1, 2), total: 2 })}
    >
      {items.map(([id, label], index) => (
        <li
          key={id}
          data-state={index < at ? 'done' : index === at ? 'current' : 'next'}
          aria-current={index === at ? 'step' : undefined}
        >
          <b>{index < at ? <CheckIcon size={13} /> : index + 1}</b>
          {label}
        </li>
      ))}
    </ol>
  )
}

/**
 * First run, full screen, in the style of the website hero: connect coding agents, then pick
 * who runs the Router. Workers keep their defaults. Skip leaves anything unfinished unsaved.
 */
export function Onboarding() {
  const { t } = useTranslation()
  const open = useOnboardingStore((s) => s.open)
  const hide = useOnboardingStore((s) => s.hide)
  const save = useAppStore((s) => s.saveSettings)
  const [step, setStep] = useState<Step>('agents')
  const [skipping, setSkipping] = useState(false)
  const ready = useReadyAgents()
  // Owls hop when their agent connects, and all of them at the end.
  const hop: OwlId[] =
    step === 'done' ? ['user', 'claude-code', 'router', 'codex', 'cursor'] : ready
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (open) setStep('agents')
  }, [open])
  // Each step, and each opening, moves focus to the title so screen readers read it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `step` and `open` are the triggers.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [step, open])
  if (!open) return null
  async function skip() {
    const { settings } = useAppStore.getState()
    if (settings.onboarding === 'pending') await save({ ...settings, onboarding: 'skipped' })
    setSkipping(false)
    hide()
  }
  const copy = STEP_COPY[step]
  let body: ReactNode
  if (step === 'agents') body = <AgentsStep onNext={() => setStep('router')} />
  else if (step === 'router')
    body = <RouterStep onBack={() => setStep('agents')} onDone={() => setStep('done')} />
  else body = <DoneStep onClose={hide} />
  return (
    <div className="onb" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <div className="onb-sky" aria-hidden="true">
        <i className="onb-moon" />
        <i className="onb-stars" />
        <i className="onb-stars onb-stars-b" />
      </div>
      <header className="onb-bar">
        {step === 'done' ? null : (
          <button type="button" className="onb-skip" onClick={() => setSkipping(true)}>
            {t('onboarding.skip')}
          </button>
        )}
      </header>
      <div className="onb-scroll">
        <section className="onb-content" key={step} data-step={step}>
          <p className="onb-kicker">{t('onboarding.kicker')}</p>
          <Steps step={step} />
          <h1 id="onb-title" ref={heading} tabIndex={-1}>
            {t(copy.title)}
          </h1>
          <p className="onb-sub">{t(copy.body)}</p>
          {body}
        </section>
        <OwlFlock hop={hop} />
        <p className="onb-hint" aria-hidden="true">
          {t('onboarding.hint')}
        </p>
      </div>
      {skipping ? <SkipDialog onClose={() => setSkipping(false)} onSkip={skip} /> : null}
    </div>
  )
}
