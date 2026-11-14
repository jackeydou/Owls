import { useTranslation } from 'react-i18next'
import { OwlAvatar } from '../app/OwlAvatar'
import { usageSummaryRows, useUsageStore } from './store'
import './usage.css'

/**
 * The hover card beside the sidebar's Usage entry: one line per agent that reports plan limits,
 * with its owl, a bar in its brand color, and the share used of its tightest window.
 */
export function UsageSummary() {
  const { t } = useTranslation()
  const overview = useUsageStore((s) => s.overview)
  const rows = usageSummaryRows(overview)
  if (!rows.length) return null
  return (
    <span className="owls-usage-summary">
      <span className="owls-usage-summary-title">{t('usage.title')}</span>
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
