import { Button } from '@renderer/components/ui/button'
import { CheckIcon } from '@renderer/components/ui/icons'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AgentProvider, providerSchema } from '../../../shared/app'
import type { RouterEngineId } from '../../../shared/router'
import { AppLogoMark } from '../app/AppLogo'
import { failureMessage } from '../app/failures'
import { agentConnection, isAgentReady, useAppStore } from '../app/store'
import { AgentIcon } from './AgentIcon'
import { OwlsModelFields } from './RouterSettings'
import type { RouterSetupNeed } from './RouterSetup'
import { useRouterStore } from './store'

type EngineAgent = Exclude<RouterEngineId, 'owls'>
/** Agents that can also run the Router. Cursor runs workers only: ACP cannot take Owls tools. */
const ENGINE_AGENTS: EngineAgent[] = ['claude-code', 'codex']
/** Agents first: most people already have one, and the built-in engine needs a key. */
const ENGINES: RouterEngineId[] = [...ENGINE_AGENTS, 'owls']
const isAgent = (engine: RouterEngineId): engine is EngineAgent => engine !== 'owls'

function useAgentReady(provider: AgentProvider) {
  return useAppStore((s) => isAgentReady(agentConnection(s, provider)))
}
function GuideOption({
  icon,
  title,
  body,
  selected,
  ready,
  onSelect
}: {
  icon: ReactNode
  title: string
  body: string
  selected: boolean
  ready: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="router-guide-option"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <i aria-hidden="true">{icon}</i>
      <span>
        <strong>{title}</strong>
        <small>{body}</small>
      </span>
      {ready ? (
        <em>
          <CheckIcon size={15} />
          {t('router.guideConnected')}
        </em>
      ) : null}
    </button>
  )
}
function AgentOption({
  provider,
  body,
  selected,
  onSelect
}: {
  provider: AgentProvider
  body: string
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const ready = useAgentReady(provider)
  return (
    <GuideOption
      icon={<AgentIcon provider={provider} />}
      title={t(`agent.${provider}`)}
      body={body}
      selected={selected}
      ready={ready}
      onSelect={onSelect}
    />
  )
}
/** Signing in and custom executables stay in Settings; the guide only starts the connection. */
function AgentConnect({ provider, body }: { provider: AgentProvider; body: string }) {
  const { t } = useTranslation()
  const connection = useAppStore((s) => agentConnection(s, provider))
  const connect = useAppStore((s) =>
    provider === 'codex' ? s.connect : provider === 'cursor' ? s.connectCursor : s.connectClaude
  )
  const showAgentSettings = useAppStore((s) => s.showAgentSettings)
  const busy = connection.status === 'connecting'
  return (
    <div className="router-guide-detail">
      <p>{body}</p>
      {connection.error ? (
        <div role="alert" className="owls-inline-error">
          {failureMessage(connection.error)}
        </div>
      ) : null}
      <div className="router-guide-actions">
        <Button size="sm" pending={busy} onClick={() => void connect()}>
          {t('router.guideConnect', { agent: t(`agent.${provider}`) })}
        </Button>
        <Button size="sm" variant="outline" onClick={() => showAgentSettings(provider)}>
          {t('router.openSettings')}
        </Button>
      </div>
    </div>
  )
}
function EngineStep() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const save = useAppStore((s) => s.saveSettings)
  const { engine } = settings.router
  // Owls is the default engine, not a choice yet: its form opens only when it is picked.
  const [chosen, setChosen] = useState<RouterEngineId | null>(engine === 'owls' ? null : engine)
  function select(next: RouterEngineId) {
    setChosen(next)
    if (next !== engine) void save({ ...settings, router: { ...settings.router, engine: next } })
  }
  return (
    <>
      <h2>{t('router.guideEngine')}</h2>
      <div className="router-guide-options">
        {ENGINES.map((option) =>
          isAgent(option) ? (
            <AgentOption
              key={option}
              provider={option}
              body={t(`routerSettings.engineHelp.${option}`)}
              selected={chosen === option}
              onSelect={() => select(option)}
            />
          ) : (
            <GuideOption
              key={option}
              icon={<AppLogoMark />}
              title={t(`routerSettings.engine.${option}`)}
              body={t(`routerSettings.engineHelp.${option}`)}
              selected={chosen === option}
              ready={false}
              onSelect={() => select(option)}
            />
          )
        )}
      </div>
      {chosen === 'owls' ? (
        <div className="router-guide-detail">
          <OwlsModelFields guided />
        </div>
      ) : chosen ? (
        <AgentConnect
          provider={chosen}
          body={t(chosen === 'codex' ? 'router.codexSetupBody' : 'router.claudeSetupBody')}
        />
      ) : null}
    </>
  )
}
function WorkerStep() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const save = useAppStore((s) => s.saveSettings)
  const { provider } = settings
  return (
    <>
      <h2>{t('router.guideWorker')}</h2>
      <div className="router-guide-options">
        {providerSchema.options.map((agent) => (
          <AgentOption
            key={agent}
            provider={agent}
            body={t('router.guideWorkerBody', { agent: t(`agent.${agent}`) })}
            selected={provider === agent}
            onSelect={() => void save({ ...settings, provider: agent })}
          />
        ))}
      </div>
      <AgentConnect
        provider={provider}
        body={t('router.workerSetupBody', { agent: t(`agent.${provider}`) })}
      />
    </>
  )
}
function GuidePage({
  step,
  total,
  children
}: {
  step: number
  total: number
  children: ReactNode
}) {
  const { t } = useTranslation()
  const skipGuide = useRouterStore((s) => s.skipGuide)
  return (
    <div className="owls-conversation-scroll">
      <div className="router-guide">
        <AppLogoMark />
        <h1>{t('router.guideWelcome')}</h1>
        <p>{t('router.guideBody')}</p>
        {total > 1 ? <small>{t('router.guideStep', { step, total })}</small> : null}
        {children}
        <button type="button" className="router-guide-skip" onClick={skipGuide}>
          {t('router.guideSkip')}
        </button>
      </div>
    </div>
  )
}
/** First run: what the Router needs, one step at a time. It ends when nothing is missing. */
export function RouterGuide({ need }: { need: RouterSetupNeed }) {
  const provider = useAppStore((s) => s.settings.provider)
  const workerReady = useAgentReady(provider)
  if (need.kind === 'worker')
    return (
      <GuidePage step={2} total={2}>
        <WorkerStep />
      </GuidePage>
    )
  return (
    <GuidePage step={1} total={workerReady ? 1 : 2}>
      <EngineStep />
    </GuidePage>
  )
}
