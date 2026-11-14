import { type ReactNode, useId } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadialBar,
  AreaChart as RechartsAreaChart,
  BarChart as RechartsBarChart,
  LineChart as RechartsLineChart,
  PieChart as RechartsPieChart,
  RadarChart as RechartsRadarChart,
  RadialBarChart as RechartsRadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { z } from 'zod'
import { getPathValue, stringifyValue } from './shared'

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2']

const chartColorSchema = z
  .string()
  .regex(/^(#[0-9a-fA-F]{3,8}|var\(--[a-zA-Z0-9_-]+\))$/)
  .optional()

const chartDataRowSchema = z.record(z.string(), z.unknown())

const chartSeriesSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  color: chartColorSchema
})

const chartBaseSchema = {
  title: z.string().optional(),
  description: z.string().optional(),
  data: z.array(chartDataRowSchema).max(500),
  height: z.number().int().min(120).max(640).optional(),
  showGrid: z.boolean().optional(),
  showTooltip: z.boolean().optional(),
  showLegend: z.boolean().optional()
}

const cartesianChartSchema = z.object({
  ...chartBaseSchema,
  xKey: z.string(),
  series: z.array(chartSeriesSchema).min(1).max(8)
})

const areaChartSchema = cartesianChartSchema.extend({
  stacked: z.boolean().optional(),
  curve: z.enum(['linear', 'monotone', 'step']).optional()
})

const barChartSchema = cartesianChartSchema.extend({
  stacked: z.boolean().optional()
})

const lineChartSchema = cartesianChartSchema.extend({
  curve: z.enum(['linear', 'monotone', 'step']).optional()
})

const pieChartSchema = z.object({
  ...chartBaseSchema,
  nameKey: z.string(),
  valueKey: z.string(),
  colors: z.array(chartColorSchema.unwrap()).max(12).optional(),
  innerRadius: z.number().int().min(0).max(120).optional()
})

const radarChartSchema = z.object({
  ...chartBaseSchema,
  angleKey: z.string(),
  series: z.array(chartSeriesSchema).min(1).max(6)
})

const radialChartSchema = z.object({
  ...chartBaseSchema,
  nameKey: z.string(),
  valueKey: z.string(),
  colors: z.array(chartColorSchema.unwrap()).max(12).optional()
})

type ChartSeries = z.infer<typeof chartSeriesSchema>
type CartesianChartProps = z.infer<typeof cartesianChartSchema>
type AreaChartProps = z.infer<typeof areaChartSchema>
type BarChartProps = z.infer<typeof barChartSchema>
type LineChartProps = z.infer<typeof lineChartSchema>
type PieChartProps = z.infer<typeof pieChartSchema>
type RadarChartProps = z.infer<typeof radarChartSchema>
type RadialChartProps = z.infer<typeof radialChartSchema>

type NormalizedCartesianRow = Record<string, number | string>

export const chartCatalogComponents = {
  AreaChart: {
    props: areaChartSchema,
    description: 'Render a controlled Recharts area chart.'
  },
  BarChart: {
    props: barChartSchema,
    description: 'Render a controlled Recharts bar chart.'
  },
  LineChart: {
    props: lineChartSchema,
    description: 'Render a controlled Recharts line chart.'
  },
  PieChart: {
    props: pieChartSchema,
    description: 'Render a controlled Recharts pie chart.'
  },
  RadarChart: {
    props: radarChartSchema,
    description: 'Render a controlled Recharts radar chart.'
  },
  RadialChart: {
    props: radialChartSchema,
    description: 'Render a controlled Recharts radial bar chart.'
  }
}

function chartColor(index: number, color?: string): string {
  return color ?? CHART_COLORS[index % CHART_COLORS.length]
}

function chartNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function chartLabel(value: unknown): string {
  return stringifyValue(value)
}

function normalizeCartesianData(
  data: Record<string, unknown>[],
  xKey: string,
  series: ChartSeries[]
): NormalizedCartesianRow[] {
  return data.map((row, index) => {
    const normalized: NormalizedCartesianRow = {
      __x: chartLabel(getPathValue(row, xKey)) || String(index + 1)
    }
    for (const [seriesIndex, item] of series.entries()) {
      normalized[`series_${seriesIndex}`] = chartNumber(getPathValue(row, item.key))
    }
    return normalized
  })
}

