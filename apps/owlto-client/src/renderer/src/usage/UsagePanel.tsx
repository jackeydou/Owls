import { ActionIconButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { ExternalLinkIcon, RefreshIcon } from '@renderer/components/ui/icons'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentProvider } from '../../../shared/app'
import type { AgentUsage, UsageWindow } from '../../../shared/usage'
import { OwlAvatar } from '../app/OwlAvatar'
import { useAppStore } from '../app/store'
import { useUsageStore } from './store'
import './usage.css'

/** Cursor's own usage page, for the account the CLI cannot report on. */
const CURSOR_USAGE_URL = 'https://cursor.com/dashboard?tab=usage'

/** Plan ids as the agents send them ('max', 'pro', 'plus') read best capitalized. */
function planName(plan: string | null): string | null {
  if (!plan) return null
  return plan
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

function useResetTime(): (iso: string | null) => string | null {
  const language = useAppStore((s) => s.settings.language)
  return (iso) => {
    if (!iso) return null
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return null
    const sameDay = date.toDateString() === new Date().toDateString()
    return new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en', {
      ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
      hour: 'numeric',
      minute: '2-digit'
    }).format(date)
  }
}

function useWindowLabel(): (provider: AgentProvider, window: UsageWindow) => string {
  const { t } = useTranslation()
  return (provider, window) => {
    if (window.kind === 'model')
      return provider === 'claude-code'
        ? t('usage.window.claude-code.model', { model: window.label ?? '' })
        : t('usage.window.model', { model: window.label ?? '' })
    if ((window.kind === 'session' || window.kind === 'weekly') && provider !== 'cursor')
      return t(`usage.window.${provider}.${window.kind}`)
    const minutes = window.windowMinutes
    if (!minutes) return t('usage.window.other')
    return minutes % 1440 === 0
      ? t('usage.window.days', { days: minutes / 1440 })
      : t('usage.window.hours', { hours: Math.round(minutes / 60) })
  }
}

/** A meter in the agent's brand color; the fill is the share used, as each CLI shows it. */
function Meter({ label, used, detail }: { label: string; used: number; detail: string | null }) {
  const { t } = useTranslation()
  const rounded = Math.round(used)
  return (
    <div className="owlto-usage-meter" data-high={used >= 90 || undefined}>
      <div className="owlto-usage-meter-head">
        <span>{label}</span>
        <span>{t('usage.used', { percent: rounded })}</span>
      </div>
      {/* The percentages above and below already say what the bar shows. */}
      <div className="owlto-usage-bar" aria-hidden>
        <span style={{ width: `${used}%` }} />
      </div>
      <div className="owlto-usage-meter-foot">
        <span>{t('usage.left', { percent: 100 - rounded })}</span>
        {detail ? <span>{detail}</span> : null}
      </div>
    </div>
  )
}

function AgentUsageCard({ usage }: { usage: AgentUsage }) {
  const { t } = useTranslation()
  const resetTime = useResetTime()
  const windowLabel = useWindowLabel()
  const showAgentSettings = useAppStore((s) => s.showAgentSettings)
  const plan = planName(usage.plan)
  const resets = (iso: string | null) => {
    const time = resetTime(iso)
    return time ? t('usage.resetsAt', { time }) : null
  }
  return (
    <section className="owlto-usage-agent" data-provider={usage.provider}>
      <header>
        <OwlAvatar speaker={usage.provider} />
        <h3>{t(`agent.${usage.provider}`)}</h3>
        {plan ? <span className="owlto-usage-plan">{plan}</span> : null}
      </header>
      {usage.state === 'unavailable' ? (
        <div className="owlto-usage-unavailable">
          <p>{t(`usage.reason.${usage.reason}`)}</p>
          {usage.reason === 'not-connected' || usage.reason === 'signed-out' ? (
            <Button variant="outline" size="sm" onClick={() => showAgentSettings(usage.provider)}>
              {t('usage.connect')}
            </Button>
          ) : usage.reason === 'not-supported' && usage.provider === 'cursor' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(CURSOR_USAGE_URL, '_blank', 'noreferrer')}
            >
              <ExternalLinkIcon size={14} />
              {t('usage.openDashboard')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="owlto-usage-meters">
          {usage.windows.map((window) => (
            <Meter
              key={`${window.kind}:${window.label ?? ''}:${window.windowMinutes ?? ''}`}
              label={windowLabel(usage.provider, window)}
              used={window.usedPercent}
              detail={resets(window.resetsAt)}
            />
          ))}
          {usage.windows.length === 0 ? <p>{t('usage.noWindows')}</p> : null}
          {usage.spend?.enabled && usage.spend.usedPercent !== null ? (
            <Meter label={t('usage.spend')} used={usage.spend.usedPercent} detail={null} />
          ) : usage.spend && !usage.spend.enabled ? (
            <p className="owlto-usage-note">{t('usage.spendOff')}</p>
          ) : null}
          {usage.credits?.unlimited ? (
            <p className="owlto-usage-note">{t('usage.creditsUnlimited')}</p>
          ) : usage.credits?.hasCredits && usage.credits.balance ? (
            <p className="owlto-usage-note">
              {t('usage.credits', { balance: usage.credits.balance })}
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}

/** The Usage popover's body: each worker agent's plan limits, in its own terms. */
export function UsagePanel() {
  const { t } = useTranslation()
  const { overview, loading, failed, updatedAt, load } = useUsageStore()
  const language = useAppStore((s) => s.settings.language)
  useEffect(() => {
    load(false).catch(() => {
      /* The panel shows the failure. */
    })
  }, [load])
  const updated =
    updatedAt === null
      ? null
      : new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en', {
          hour: 'numeric',
          minute: '2-digit'
        }).format(updatedAt)
  return (
    <div className="owlto-usage">
      <header className="owlto-usage-head">
        <div>
          <h2>{t('usage.title')}</h2>
          {updated ? <p>{t('usage.updatedAt', { time: updated })}</p> : null}
        </div>
        <ActionIconButton
          size="custom"
          className="size-7"
          icon={<RefreshIcon size={15} />}
          label={t('usage.refresh')}
          tooltip={t('usage.refresh')}
          pending={loading && overview === null}
          onAction={() => load(true)}
          data-autofocus
        />
      </header>
      {overview ? (
        <div className="owlto-usage-list" aria-busy={loading || undefined}>
          {overview.agents.map((usage) => (
            <AgentUsageCard key={usage.provider} usage={usage} />
          ))}
        </div>
      ) : failed ? (
        <p className="owlto-usage-status">{t('usage.failed')}</p>
      ) : (
        <p className="owlto-usage-status" role="status">
          {t('usage.loading')}
        </p>
      )}
    </div>
  )
}
