import { Button } from '@renderer/components/ui/button'
import { FolderOpen, Network, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentProvider, CodexFailure, CodexRouter } from '../../../shared/codex'
import { agentConnection, isAgentReady, useCodexStore } from '../codex/store'

const SETUP_FAILURES = [
  'router_model_unconfigured',
  'model_unavailable',
  'router_unavailable',
  'claude_not_connected',
  'not_connected'
]
export const isSetupFailure = (failure: CodexFailure) => SETUP_FAILURES.includes(failure.code)

export type RouterSetupNeed =
  | { kind: 'owls' | 'claude' | 'codex'; alternate: AgentProvider | null }
  | { kind: 'worker'; provider: AgentProvider; alternate: AgentProvider | null }

const AGENTS: AgentProvider[] = ['claude-code', 'codex']
/** What stands between the user and a working Router, or null when nothing does. */
export function useRouterSetup(router?: CodexRouter): RouterSetupNeed | null {
  const settings = useCodexStore((s) => s.settings)
  const claude = useCodexStore((s) => s.claude)
  const connection = useCodexStore((s) => s.connection)
  const ready = (provider: AgentProvider) =>
    isAgentReady(agentConnection({ claude, connection }, provider))
  const engine = settings.router.engine
  const failed = Boolean(router?.error && isSetupFailure(router.error))
  const alternate = AGENTS.find((a) => a !== engine && ready(a)) ?? null
  if (engine === 'claude-code' && (!ready('claude-code') || failed))
    return { kind: 'claude', alternate }
  if (engine === 'codex' && (!ready('codex') || failed)) return { kind: 'codex', alternate }
  if (engine === 'owls' && (!settings.router.owls || failed)) return { kind: 'owls', alternate }
  const { provider } = settings
  if (!ready(provider))
    return { kind: 'worker', provider, alternate: AGENTS.find((a) => ready(a)) ?? null }
  return null
}
const COPY = {
  owls: { title: 'router.setupTitle', body: 'router.setupBody' },
  claude: { title: 'router.claudeSetupTitle', body: 'router.claudeSetupBody' },
  codex: { title: 'router.codexSetupTitle', body: 'router.codexSetupBody' },
  worker: { title: 'router.workerSetupTitle', body: 'router.workerSetupBody' }
} as const

export function RouterSetupCard({ need }: { need: RouterSetupNeed }) {
  const { t } = useTranslation()
  const settings = useCodexStore((s) => s.settings)
  const save = useCodexStore((s) => s.saveSettings)
  const showSettings = useCodexStore((s) => s.showSettings)
  const { alternate } = need
  const agent = t(`agent.${need.kind === 'worker' ? need.provider : 'codex'}`)
  function switchTo(provider: AgentProvider) {
    void save(
      need.kind === 'worker'
        ? { ...settings, provider }
        : { ...settings, router: { ...settings.router, engine: provider } }
    )
  }
  return (
    <div className="codex-welcome router-card">
      <Network size={30} />
      <h1>{t(COPY[need.kind].title, { agent })}</h1>
      <p>{t(COPY[need.kind].body, { agent })}</p>
      <div className="router-card-actions">
        {alternate ? (
          <Button size="sm" onClick={() => switchTo(alternate)}>
            {t('router.useAgent', { agent: t(`agent.${alternate}`) })}
          </Button>
        ) : null}
        <Button size="sm" variant={alternate ? 'outline' : 'default'} onClick={showSettings}>
          <Settings2 size={14} />
          {t('router.openSettings')}
        </Button>
      </div>
    </div>
  )
}
export function NoProjectCard() {
  const { t } = useTranslation()
  const pickProject = useCodexStore((s) => s.pickProject)
  return (
    <div className="codex-welcome router-card">
      <Network size={30} />
      <h1>{t('router.noProjectTitle')}</h1>
      <p>{t('router.noProjectBody')}</p>
      <Button size="sm" onClick={() => void pickProject()}>
        <FolderOpen size={14} />
        {t('chooseFolder')}
      </Button>
    </div>
  )
}
