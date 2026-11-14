import { useTranslation } from 'react-i18next'
import type { AgentUsage, UsageWindow } from '../../../shared/usage'
import { OwlAvatar } from '../app/OwlAvatar'
import { useUsageStore } from './store'
import './usage.css'

type Row = { usage: Extract<AgentUsage, { state: 'ready' }>; window: UsageWindow }

/** Each agent's most-used window: the one that runs out first. */
function summaryRows(agents: AgentUsage[]): Row[] {
  const rows: Row[] = []
  for (const usage of agents) {
    if (usage.state !== 'ready') continue
    const window = usage.windows.reduce<UsageWindow | null>(
      (top, w) => (!top || w.usedPercent > top.usedPercent ? w : top),
      null
    )
    if (window) rows.push({ usage, window })
  }
  return rows
}

/**
 * One compact line per agent that reports plan limits, shown under the sidebar's Usage entry:
 * the agent's owl, a bar in its brand color, and the share used of its tightest window.
 */
export function UsageSummary() {
  const { t } = useTranslation()
  const agents = useUsageStore((s) => s.overview?.agents ?? null)
  const rows = agents ? summaryRows(agents) : []
  if (!rows.length) return null
  return (
    <span className="owls-usage-summary">
      {rows.map(({ usage, window }) => {
        const used = Math.round(window.usedPercent)
        return (
          <span
            key={usage.provider}
            className="owls-usage-summary-row"
            data-provider={usage.provider}
            data-high={used >= 90 || undefined}
          >
            <OwlAvatar speaker={usage.provider} />
            <span className="owls-usage-bar" aria-hidden>
              <span style={{ width: `${window.usedPercent}%` }} />
            </span>
            <span className="sr-only">
              {t('usage.summaryRow', { agent: t(`agent.${usage.provider}`), percent: used })}
            </span>
            <span aria-hidden>{used}%</span>
          </span>
        )
      })}
    </span>
  )
}