function normalizePolarData(
  data: Record<string, unknown>[],
  nameKey: string,
  valueKey: string
): Array<Record<string, number | string>> {
  return data.map((row, index) => ({
    name: chartLabel(getPathValue(row, nameKey)) || String(index + 1),
    value: chartNumber(getPathValue(row, valueKey))
  }))
}

function chartTooltipStyle(): React.CSSProperties {
  return {
    backgroundColor: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    color: 'var(--color-foreground)',
    fontSize: 12,
    boxShadow: '0 12px 30px rgb(0 0 0 / 0.08)'
  }
}

function ChartFrame({
  title,
  description,
  height,
  children
}: {
  title?: string
  description?: string
  height?: number
  children: ReactNode
}): React.JSX.Element {
  return (
    <figure
      aria-label={title ?? description ?? 'JSON render chart'}
      className="rounded-xl border border-border/70 bg-card/70 p-3"
    >
      {title || description ? (
        <figcaption className="mb-3 space-y-1">
          {title ? <p className="font-semibold text-[13px] text-foreground">{title}</p> : null}
          {description ? (
            <p className="text-[12px] text-muted-foreground leading-5">{description}</p>
          ) : null}
        </figcaption>
      ) : null}
      <div className="w-full min-w-0" style={{ height: height ?? 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

function CartesianScaffold({
  showGrid,
  showTooltip,
  showLegend
}: Pick<CartesianChartProps, 'showGrid' | 'showTooltip' | 'showLegend'>): React.JSX.Element {
  return (
    <>
      {showGrid !== false ? (
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
      ) : null}
      <XAxis
        dataKey="__x"
        axisLine={false}
        tickLine={false}
        tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
        width={36}
      />
      {showTooltip !== false ? <Tooltip contentStyle={chartTooltipStyle()} /> : null}
      {showLegend ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
    </>
  )
}

function AreaChartPreview(props: AreaChartProps): React.JSX.Element {
  const gradientId = useId().replaceAll(':', '')
  const data = normalizeCartesianData(props.data, props.xKey, props.series)
  return (
    <ChartFrame title={props.title} description={props.description} height={props.height}>
      <RechartsAreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <defs>
          {props.series.map((series, index) => (
            <linearGradient
              key={series.key}
              id={`${gradientId}-${index}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="5%" stopColor={chartColor(index, series.color)} stopOpacity={0.35} />
              <stop offset="95%" stopColor={chartColor(index, series.color)} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianScaffold
          showGrid={props.showGrid}
          showTooltip={props.showTooltip}
          showLegend={props.showLegend}
        />
        {props.series.map((series, index) => (
          <Area
            key={series.key}
            dataKey={`series_${index}`}
            name={series.label ?? series.key}
            type={props.curve ?? 'monotone'}
            stackId={props.stacked ? 'json-render-area' : undefined}
            stroke={chartColor(index, series.color)}
            fill={`url(#${gradientId}-${index})`}
            strokeWidth={2}
          />
        ))}
      </RechartsAreaChart>
    </ChartFrame>
  )
}

function BarChartPreview(props: BarChartProps): React.JSX.Element {
  const data = normalizeCartesianData(props.data, props.xKey, props.series)
  return (
    <ChartFrame title={props.title} description={props.description} height={props.height}>
      <RechartsBarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianScaffold
          showGrid={props.showGrid}
          showTooltip={props.showTooltip}
          showLegend={props.showLegend}
        />
        {props.series.map((series, index) => (
          <Bar
            key={series.key}
            dataKey={`series_${index}`}
            name={series.label ?? series.key}
            stackId={props.stacked ? 'json-render-bar' : undefined}
            fill={chartColor(index, series.color)}
            radius={[5, 5, 0, 0]}
          />
        ))}
      </RechartsBarChart>
    </ChartFrame>
  )
}

function LineChartPreview(props: LineChartProps): React.JSX.Element {
  const data = normalizeCartesianData(props.data, props.xKey, props.series)
  return (
    <ChartFrame title={props.title} description={props.description} height={props.height}>
      <RechartsLineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianScaffold
          showGrid={props.showGrid}
          showTooltip={props.showTooltip}
          showLegend={props.showLegend}
        />
        {props.series.map((series, index) => (
          <Line
            key={series.key}
            dataKey={`series_${index}`}
            name={series.label ?? series.key}
            type={props.curve ?? 'monotone'}
            stroke={chartColor(index, series.color)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </RechartsLineChart>
    </ChartFrame>
  )
}

function PieChartPreview(props: PieChartProps): React.JSX.Element {
  const data = normalizePolarData(props.data, props.nameKey, props.valueKey)
  return (
    <ChartFrame title={props.title} description={props.description} height={props.height}>
      <RechartsPieChart>
        {props.showTooltip !== false ? <Tooltip contentStyle={chartTooltipStyle()} /> : null}
        {props.showLegend ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={props.innerRadius ?? 0}
          outerRadius="78%"
          paddingAngle={2}
        >
          {data.map((entry, index) => (
            <Cell
              key={entry.name}
              fill={props.colors?.[index] ?? chartColor(index)}
              stroke="var(--color-card)"
            />
          ))}
        </Pie>
      </RechartsPieChart>
    </ChartFrame>
  )
}

function RadarChartPreview(props: RadarChartProps): React.JSX.Element {
  const data = props.data.map((row, index) => {
    const normalized: NormalizedCartesianRow = {
      __angle: chartLabel(getPathValue(row, props.angleKey)) || String(index + 1)
    }
    for (const [seriesIndex, item] of props.series.entries()) {
      normalized[`series_${seriesIndex}`] = chartNumber(getPathValue(row, item.key))
    }
    return normalized
  })
  return (
    <ChartFrame title={props.title} description={props.description} height={props.height}>
      <RechartsRadarChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
        <PolarGrid stroke="var(--color-border)" />
        <PolarAngleAxis
          dataKey="__angle"
          tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
        />
        <PolarRadiusAxis tick={false} axisLine={false} />
        {props.showTooltip !== false ? <Tooltip contentStyle={chartTooltipStyle()} /> : null}
        {props.showLegend ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {props.series.map((series, index) => (
          <Radar
            key={series.key}
            dataKey={`series_${index}`}
            name={series.label ?? series.key}
            stroke={chartColor(index, series.color)}
            fill={chartColor(index, series.color)}
            fillOpacity={0.18}
          />
        ))}
      </RechartsRadarChart>
    </ChartFrame>
  )
}

function RadialChartPreview(props: RadialChartProps): React.JSX.Element {
  const data = normalizePolarData(props.data, props.nameKey, props.valueKey).map((row, index) => ({
    ...row,
    fill: props.colors?.[index] ?? chartColor(index)
  }))
  return (
    <ChartFrame title={props.title} description={props.description} height={props.height}>
      <RechartsRadialBarChart
        data={data}
        innerRadius="18%"
        outerRadius="90%"
        startAngle={90}
        endAngle={-270}
        margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
      >
        {props.showTooltip !== false ? <Tooltip contentStyle={chartTooltipStyle()} /> : null}
        {props.showLegend ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        <RadialBar dataKey="value" background cornerRadius={8} />
      </RechartsRadialBarChart>
    </ChartFrame>
  )
}

export const chartRegistryComponents = {
  AreaChart: ({ props }: { props: AreaChartProps }) => <AreaChartPreview {...props} />,
  BarChart: ({ props }: { props: BarChartProps }) => <BarChartPreview {...props} />,
  LineChart: ({ props }: { props: LineChartProps }) => <LineChartPreview {...props} />,
  PieChart: ({ props }: { props: PieChartProps }) => <PieChartPreview {...props} />,
  RadarChart: ({ props }: { props: RadarChartProps }) => <RadarChartPreview {...props} />,
  RadialChart: ({ props }: { props: RadialChartProps }) => <RadialChartPreview {...props} />
}
