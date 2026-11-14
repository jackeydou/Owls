import { ActionIconButton } from '@renderer/components/ui/action-button'
import { AlertCircleIcon, RefreshIcon } from '@renderer/components/ui/icons'
import { AnchoredTooltip } from '@renderer/components/ui/tooltip'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  cacheHitRate,
  totalTokens,
  type UsageAgent,
  type UsageDay,
  type UsageGroup,
  type UsageRange,
  type UsageStats,
  usageAgentSchema,
  usageRangeSchema
} from '../../../shared/usage-stats'
import { OwlAvatar } from '../app/OwlAvatar'
import { useAppStore } from '../app/store'
import { type UsageGroupBy, useUsageStatsStore } from './stats-store'
import './usage-stats.css'

/** Stack order, bottom to top: the large cached share sits on the baseline. */
const KINDS = ['cacheRead', 'input', 'cacheWrite', 'output'] as const
type Kind = (typeof KINDS)[number]
const GROUPS: UsageGroupBy[] = ['agent', 'model', 'project', 'role']

function useFormat() {
  const language = useAppStore((s) => s.settings.language)
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en'
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  const usd = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  })
  return {
    tokens: (value: number) => compact.format(value),
    percent: (value: number | null) => (value === null ? '–' : percent.format(value)),
    cost: (value: number) =>
      value > 0 && value < 0.01 ? `<${usd.format(0.01)}` : usd.format(value),
    day: (day: string, long = false) => {
      const [y, m, d] = day.split('-').map(Number)
      return new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        ...(long ? { weekday: 'short' } : {})
      }).format(new Date(y, m - 1, d))
    }
  }
}

/** A round axis top a little above the largest day, so the gridlines read as plain numbers. */
function axisMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) ?? 10
  return step * magnitude
}

function Kpis({ stats }: { stats: UsageStats }) {
  const { t } = useTranslation()
  const f = useFormat()
  const totals = stats.totals
  const tiles = [
    {
      label: t('usageStats.kpi.total'),
      value: f.tokens(totalTokens(totals)),
      detail: t('usageStats.kpi.totalDetail', {
        input: f.tokens(totals.input + totals.cacheRead + totals.cacheWrite),
        output: f.tokens(totals.output)
      })
    },
    {
      label: t('usageStats.kpi.cache'),
      value: f.percent(cacheHitRate(totals)),
      detail: t('usageStats.kpi.cacheDetail', { read: f.tokens(totals.cacheRead) })
    },
    {
      label: t('usageStats.kpi.output'),
      value: f.tokens(totals.output),
      detail: t('usageStats.kpi.outputDetail', { reasoning: f.tokens(totals.reasoning) })
    },
    {
      label: t('usageStats.kpi.cost'),
      // No agent in view reported a cost, so a zero would read as free.
      value: totals.unpricedTokens >= totalTokens(totals) ? '–' : f.cost(totals.costUsd),
      detail: totals.unpricedTokens
        ? t('usageStats.kpi.costPartial', { tokens: f.tokens(totals.unpricedTokens) })
        : t('usageStats.kpi.costDetail')
    }
  ]
  return (
    <div className="owls-stats-kpis">
      {tiles.map((tile) => (
        <div className="owls-stats-kpi" key={tile.label}>
          <span>{tile.label}</span>
          <strong>{tile.value}</strong>
          <small>{tile.detail}</small>
        </div>
      ))}
    </div>
  )
}

function DayTooltip({ day }: { day: UsageDay }) {
  const { t } = useTranslation()
  const f = useFormat()
  return (
    <div className="owls-stats-tip">
      <strong>{f.day(day.day, true)}</strong>
      {[...KINDS].reverse().map((kind) => (
        <div key={kind}>
          <i data-kind={kind} />
          <span>{t(`usageStats.kind.${kind}`)}</span>
          <b>{f.tokens(day[kind])}</b>
        </div>
      ))}
      <div className="owls-stats-tip-total">
        <span>{t('usageStats.kind.total')}</span>
        <b>{f.tokens(totalTokens(day))}</b>
      </div>
    </div>
  )
}

