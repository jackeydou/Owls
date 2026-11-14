import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { BarChart3, LineChart as LineChartIcon, MessageSquareText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip as ChartTooltip,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis
} from 'recharts'
import type { UsageDailyStat, UsageStats } from '../../../../shared/usage-stats'
import { SettingsCard, SettingsSegmentedControl } from './settings-ui'

type ChartKind = 'bar' | 'line'
type DateRange = '7' | '30' | '90'

const HEATMAP_LEVELS = [
  'bg-foreground/[0.035]',
  'bg-codex-green-300/30 dark:bg-codex-green-400/25',
  'bg-codex-green-300/55 dark:bg-codex-green-400/45',
  'bg-codex-green-400/75 dark:bg-codex-green-400/70',
  'bg-codex-green-500 dark:bg-codex-green-300'
]

function utcDateKey(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + amount)
  return next
}

function formatTokenCount(value: number, compact = false): string {
  return new Intl.NumberFormat(undefined, {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0
  }).format(value)
}

function dailyByDate(stats: UsageStats): Map<string, UsageDailyStat> {
  return new Map(stats.daily.map((day) => [day.date, day]))
}

function chartDays(stats: UsageStats, count: number): UsageDailyStat[] {
  const byDate = dailyByDate(stats)
  const today = new Date()
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(today, index - count + 1)
    const key = utcDateKey(date)
    return byDate.get(key) ?? { date: key, tokenCount: 0, messageCount: 0 }
  })
}

function heatmapDays(stats: UsageStats): Array<UsageDailyStat & { future: boolean }> {
  const byDate = dailyByDate(stats)
  const today = new Date()
  const start = addDays(today, -(today.getUTCDay() + 52 * 7))
  return Array.from({ length: 53 * 7 }, (_, index) => {
    const date = addDays(start, index)
    const key = utcDateKey(date)
    const day = byDate.get(key) ?? { date: key, tokenCount: 0, messageCount: 0 }
    return { ...day, future: date > today }
  })
}

function usageLevel(tokenCount: number, activeValues: number[]): number {
  if (tokenCount <= 0 || activeValues.length === 0) return 0
  const rank = activeValues.findIndex((value) => value >= tokenCount)
  const percentile = (rank < 0 ? activeValues.length : rank + 1) / activeValues.length
  return Math.min(4, Math.max(1, Math.ceil(percentile * 4)))
}

function UsageSummary({ stats }: { stats: UsageStats }): React.JSX.Element {
  const { t } = useI18n()
  const topModels = stats.models.slice(0, 3)

  return (
    <div className="grid grid-cols-[1.15fr_1fr] gap-3">
      <div className="flex min-h-[142px] flex-col justify-between rounded-xl border border-border/70 bg-card p-5">
        <div>
          <p className="text-[12px] font-medium text-muted-foreground">{t('usage.totalTokens')}</p>
          <p className="mt-2 text-[32px] font-semibold tracking-[-0.04em] text-foreground">
            {formatTokenCount(stats.totalTokens)}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <MessageSquareText className="size-3.5" strokeWidth={1.8} />
          {t('usage.totalMessages', { count: formatTokenCount(stats.totalMessages) })}
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card px-4 py-3.5">
        <p className="mb-2 text-[12px] font-medium text-muted-foreground">{t('usage.topModels')}</p>
        {topModels.length > 0 ? (
          <ol className="space-y-1">
            {topModels.map((model, index) => (
              <li key={model.modelId} className="flex h-[28px] items-center gap-2 text-[12.5px]">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-[10px] text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {model.modelId}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatTokenCount(model.tokenCount, true)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="pt-6 text-center text-[12.5px] text-muted-foreground">
            {t('usage.noModelData')}
          </p>
        )}
      </div>
    </div>
  )
}

function UsageHeatmap({ stats }: { stats: UsageStats }): React.JSX.Element {
  const { t, language } = useI18n()
  const days = useMemo(() => heatmapDays(stats), [stats])
  const activeValues = useMemo(
    () =>
      days
        .map((day) => day.tokenCount)
        .filter((value) => value > 0)
        .sort((a, b) => a - b),
    [days]
  )
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', year: 'numeric' }),
    [language]
  )

  return (
    <section>
      <div className="mb-3">
        <h3 className="text-[15px] font-medium text-foreground">{t('usage.activity.title')}</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">{t('usage.activity.description')}</p>
      </div>
      <SettingsCard className="p-4">
        <div className="overflow-x-auto pb-1">
          <div
            className="grid w-max grid-flow-col grid-rows-7 gap-[3px]"
            role="img"
            aria-label={t('usage.activity.ariaLabel')}
          >
            {days.map((day) => {
              const level = usageLevel(day.tokenCount, activeValues)
              const formattedDate = dateFormatter.format(new Date(`${day.date}T12:00:00`))
              const label = t('usage.activity.dayLabel', {
                date: formattedDate,
                tokens: formatTokenCount(day.tokenCount)
              })
              return (
                <Tooltip key={day.date}>
                  <TooltipTrigger asChild>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-[9px] rounded-[2px]',
                        day.future ? 'bg-transparent' : HEATMAP_LEVELS[level]
                      )}
                    />
                  </TooltipTrigger>
                  {!day.future ? <TooltipContent side="top">{label}</TooltipContent> : null}
                </Tooltip>
              )
            })}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
          <span>{t('usage.activity.less')}</span>
          {HEATMAP_LEVELS.map((levelClass) => (
            <span key={levelClass} className={cn('size-[9px] rounded-[2px]', levelClass)} />
          ))}
          <span>{t('usage.activity.more')}</span>
        </div>
      </SettingsCard>
    </section>
  )
}

