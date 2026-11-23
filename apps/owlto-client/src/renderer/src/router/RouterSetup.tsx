import { Button } from '@renderer/components/ui/button'
import { SettingsIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import { type AgentProvider, type Failure, providerSchema, type Router } from '../../../shared/app'
import type { RouterEngineId } from '../../../shared/router'
import { agentConnection, isAgentReady, isAgentStarting, useAppStore } from '../app/store'
import { useViewingRemote } from '../remote/viewing'
import { ThreadRow } from './ThreadRow'

const SETUP_FAILURES = [
  'router_model_unconfigured',
  'model_unavailable',
  'router_unavailable',
  'claude_not_connected',
  'cursor_not_connected',
  'not_connected'
]
export const isSetupFailure = (failure: Failure) => SETUP_FAILURES.includes(failure.code)

type EngineAgent = Exclude<RouterEngineId, 'owlto'>
export type RouterSetupNeed =
  | { kind: 'owlto' | 'claude' | 'codex'; alternate: EngineAgent | null }
  /** No coding agent is connected, so no worker can run. */
  | { kind: 'worker'; alternate: null }

/** Agents that can run the Router; any provider can run workers. */
const ENGINE_AGENTS: EngineAgent[] = ['claude-code', 'codex']
/** The agent whose Settings tab resolves a need, or null for the Router page. */
function settingsAgentFor(need: RouterSetupNeed): AgentProvider | null {
  if (need.kind === 'worker') return providerSchema.options[0]
  if (need.kind === 'owlto') return null
  return need.kind === 'claude' ? 'claude-code' : 'codex'
}
/** What stands between the user and a working Router, or null when nothing does. */
export function useRouterSetup(router?: Router): RouterSetupNeed | null {
  const settings = useAppStore((s) => s.settings)
  const claude = useAppStore((s) => s.claude)
  const cursor = useAppStore((s) => s.cursor)
  const antigravity = useAppStore((s) => s.antigravity)
  const connection = useAppStore((s) => s.connection)
  // A paired device's Router runs on that device's settings, which stay there.
  const remote = useViewingRemote()
  if (remote) return null
  const ready = (provider: AgentProvider) =>
    isAgentReady(agentConnection({ claude, cursor, antigravity, connection }, provider))
  const engine = settings.router.engine
  const failed = Boolean(router?.error && isSetupFailure(router.error))
  const alternate = ENGINE_AGENTS.find((a) => a !== engine && ready(a)) ?? null
  if (engine === 'claude-code' && (!ready('claude-code') || failed))
    return { kind: 'claude', alternate }
  if (engine === 'codex' && (!ready('codex') || failed)) return { kind: 'codex', alternate }
  if (engine === 'owlto' && (!settings.router.owlto || failed)) return { kind: 'owlto', alternate }
  if (!providerSchema.options.some(ready)) return { kind: 'worker', alternate: null }
  return null
}
/**
 * The agent a setup need is still waiting on as it comes up, or null once nothing is: the
 * app reconnects agents as it starts, so a need for one of them is not settled yet.
 */
export function useStartingAgent(need: RouterSetupNeed | null): AgentProvider | null {
  return useAppStore((s) => {
    if (!need || need.kind === 'owlto') return null
    if (need.kind === 'worker')
      return providerSchema.options.find((p) => isAgentStarting(s, p)) ?? null
    const engine = need.kind === 'claude' ? 'claude-code' : 'codex'
    return isAgentStarting(s, engine) ? engine : null
  })
}
/** While the agent the Router needs comes up: the Router's owl wakes, nothing to do yet. */
export function RouterStarting({ agent }: { agent: AgentProvider }) {
  const { t } = useTranslation()
  return (
    <ThreadRow speaker="router" starting>
      <div className="router-starting" role="status">
        {t('router.starting', { agent: t(`agent.${agent}`) })}
      </div>
    </ThreadRow>
  )
}
const COPY = {
  owlto: { title: 'router.setupTitle', body: 'router.setupBody' },
  claude: { title: 'router.claudeSetupTitle', body: 'router.claudeSetupBody' },
  codex: { title: 'router.codexSetupTitle', body: 'router.codexSetupBody' },
  worker: { title: 'router.workerSetupTitle', body: 'router.workerSetupBody' }
} as const

/** What the Router still needs, for a thread already underway or a skipped guide. */
export function RouterSetupNotice({ need }: { need: RouterSetupNeed }) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const save = useAppStore((s) => s.saveSettings)
  const showRouterSettings = useAppStore((s) => s.showRouterSettings)
  const showAgentSettings = useAppStore((s) => s.showAgentSettings)
  const { alternate } = need
  const agent = t('agent.codex')
  function switchToAlternate() {
    if (need.alternate)
      void save({ ...settings, router: { ...settings.router, engine: need.alternate } })
  }
  return (
    <ThreadRow speaker="router">
      <div className="router-setup-notice">
        <strong>{t(COPY[need.kind].title, { agent })}</strong>
        <p>{t(COPY[need.kind].body, { agent })}</p>
        <div>
          {alternate ? (
            <Button size="sm" onClick={switchToAlternate}>
              {t('router.useAgent', { agent: t(`agent.${alternate}`) })}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={alternate ? 'outline' : 'default'}
            onClick={() => {
              const agent = settingsAgentFor(need)
              if (agent) showAgentSettings(agent)
              else showRouterSettings('router')
            }}
          >
            <SettingsIcon size={16} />
            {t('router.openSettings')}
          </Button>
        </div>
      </div>
    </ThreadRow>
  )
}