function DailyChart({ days }: { days: UsageDay[] }) {
  const { t } = useTranslation()
  const f = useFormat()
  const [hover, setHover] = useState<{ index: number; element: HTMLElement } | null>(null)
  const max = axisMax(Math.max(0, ...days.map(totalTokens)))
  const total = days.reduce((sum, day) => sum + totalTokens(day), 0)
  const first = days[0]
  const last = days[days.length - 1]
  const middle = days[Math.floor((days.length - 1) / 2)]
  return (
    <section className="owls-stats-card">
      <div className="owls-stats-card-head">
        <h3>{t('usageStats.daily')}</h3>
        <ul className="owls-stats-legend">
          {[...KINDS].reverse().map((kind) => (
            <li key={kind}>
              <i data-kind={kind} />
              {t(`usageStats.kind.${kind}`)}
            </li>
          ))}
        </ul>
      </div>
      <div
        className="owls-stats-chart"
        role="img"
        aria-label={
          first && last
            ? t('usageStats.dailySummary', {
                from: f.day(first.day),
                to: f.day(last.day),
                total: f.tokens(total)
              })
            : undefined
        }
      >
        <div className="owls-stats-grid" aria-hidden>
          {[max, max / 2, 0].map((value) => (
            <div key={value}>
              <span>{f.tokens(value)}</span>
            </div>
          ))}
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the hover tooltip repeats the screen-reader table below. */}
        <div
          className="owls-stats-bars"
          data-dense={days.length > 45 || undefined}
          onMouseLeave={() => setHover(null)}
        >
          {days.map((day, index) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: the hover tooltip repeats the screen-reader table below.
            <div
              key={day.day}
              className="owls-stats-column"
              data-active={hover?.index === index || undefined}
              onMouseEnter={(event) => setHover({ index, element: event.currentTarget })}
            >
              <div className="owls-stats-stack">
                {KINDS.map((kind: Kind) =>
                  day[kind] > 0 ? (
                    <span
                      key={kind}
                      data-kind={kind}
                      style={{ height: `${(day[kind] / max) * 100}%` }}
                    />
                  ) : null
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {first && last ? (
        <div className="owls-stats-axis" aria-hidden>
          <span>{f.day(first.day)}</span>
          {days.length > 2 ? <span>{f.day(middle.day)}</span> : null}
          {days.length > 1 ? <span>{f.day(last.day)}</span> : null}
        </div>
      ) : null}
      <AnchoredTooltip
        open={hover !== null}
        reference={hover?.element ?? null}
        placement="top"
        maxWidth={240}
      >
        {hover && days[hover.index] ? <DayTooltip day={days[hover.index]} /> : null}
      </AnchoredTooltip>
      <table className="sr-only">
        <caption>{t('usageStats.daily')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('usageStats.day')}</th>
            {KINDS.map((kind) => (
              <th scope="col" key={kind}>
                {t(`usageStats.kind.${kind}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days
            .filter((day) => totalTokens(day) > 0)
            .map((day) => (
              <tr key={day.day}>
                <th scope="row">{f.day(day.day)}</th>
                {KINDS.map((kind) => (
                  <td key={kind}>{day[kind]}</td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  )
}

function AgentFilter({ stats }: { stats: UsageStats | null }) {
  const { t } = useTranslation()
  const agent = useUsageStatsStore((s) => s.agent)
  const setAgent = useUsageStatsStore((s) => s.setAgent)
  const name = useGroupName()
  const recorded = stats?.agents ?? []
  const agents: (UsageAgent | null)[] = [
    null,
    ...usageAgentSchema.options.filter((a) => recorded.includes(a) || a === agent)
  ]
  return (
    <fieldset className="owls-segmented owls-stats-agents" aria-label={t('usageStats.agentFilter')}>
      {agents.map((option) => (
        <button
          type="button"
          key={option ?? 'all'}
          aria-pressed={option === agent}
          onClick={() => setAgent(option)}
        >
          {option ? <AgentIcon agent={option} /> : null}
          {option ? name('agent', option) : t('usageStats.allAgents')}
        </button>
      ))}
    </fieldset>
  )
}

function AgentIcon({ agent }: { agent: UsageAgent }) {
  return <OwlAvatar speaker={agent === 'owls' ? 'router' : agent} />
}

function useGroupName(): (groupBy: UsageGroupBy, key: string | null) => string {
  const { t } = useTranslation()
  const projects = useAppStore((s) => s.projects)
  return (groupBy, key) => {
    if (groupBy === 'agent')
      return key === 'owls'
        ? t('usageStats.agent.owls')
        : key === 'claude-code' || key === 'codex' || key === 'cursor'
          ? t(`agent.${key}`)
          : t('usageStats.unknown')
    if (groupBy === 'role')
      return key === 'router' || key === 'worker' || key === 'dreaming'
        ? t(`usageStats.role.${key}`)
        : t('usageStats.unknown')
    if (groupBy === 'model') return key ?? t('usageStats.noModel')
    if (key === null) return t('usageStats.noProject')
    return projects.find((p) => p.id === key)?.name ?? t('usageStats.deletedProject')
  }
}

function GroupIcon({ groupBy, row }: { groupBy: UsageGroupBy; row: UsageGroup }) {
  if (groupBy === 'agent') {
    const agent = usageAgentSchema.safeParse(row.key)
    return agent.success ? <AgentIcon agent={agent.data} /> : null
  }
  return groupBy === 'role' && row.key === 'router' ? <OwlAvatar speaker="router" /> : null
}

function Breakdown({ stats }: { stats: UsageStats }) {
  const { t } = useTranslation()
  const f = useFormat()
  const groupBy = useUsageStatsStore((s) => s.groupBy)
  const setGroupBy = useUsageStatsStore((s) => s.setGroupBy)
  const name = useGroupName()
  const rows: Record<UsageGroupBy, UsageGroup[]> = {
    agent: stats.byAgent,
    model: stats.byModel,
    project: stats.byProject,
    role: stats.byRole
  }
  // Grouping one agent's numbers by agent says nothing.
  const groups = stats.agent ? GROUPS.filter((g) => g !== 'agent') : GROUPS
  const shown = rows[groupBy]
  const total = totalTokens(stats.totals)
  return (
    <section className="owls-stats-card">
      <div className="owls-stats-card-head">
        <h3>{t('usageStats.breakdown')}</h3>
        <fieldset className="owls-segmented" aria-label={t('usageStats.groupBy')}>
          {groups.map((group) => (
            <button
              type="button"
              key={group}
              aria-pressed={group === groupBy}
              onClick={() => setGroupBy(group)}
            >
              {t(`usageStats.groupBy.${group}`)}
            </button>
          ))}
        </fieldset>
      </div>
      <table className="owls-stats-table">
        <thead>
          <tr>
            <th scope="col">{t('usageStats.column.name')}</th>
            <th scope="col">{t('usageStats.column.share')}</th>
            <th scope="col">{t('usageStats.column.tokens')}</th>
            <th scope="col">{t('usageStats.column.cache')}</th>
            <th scope="col">{t('usageStats.column.cost')}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const tokens = totalTokens(row)
            const share = total > 0 ? tokens / total : 0
            return (
              <tr key={row.key ?? ''}>
                <th scope="row">
                  <span className="owls-stats-name">
                    <GroupIcon groupBy={groupBy} row={row} />
                    <span>{name(groupBy, row.key)}</span>
                  </span>
                </th>
                <td>
                  <span className="owls-stats-share">
                    <span aria-hidden>
                      <span style={{ width: `${share * 100}%` }} />
                    </span>
                    {f.percent(share)}
                  </span>
                </td>
                <td>{f.tokens(tokens)}</td>
                <td>{f.percent(cacheHitRate(row))}</td>
                <td>{row.unpricedTokens === tokens ? '–' : f.cost(row.costUsd)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

export function UsageStatsPane() {
  const { t } = useTranslation()
  const { range, stats, loading, failed, setRange, load } = useUsageStatsStore()
  useEffect(() => {
    void load().catch(() => {
      /* The page shows the failure. */
    })
  }, [load])
  const empty = stats !== null && totalTokens(stats.totals) === 0
  return (
    <section className="owls-settings-section owls-stats">
      <div className="owls-section-heading">
        <div>
          <h2>{t('usageStats.title')}</h2>
          <p>{t('usageStats.description')}</p>
        </div>
      </div>
      <div className="owls-stats-controls">
        <AgentFilter stats={stats} />
      </div>
      <div className="owls-stats-controls owls-stats-controls-range">
        <fieldset className="owls-segmented" aria-label={t('usageStats.range')}>
          {usageRangeSchema.options.map((option: UsageRange) => (
            <button
              type="button"
              key={option}
              aria-pressed={option === range}
              onClick={() => setRange(option)}
            >
              {t(`usageStats.range.${option}`)}
            </button>
          ))}
        </fieldset>
        <ActionIconButton
          size="custom"
          className="size-7"
          icon={<RefreshIcon size={15} />}
          label={t('usageStats.refresh')}
          tooltip={t('usageStats.refresh')}
          pending={loading && stats === null}
          onAction={load}
        />
      </div>
      {failed ? (
        <p className="owls-stats-alert" role="alert">
          <AlertCircleIcon size={15} />
          {t('usageStats.failed')}
        </p>
      ) : null}
      {stats === null ? (
        failed ? null : (
          <p className="owls-stats-quiet">{t('usageStats.loading')}</p>
        )
      ) : (
        <div className="owls-stats-body" aria-busy={loading || undefined}>
          <Kpis stats={stats} />
          {empty ? (
            <p className="owls-stats-quiet owls-stats-empty">{t('usageStats.empty')}</p>
          ) : (
            <>
              <DailyChart days={stats.days} />
              <Breakdown stats={stats} />
            </>
          )}
          <p className="owls-stats-note">{t('usageStats.note')}</p>
        </div>
      )}
    </section>
  )
}
