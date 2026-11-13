import { Button } from '@renderer/components/ui/button'
import { SettingsIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import { type AgentProvider, type Failure, providerSchema, type Router } from '../../../shared/app'
import type { RouterEngineId } from '../../../shared/router'
import { agentConnection, isAgentReady, type SettingsTab, useAppStore } from '../app/store'
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

type EngineAgent = Exclude<RouterEngineId, 'owls'>
export type RouterSetupNeed =
  | { kind: 'owls' | 'claude' | 'codex'; alternate: EngineAgent | null }
  | { kind: 'worker'; provider: AgentProvider; alternate: AgentProvider | null }

/** Agents that can run the Router; any provider can run workers. */
const ENGINE_AGENTS: EngineAgent[] = ['claude-code', 'codex']
/** The Settings tab that resolves a need. */
function settingsTabFor(need: RouterSetupNeed): SettingsTab {
  if (need.kind === 'worker') return need.provider
  if (need.kind === 'owls') return 'router'
  return need.kind === 'claude' ? 'claude-code' : 'codex'
}
/** What stands between the user and a working Router, or null when nothing does. */
export function useRouterSetup(router?: Router): RouterSetupNeed | null {
  const settings = useAppStore((s) => s.settings)
  const claude = useAppStore((s) => s.claude)
  const cursor = useAppStore((s) => s.cursor)
  const connection = useAppStore((s) => s.connection)
  const ready = (provider: AgentProvider) =>
    isAgentReady(agentConnection({ claude, cursor, connection }, provider))
  const engine = settings.router.engine
  const failed = Boolean(router?.error && isSetupFailure(router.error))
  const alternate = ENGINE_AGENTS.find((a) => a !== engine && ready(a)) ?? null
  if (engine === 'claude-code' && (!ready('claude-code') || failed))
    return { kind: 'claude', alternate }
  if (engine === 'codex' && (!ready('codex') || failed)) return { kind: 'codex', alternate }
  if (engine === 'owls' && (!settings.router.owls || failed)) return { kind: 'owls', alternate }
  const { provider } = settings
  if (!ready(provider))
    return {
      kind: 'worker',
      provider,
      alternate: providerSchema.options.find((a) => a !== provider && ready(a)) ?? null
    }
  return null
}
const COPY = {
  owls: { title: 'router.setupTitle', body: 'router.setupBody' },
  claude: { title: 'router.claudeSetupTitle', body: 'router.claudeSetupBody' },
  codex: { title: 'router.codexSetupTitle', body: 'router.codexSetupBody' },
  worker: { title: 'router.workerSetupTitle', body: 'router.workerSetupBody' }
} as const

/** What the Router still needs, for a thread already underway or a skipped guide. */
export function RouterSetupNotice({ need }: { need: RouterSetupNeed }) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const save = useAppStore((s) => s.saveSettings)
  const showSettings = useAppStore((s) => s.showSettings)
  const { alternate } = need
  const agent = t(`agent.${need.kind === 'worker' ? need.provider : 'codex'}`)
  function switchToAlternate() {
    if (need.kind === 'worker') {
      if (need.alternate) void save({ ...settings, provider: need.alternate })
    } else if (need.alternate)
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
            onClick={() => showSettings(settingsTabFor(need))}
          >
            <SettingsIcon size={16} />
            {t('router.openSettings')}
          </Button>
        </div>
      </div>
    </ThreadRow>
  )
}