function UsageChart({ stats }: { stats: UsageStats }): React.JSX.Element {
  const { t, language } = useI18n()
  const [chartKind, setChartKind] = useState<ChartKind>('bar')
  const [range, setRange] = useState<DateRange>('30')
  const data = useMemo(() => chartDays(stats, Number(range)), [range, stats])
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }),
    [language]
  )
  const chartData = useMemo(
    () =>
      data.map((day) => ({
        ...day,
        label: dateFormatter.format(new Date(`${day.date}T12:00:00`))
      })),
    [data, dateFormatter]
  )
  const chartProps = {
    data: chartData,
    margin: { top: 8, right: 0, bottom: 0, left: 0 }
  }
  const scaffold = (
    <>
      <CartesianGrid vertical={false} stroke="var(--color-border)" />
      <XAxis
        dataKey="label"
        axisLine={false}
        tickLine={false}
        tick={{ fill: 'var(--color-muted-foreground)', fontSize: 10 }}
        minTickGap={24}
        dy={8}
      />
      <YAxis
        yAxisId="tokens"
        axisLine={false}
        tickLine={false}
        width={44}
        tick={{ fill: 'var(--color-muted-foreground)', fontSize: 10 }}
        tickFormatter={(value: number) => formatTokenCount(value, true)}
      />
      <YAxis yAxisId="messages" orientation="right" hide />
      <ChartTooltip
        cursor={{ fill: 'var(--color-border-light)' }}
        contentStyle={{
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          background: 'var(--color-card)',
          color: 'var(--color-foreground)',
          fontSize: 12
        }}
        formatter={(value) => formatTokenCount(Number(value))}
      />
    </>
  )

  return (
    <section>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-medium text-foreground">{t('usage.chart.title')}</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('usage.chart.description')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SettingsSegmentedControl
            value={range}
            onChange={setRange}
            options={[
              { value: '7', label: t('usage.range.7') },
              { value: '30', label: t('usage.range.30') },
              { value: '90', label: t('usage.range.90') }
            ]}
          />
          <div className="inline-flex rounded-lg bg-foreground/5 p-1">
            {(
              [
                ['bar', BarChart3, t('usage.chart.bar')],
                ['line', LineChartIcon, t('usage.chart.line')]
              ] as const
            ).map(([kind, Icon, label]) => (
              <Tooltip key={kind}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={label}
                    aria-pressed={chartKind === kind}
                    onClick={() => setChartKind(kind)}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground',
                      chartKind === kind &&
                        'bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0_/_0.12)]'
                    )}
                  >
                    <Icon className="size-3.5" strokeWidth={1.8} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>

      <SettingsCard className="p-4">
        <div className="mb-3 flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-codex-blue-400" />
            {t('usage.tokens')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-codex-orange-400" />
            {t('usage.messages')}
          </span>
        </div>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            {chartKind === 'bar' ? (
              <BarChart {...chartProps}>
                {scaffold}
                <Bar
                  yAxisId="tokens"
                  dataKey="tokenCount"
                  name={t('usage.tokens')}
                  fill="var(--color-codex-blue-400)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={18}
                />
                <Bar
                  yAxisId="messages"
                  dataKey="messageCount"
                  name={t('usage.messages')}
                  fill="var(--color-codex-orange-400)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={10}
                />
              </BarChart>
            ) : (
              <LineChart {...chartProps}>
                {scaffold}
                <Line
                  yAxisId="tokens"
                  type="monotone"
                  dataKey="tokenCount"
                  name={t('usage.tokens')}
                  stroke="var(--color-codex-blue-400)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
                <Line
                  yAxisId="messages"
                  type="monotone"
                  dataKey="messageCount"
                  name={t('usage.messages')}
                  stroke="var(--color-codex-orange-400)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </SettingsCard>
    </section>
  )
}

export function UsageTab(): React.JSX.Element {
  const { t } = useI18n()
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.agent
      .usageStats()
      .then((result) => {
        if (!cancelled) setStats(result)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loadFailed) {
    return (
      <SettingsCard className="px-5 py-10 text-center text-[13px] text-muted-foreground">
        {t('usage.loadFailed')}
      </SettingsCard>
    )
  }

  if (!stats) {
    return (
      <div className="space-y-3" aria-label={t('usage.loading')} role="status">
        <div className="h-[142px] animate-pulse rounded-xl bg-foreground/5" />
        <div className="h-[170px] animate-pulse rounded-xl bg-foreground/5" />
        <div className="h-[340px] animate-pulse rounded-xl bg-foreground/5" />
      </div>
    )
  }

  return (
    <div className="space-y-10">
      <UsageSummary stats={stats} />
      <UsageHeatmap stats={stats} />
      <UsageChart stats={stats} />
    </div>
  )
}
