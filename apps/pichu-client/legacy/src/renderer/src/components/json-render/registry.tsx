import { Accordion } from '@base-ui/react/accordion'
import { Avatar } from '@base-ui/react/avatar'
import { Button as BaseButton } from '@base-ui/react/button'
import { Checkbox } from '@base-ui/react/checkbox'
import { CheckboxGroup } from '@base-ui/react/checkbox-group'
import { Collapsible } from '@base-ui/react/collapsible'
import { Field } from '@base-ui/react/field'
import { Fieldset } from '@base-ui/react/fieldset'
import { Form as BaseForm } from '@base-ui/react/form'
import { Input } from '@base-ui/react/input'
import { Meter } from '@base-ui/react/meter'
import { NumberField } from '@base-ui/react/number-field'
import { OTPFieldPreview as OTPField } from '@base-ui/react/otp-field'
import { Progress } from '@base-ui/react/progress'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { ScrollArea } from '@base-ui/react/scroll-area'
import { Separator } from '@base-ui/react/separator'
import { Slider } from '@base-ui/react/slider'
import { Switch } from '@base-ui/react/switch'
import { Tabs } from '@base-ui/react/tabs'
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Toolbar } from '@base-ui/react/toolbar'
import { defineCatalog } from '@json-render/core'
import { defineRegistry } from '@json-render/react'
import { schema } from '@json-render/react/schema'
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import { Children } from 'react'
import { z } from 'zod'
import { chartCatalogComponents, chartRegistryComponents } from './chart-components'
import {
  type ChoiceItem,
  FORMATS,
  formatClass,
  getPathValue,
  JsonTreeView,
  type KeyValueItem,
  safeImageSrc,
  safeLinkHref,
  stringifyValue,
  type TableColumn,
  TONES,
  toneClass
} from './shared'

const choiceSchema = z.object({
  label: z.string(),
  value: z.string(),
  checked: z.boolean().optional(),
  pressed: z.boolean().optional(),
  disabled: z.boolean().optional()
})

const sharedControlProps = {
  disabled: z.boolean().optional(),
  readOnly: z.boolean().optional()
}

const baseUiTone = z.enum(TONES)
const formatSchema = z.enum(FORMATS)

const catalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({
        direction: z.enum(['vertical', 'horizontal']).optional(),
        gap: z.enum(['xs', 'sm', 'md', 'lg']).optional()
      }),
      description: 'Arrange review content in a controlled stack.'
    },
    SelectableNode: {
      props: z.object({
        elementId: z.string(),
        elementType: z.string(),
        renderer: z.enum(['json-render', 'form-render']),
        surface: z.string().optional(),
        parentElementId: z.string().optional(),
        statePointer: z.string().optional(),
        label: z.string().optional()
      }),
      description: 'Internal wrapper that exposes stable selectable node metadata.'
    },
    Grid: {
      props: z.object({
        columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        gap: z.enum(['sm', 'md']).optional()
      }),
      description: 'Arrange review content in a responsive grid.'
    },
    Section: {
      props: z.object({
        title: z.string().optional(),
        description: z.string().optional()
      }),
      description: 'Group related approval details.'
    },
    Card: {
      props: z.object({
        title: z.string().optional(),
        description: z.string().optional()
      }),
      description: 'Frame a nested review surface.'
    },
    Tabs: {
      props: z.object({
        labels: z.array(z.string()).max(8)
      }),
      description: 'Show alternate approval review panels.'
    },
    Accordion: {
      props: z.object({
        titles: z.array(z.string()).max(12),
        defaultOpen: z.boolean().optional()
      }),
      description: 'Show collapsible approval review panels.'
    },
    Collapsible: {
      props: z.object({
        title: z.string(),
        defaultOpen: z.boolean().optional(),
        disabled: z.boolean().optional()
      }),
      description: 'Show one collapsible review panel.'
    },
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.union([z.literal(3), z.literal(4)]).optional()
      }),
      description: 'Render a heading.'
    },
    Text: {
      props: z.object({
        text: z.unknown(),
        tone: baseUiTone.optional()
      }),
      description: 'Render text content.'
    },
    Image: {
      props: z.object({
        src: z.string(),
        alt: z.string().optional(),
        caption: z.string().optional(),
        fit: z.enum(['contain', 'cover']).optional(),
        maxHeight: z.number().int().min(80).max(640).optional()
      }),
      description: 'Render a controlled image preview.'
    },
    Link: {
      props: z.object({
        href: z.string(),
        label: z.string().optional()
      }),
      description: 'Render an external review link.'
    },
    Badge: {
      props: z.object({
        label: z.string(),
        tone: baseUiTone.optional()
      }),
      description: 'Render a small status badge.'
    },
    Callout: {
      props: z.object({
        title: z.string().optional(),
        body: z.string(),
        tone: z.enum(['info', 'warning', 'danger']).optional()
      }),
      description: 'Render a highlighted callout.'
    },
    KeyValue: {
      props: z.object({
        items: z.array(
          z.object({
            label: z.string(),
            value: z.unknown(),
            format: formatSchema.optional()
          })
        )
      }),
      description: 'Render key-value details.'
    },
    JsonTree: {
      props: z.object({
        value: z.unknown(),
        defaultExpandedDepth: z.number().int().min(0).max(6).optional()
      }),
      description: 'Render nested JSON for review.'
    },
    CodeBlock: {
      props: z.object({
        code: z.unknown(),
        language: z.string().optional()
      }),
      description: 'Render code or command text.'
    },
    Diff: {
      props: z.object({
        patch: z.unknown()
      }),
      description: 'Render a patch or diff preview.'
    },
    DataTable: {
      props: z.object({
        rows: z.array(z.unknown()).optional(),
        data: z.array(z.unknown()).optional(),
        __pichuElementId: z.string().optional(),
        __pichuStatePointer: z.string().optional(),
        columns: z.array(
          z.object({
            label: z.string(),
            path: z.string().optional(),
            key: z.string().optional(),
            format: formatSchema.optional()
          })
        )
      }),
      description: 'Render tabular approval data.'
    },
    Divider: {
      props: z.object({}),
      description: 'Render a separator.'
    },
    Separator: {
      props: z.object({
        orientation: z.enum(['horizontal', 'vertical']).optional()
      }),
      description: 'Render a Base UI separator.'
    },
    Button: {
      props: z.object({
        label: z.string(),
        variant: z.enum(['default', 'secondary', 'outline', 'ghost', 'destructive']).optional(),
        disabled: z.boolean().optional()
      }),
      description: 'Render a Base UI button.'
    },
    Avatar: {
      props: z.object({
        src: z.string().optional(),
        alt: z.string().optional(),
        fallback: z.string(),
        size: z.enum(['sm', 'md', 'lg']).optional()
      }),
      description: 'Render a Base UI avatar.'
    },
    Checkbox: {
      props: z.object({
        label: z.string(),
        checked: z.boolean().optional(),
        indeterminate: z.boolean().optional(),
        ...sharedControlProps
      }),
      description: 'Render a Base UI checkbox.'
    },
    CheckboxGroup: {
      props: z.object({
        label: z.string().optional(),
        items: z.array(choiceSchema),
        ...sharedControlProps
      }),
      description: 'Render a Base UI checkbox group.'
    },
    Field: {
      props: z.object({
        label: z.string().optional(),
        description: z.string().optional(),
        error: z.string().optional(),
        name: z.string().optional()
      }),
      description: 'Render a Base UI field wrapper.'
    },
    Fieldset: {
      props: z.object({
        legend: z.string().optional(),
        description: z.string().optional()
      }),
      description: 'Render a Base UI fieldset wrapper.'
    },
    Form: {
      props: z.object({
        title: z.string().optional(),
        description: z.string().optional()
      }),
      description: 'Render a Base UI form container.'
    },
    Input: {
      props: z.object({
        label: z.string().optional(),
        value: z.union([z.string(), z.number()]).optional(),
        placeholder: z.string().optional(),
        type: z.enum(['text', 'email', 'url', 'search', 'password', 'tel']).optional(),
        disabled: z.boolean().optional(),
        readOnly: z.boolean().optional()
      }),
      description: 'Render a Base UI input.'
    },
    Meter: {
      props: z.object({
        label: z.string().optional(),
        value: z.number(),
        min: z.number().optional(),
        max: z.number().optional()
      }),
      description: 'Render a Base UI meter.'
    },
    NumberField: {
      props: z.object({
        label: z.string().optional(),
        value: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        ...sharedControlProps
      }),
      description: 'Render a Base UI number field.'
    },
    OTPField: {
      props: z.object({
        label: z.string().optional(),
        value: z.string().optional(),
        length: z.number().int().min(1).max(8).optional(),
        description: z.string().optional(),
        disabled: z.boolean().optional()
      }),
      description: 'Render a Base UI OTP field.'
    },
    Progress: {
      props: z.object({
        label: z.string().optional(),
        value: z.number().min(0).max(100).nullable().optional(),
        min: z.number().optional(),
        max: z.number().optional()
      }),
      description: 'Render a Base UI progress bar.'
    },
    Radio: {
      props: z.object({
        label: z.string(),
        value: z.string().optional(),
        checked: z.boolean().optional(),
        disabled: z.boolean().optional()
      }),
      description: 'Render a single Base UI radio.'
    },
    RadioGroup: {
      props: z.object({
        label: z.string().optional(),
        value: z.string().optional(),
        items: z.array(choiceSchema),
        ...sharedControlProps
      }),
      description: 'Render a Base UI radio group.'
    },
    ScrollArea: {
      props: z.object({
        height: z.number().int().min(80).max(640).optional()
      }),
      description: 'Render a Base UI scroll area.'
    },
    Slider: {
      props: z.object({
        label: z.string().optional(),
        value: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        disabled: z.boolean().optional()
      }),
      description: 'Render a Base UI slider.'
    },
    Switch: {
      props: z.object({
        label: z.string(),
        checked: z.boolean().optional(),
        ...sharedControlProps
      }),
      description: 'Render a Base UI switch.'
    },
    Toggle: {
      props: z.object({
        label: z.string(),
        pressed: z.boolean().optional(),
        disabled: z.boolean().optional()
      }),
      description: 'Render a Base UI toggle.'
    },
    ToggleGroup: {
      props: z.object({
        items: z.array(choiceSchema),
        multiple: z.boolean().optional(),
        disabled: z.boolean().optional()
      }),
      description: 'Render a Base UI toggle group.'
    },
    Toolbar: {
      props: z.object({
        label: z.string().optional(),
        items: z.array(choiceSchema).optional()
      }),
      description: 'Render a Base UI toolbar.'
    },
    ...chartCatalogComponents
  },
  actions: {}
})

const focusClass =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/50'
const controlLabelClass = 'flex items-center gap-2 text-[12.5px] leading-5 text-foreground'
const inputClass = `h-8 min-w-0 rounded-lg border border-border bg-background px-2.5 text-[12.5px] text-foreground placeholder:text-muted-foreground ${focusClass}`
const checkboxClass = `flex size-4 shrink-0 items-center justify-center rounded border border-border bg-background text-background data-checked:border-accent data-checked:bg-accent data-checked:text-accent-foreground data-indeterminate:border-accent data-indeterminate:bg-accent data-indeterminate:text-accent-foreground ${focusClass}`
const radioClass = `flex size-4 shrink-0 items-center justify-center rounded-full border border-border bg-background text-background data-checked:border-accent data-checked:bg-accent data-checked:text-accent-foreground ${focusClass}`
const toggleClass = `rounded-lg border border-border bg-background px-2.5 py-1.5 font-medium text-[12px] text-muted-foreground data-pressed:border-accent data-pressed:bg-accent/10 data-pressed:text-accent ${focusClass}`
const toolbarButtonClass = `min-h-8 rounded-lg px-2.5 text-[12px] text-muted-foreground hover:bg-card-muted data-pressed:bg-accent/10 data-pressed:text-accent ${focusClass}`

function stableNodeKey(value: unknown, fallback: number): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const id = record.id ?? record.key
    if (typeof id === 'string' && id.trim()) return id
    if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  }
  return String(fallback)
}

function dataPointer(
  base: string | undefined,
  segment: string | number | undefined
): string | undefined {
  if (!base || segment === undefined || segment === '') return undefined
  return `${base}/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`
}

function buttonClass(variant: string | undefined): string {
  if (variant === 'destructive') {
    return `inline-flex h-8 items-center justify-center rounded-lg bg-destructive px-3 font-semibold text-[12px] text-white hover:bg-destructive/90 ${focusClass}`
  }
  if (variant === 'outline') {
    return `inline-flex h-8 items-center justify-center rounded-lg border border-border bg-card px-3 font-semibold text-[12px] text-foreground hover:bg-card-muted ${focusClass}`
  }
  if (variant === 'secondary') {
    return `inline-flex h-8 items-center justify-center rounded-lg bg-card-muted px-3 font-semibold text-[12px] text-foreground hover:bg-card-muted/80 ${focusClass}`
  }
  if (variant === 'ghost') {
    return `inline-flex h-8 items-center justify-center rounded-lg px-3 font-semibold text-[12px] text-foreground hover:bg-card-muted ${focusClass}`
  }
  return `inline-flex h-8 items-center justify-center rounded-lg bg-accent px-3 font-semibold text-[12px] text-accent-foreground hover:bg-accent/90 ${focusClass}`
}

function CheckMark(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="size-3"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
    >
      <path d="m2.5 8.5 4 4 7-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BaseUiProgress({
  label,
  value,
  min,
  max,
  kind
}: {
  label?: string
  value: number | null
  min?: number
  max?: number
  kind: 'meter' | 'progress'
}): React.JSX.Element {
  if (kind === 'meter') {
    return (
      <Meter.Root
        className="grid w-full max-w-sm grid-cols-2 gap-y-1.5"
        value={value ?? 0}
        min={min}
        max={max}
      >
        <Meter.Label className="font-medium text-[12px] text-foreground">
          {label ?? kind}
        </Meter.Label>
        <Meter.Value className="text-right text-[12px] text-muted-foreground" />
        <Meter.Track className="col-span-2 h-2 overflow-hidden rounded-full bg-foreground/10">
          <Meter.Indicator className="rounded-full bg-accent transition-[width] duration-300" />
        </Meter.Track>
      </Meter.Root>
    )
  }
  return (
    <Progress.Root
      className="grid w-full max-w-sm grid-cols-2 gap-y-1.5"
      value={value}
      min={min}
      max={max}
    >
      <Progress.Label className="font-medium text-[12px] text-foreground">
        {label ?? kind}
      </Progress.Label>
      <Progress.Value className="text-right text-[12px] text-muted-foreground" />
      <Progress.Track className="col-span-2 h-2 overflow-hidden rounded-full bg-foreground/10">
        <Progress.Indicator className="rounded-full bg-accent transition-[width] duration-300" />
      </Progress.Track>
    </Progress.Root>
  )
}

function DataTableCell({
  value,
  format
}: {
  value: unknown
  format: TableColumn['format']
}): React.JSX.Element {
  const text = stringifyValue(value)
  if (format === 'url') {
    const href = safeLinkHref(text)
    if (href) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          title={text}
          className="block max-w-72 truncate font-mono text-[12px] text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {text}
        </a>
      )
    }
  }
  if (format === 'path') {
    return (
      <span title={text} className="block max-w-60 truncate font-mono text-[12px]">
        {text}
      </span>
    )
  }
  if (format === 'code' || format === 'json') {
    return (
      <span className="block max-w-96 whitespace-pre-wrap wrap-break-word font-mono text-[11.5px] leading-5">
        {text}
      </span>
    )
  }
  return (
    <span
      title={text}
      className="block max-w-72 whitespace-normal wrap-break-word text-[12.5px] leading-5"
    >
      {text}
    </span>
  )
}

const { registry } = defineRegistry(catalog, {
  components: {
    SelectableNode: ({ props, children }) => (
      <div
        data-pichu-render-node="true"
        data-pichu-renderer={props.renderer}
        data-pichu-surface={props.surface}
        data-pichu-element-id={props.elementId}
        data-pichu-element-type={props.elementType}
        data-pichu-state-pointer={props.statePointer}
        data-pichu-parent-element-id={props.parentElementId}
        data-pichu-label={props.label}
      >
        {children}
      </div>
    ),
    Stack: ({ props, children }) => {
      const gap = props.gap === 'xs' ? 'gap-1' : props.gap === 'lg' ? 'gap-4' : 'gap-2.5'
      return (
        <div
          className={
            props.direction === 'horizontal' ? `flex flex-wrap ${gap}` : `flex flex-col ${gap}`
          }
        >
          {children}
        </div>
      )
    },
    Grid: ({ props, children }) => (
      <div
        className={
          props.columns === 3
            ? 'grid gap-2.5 md:grid-cols-3'
            : props.columns === 1
              ? 'grid gap-2.5'
              : 'grid gap-2.5 md:grid-cols-2'
        }
      >
        {children}
      </div>
    ),
    Section: ({ props, children }) => (
      <section className="space-y-2">
        {props.title ? (
          <h4 className="font-semibold text-[13px] text-foreground">{props.title}</h4>
        ) : null}
        {props.description ? (
          <p className="text-[12px] text-muted-foreground leading-5">{props.description}</p>
        ) : null}
        {children ? <div className="space-y-2">{children}</div> : null}
      </section>
    ),
    Card: ({ props, children }) => (
      <div className="rounded-xl border border-border/70 bg-foreground/2.5 p-3">
        {props.title ? (
          <h4 className="font-semibold text-[13px] text-foreground">{props.title}</h4>
        ) : null}
        {props.description ? (
          <p className="mt-1 text-[12px] text-muted-foreground leading-5">{props.description}</p>
        ) : null}
        {children ? <div className="mt-2 space-y-2">{children}</div> : null}
      </div>
    ),
    Tabs: ({ props, children }) => {
      const panes = Children.toArray(children)
      const values = props.labels.map((_, index) => String(index))
      return (
        <Tabs.Root className="space-y-2" defaultValue={values[0]}>
          <Tabs.List className="relative flex flex-wrap gap-1 rounded-xl bg-foreground/5 p-1">
            {props.labels.map((label, index) => (
              <Tabs.Tab
                key={`${label}-${values[index]}`}
                value={values[index]}
                className={`rounded-lg px-2.5 py-1 font-medium text-[12px] text-muted-foreground data-active:bg-card data-active:text-foreground data-active:shadow-sm ${focusClass}`}
              >
                {label}
              </Tabs.Tab>
            ))}
            <Tabs.Indicator className="absolute hidden" />
          </Tabs.List>
          <div className="grid">
            {panes.map((pane, index) => (
              <Tabs.Panel key={values[index]} value={values[index]} className="outline-none">
                {pane}
              </Tabs.Panel>
            ))}
          </div>
        </Tabs.Root>
      )
    },
    Accordion: ({ props, children }) => {
      const panes = Children.toArray(children)
      return (
        <Accordion.Root className="overflow-hidden rounded-xl border border-border/70">
          {panes.map((pane, index) => (
            <Accordion.Item
              key={props.titles[index] ?? index}
              className="border-border/70 border-t first:border-t-0"
            >
              <Accordion.Header>
                <Accordion.Trigger
                  className={`group flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-medium text-[12.5px] text-foreground hover:bg-card-muted ${focusClass}`}
                >
                  {props.titles[index] ?? `Section ${index + 1}`}
                  <span className="text-muted-foreground transition-transform group-data-panel-open:rotate-45">
                    +
                  </span>
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Panel className="h-(--accordion-panel-height) overflow-hidden transition-[height] duration-150 data-ending-style:h-0 data-starting-style:h-0">
                <div className="px-3 pb-3">{pane}</div>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      )
    },
    Collapsible: ({ props, children }) => (
      <Collapsible.Root
        defaultOpen={props.defaultOpen}
        disabled={props.disabled}
        className="space-y-1.5"
      >
        <Collapsible.Trigger
          className={`group flex w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-2 text-left font-medium text-[12.5px] text-foreground hover:bg-card-muted ${focusClass}`}
        >
          {props.title}
          <span className="text-muted-foreground transition-transform group-data-panel-open:rotate-45">
            +
          </span>
        </Collapsible.Trigger>
        <Collapsible.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 data-ending-style:h-0 data-starting-style:h-0">
          <div className="px-3 py-2">{children}</div>
        </Collapsible.Panel>
      </Collapsible.Root>
    ),
    Heading: ({ props }) =>
      props.level === 4 ? (
        <h4 className="font-semibold text-[13px] text-foreground">{props.text}</h4>
      ) : (
        <h3 className="font-semibold text-[14px] text-foreground">{props.text}</h3>
      ),
    Text: ({ props }) => (
      <p className={`wrap-break-word ${toneClass(props.tone)} ${formatClass('text')}`}>
        {stringifyValue(props.text)}
      </p>
    ),
    Image: ({ props }) => {
      const src = safeImageSrc(props.src)
      if (!src) {
        return (
          <p className="break-all text-[12px] text-muted-foreground leading-5">
            Unsupported image source: {props.src}
          </p>
        )
      }
      return (
        <figure className="space-y-1.5">
          <img
            src={src}
            alt={props.alt ?? ''}
            className={`w-full rounded-xl border border-border/70 bg-foreground/5 ${
              props.fit === 'cover' ? 'object-cover' : 'object-contain'
            }`}
            style={{ maxHeight: props.maxHeight ?? 320 }}
          />
          {props.caption ? (
            <figcaption className="text-[12px] text-muted-foreground leading-5">
              {props.caption}
            </figcaption>
          ) : null}
        </figure>
      )
    },
    Link: ({ props }) => {
      const href = safeLinkHref(props.href)
      if (!href) {
        return (
          <p className="break-all text-[12px] text-muted-foreground leading-5">
            Unsupported link: {props.href}
          </p>
        )
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="break-all text-[12.5px] text-primary underline underline-offset-2 leading-5 hover:text-primary/80"
        >
          {props.label ?? href}
        </a>
      )
    },
    Badge: ({ props }) => (
      <span
        className={`inline-flex w-fit rounded-md border px-1.5 py-0.5 text-[11px] leading-4 ${toneClass(props.tone)}`}
      >
        {props.label}
      </span>
    ),
    Callout: ({ props }) => {
      const Icon =
        props.tone === 'danger' ? ShieldAlert : props.tone === 'warning' ? AlertTriangle : Info
      return (
        <div className={`flex gap-2 rounded-xl border p-2.5 ${toneClass(props.tone ?? 'info')}`}>
          <Icon className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            {props.title ? <p className="font-semibold text-[12.5px]">{props.title}</p> : null}
            <p className="wrap-break-word text-[12px] leading-5">{props.body}</p>
          </div>
        </div>
      )
    },
    KeyValue: ({ props }) => (
      <div className="divide-y divide-border/60 rounded-xl border border-border/70">
        {props.items.map((item: KeyValueItem) => (
          <div key={item.label} className="grid gap-1 px-2.5 py-2 md:grid-cols-[150px_1fr]">
            <span className="text-[12px] text-muted-foreground">{item.label}</span>
            <span
              className={`min-w-0 wrap-break-word text-foreground/90 ${formatClass(item.format)}`}
            >
              {stringifyValue(item.value)}
            </span>
          </div>
        ))}
      </div>
    ),
    JsonTree: ({ props }) => (
      <div className="max-h-80 overflow-auto rounded-xl bg-foreground/5 p-2.5 font-mono">
        <JsonTreeView
          value={props.value}
          depth={0}
          defaultExpandedDepth={props.defaultExpandedDepth ?? 2}
        />
      </div>
    ),
    CodeBlock: ({ props }) => (
      <pre className="max-h-80 overflow-auto rounded-xl bg-foreground/5 p-2.5 font-mono text-[11.5px] text-foreground/90 leading-5">
        <code>{stringifyValue(props.code)}</code>
      </pre>
    ),
    Diff: ({ props }) => (
      <pre className="max-h-80 overflow-auto rounded-xl bg-foreground/5 p-2.5 font-mono text-[11.5px] text-foreground/90 leading-5">
        <code>{stringifyValue(props.patch)}</code>
      </pre>
    ),
    DataTable: ({ props }) => {
      const tableRows = props.rows ?? props.data
      const rows = Array.isArray(tableRows) ? tableRows : []
      const tableElementId = props.__pichuElementId
      const tablePointer = props.__pichuStatePointer
      return (
        <div
          className="max-w-full overflow-auto rounded-xl border border-border/70"
          data-pichu-render-node={tableElementId ? 'true' : undefined}
          data-pichu-renderer={tableElementId ? 'json-render' : undefined}
          data-pichu-element-id={tableElementId}
          data-pichu-element-type={tableElementId ? 'DataTable' : undefined}
          data-pichu-state-pointer={tablePointer}
        >
          <table className="w-full min-w-max border-collapse text-left text-[12px]">
            <thead className="bg-foreground/5 text-muted-foreground">
              <tr>
                {props.columns.map((column: TableColumn) => (
                  <th key={column.label} className="whitespace-nowrap px-2.5 py-2 font-medium">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row: unknown, rowIndex: number) => {
                const rowKey = stableNodeKey(row, rowIndex)
                const rowElementId = tableElementId ? `${tableElementId}:row:${rowKey}` : undefined
                return (
                  <tr
                    key={stringifyValue(row)}
                    data-pichu-render-node={rowElementId ? 'true' : undefined}
                    data-pichu-renderer={rowElementId ? 'json-render' : undefined}
                    data-pichu-element-id={rowElementId}
                    data-pichu-element-type={rowElementId ? 'DataTableRow' : undefined}
                    data-pichu-parent-element-id={tableElementId}
                    data-pichu-state-pointer={dataPointer(tablePointer, rowIndex)}
                  >
                    {props.columns.map((column: TableColumn, columnIndex: number) => {
                      const columnKey = column.key ?? column.path ?? String(columnIndex)
                      const cellElementId = rowElementId
                        ? `${rowElementId}:cell:${columnKey}`
                        : undefined
                      return (
                        <td
                          key={column.label}
                          className="px-2.5 py-2 align-top"
                          data-pichu-render-node={cellElementId ? 'true' : undefined}
                          data-pichu-renderer={cellElementId ? 'json-render' : undefined}
                          data-pichu-element-id={cellElementId}
                          data-pichu-element-type={cellElementId ? 'DataTableCell' : undefined}
                          data-pichu-parent-element-id={rowElementId}
                          data-pichu-state-pointer={dataPointer(
                            dataPointer(tablePointer, rowIndex),
                            column.path ?? column.key
                          )}
                          data-pichu-label={column.label}
                        >
                          <DataTableCell
                            value={getPathValue(row, column.path ?? column.key)}
                            format={column.format}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
    },
    Divider: () => <div className="h-px bg-border/70" />,
    Separator: ({ props }) => (
      <Separator
        orientation={props.orientation}
        className={
          props.orientation === 'vertical' ? 'mx-1 h-6 w-px bg-border/70' : 'h-px bg-border/70'
        }
      />
    ),
    Button: ({ props }) => (
      <BaseButton disabled={props.disabled} className={buttonClass(props.variant)}>
        {props.label}
      </BaseButton>
    ),
    Avatar: ({ props }) => {
      const size =
        props.size === 'lg'
          ? 'size-10 text-sm'
          : props.size === 'sm'
            ? 'size-6 text-[11px]'
            : 'size-8 text-xs'
      const src = props.src ? safeImageSrc(props.src) : null
      return (
        <Avatar.Root
          className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-card-muted font-semibold text-muted-foreground ${size}`}
        >
          {src ? (
            <Avatar.Image src={src} alt={props.alt ?? ''} className="size-full object-cover" />
          ) : null}
          <Avatar.Fallback className="flex size-full items-center justify-center">
            {props.fallback}
          </Avatar.Fallback>
        </Avatar.Root>
      )
    },
    Checkbox: ({ props }) => (
      <div className={controlLabelClass}>
        <Checkbox.Root
          aria-label={props.label}
          defaultChecked={props.checked}
          indeterminate={props.indeterminate}
          disabled={props.disabled}
          readOnly={props.readOnly ?? true}
          className={checkboxClass}
        >
          <Checkbox.Indicator className="flex data-unchecked:hidden">
            <CheckMark />
          </Checkbox.Indicator>
        </Checkbox.Root>
        {props.label}
      </div>
    ),
    CheckboxGroup: ({ props }) => (
      <CheckboxGroup
        defaultValue={props.items
          .filter((item: ChoiceItem) => item.checked)
          .map((item) => item.value)}
        disabled={props.disabled}
        className="flex flex-col items-start gap-1.5"
      >
        {props.label ? (
          <p className="font-medium text-[12px] text-foreground">{props.label}</p>
        ) : null}
        {props.items.map((item: ChoiceItem) => (
          <div key={item.value} className={controlLabelClass}>
            <Checkbox.Root
              aria-label={item.label}
              value={item.value}
              disabled={item.disabled}
              className={checkboxClass}
            >
              <Checkbox.Indicator className="flex data-unchecked:hidden">
                <CheckMark />
              </Checkbox.Indicator>
            </Checkbox.Root>
            {item.label}
          </div>
        ))}
      </CheckboxGroup>
    ),
    Field: ({ props, children }) => (
      <Field.Root name={props.name} className="space-y-1.5">
        {props.label ? (
          <Field.Label className="font-medium text-[12px] text-foreground">
            {props.label}
          </Field.Label>
        ) : null}
        {children}
        {props.description ? (
          <Field.Description className="text-[12px] text-muted-foreground leading-5">
            {props.description}
          </Field.Description>
        ) : null}
        {props.error ? (
          <Field.Error className="text-[12px] text-destructive">{props.error}</Field.Error>
        ) : null}
      </Field.Root>
    ),
    Fieldset: ({ props, children }) => (
      <Fieldset.Root className="space-y-2 rounded-xl border border-border/70 p-3">
        {props.legend ? (
          <Fieldset.Legend className="font-semibold text-[13px] text-foreground">
            {props.legend}
          </Fieldset.Legend>
        ) : null}
        {props.description ? (
          <p className="text-[12px] text-muted-foreground leading-5">{props.description}</p>
        ) : null}
        {children}
      </Fieldset.Root>
    ),
    Form: ({ props, children }) => (
      <BaseForm
        className="space-y-3 rounded-xl border border-border/70 p-3"
        onSubmit={(event) => event.preventDefault()}
      >
        {props.title ? (
          <h4 className="font-semibold text-[13px] text-foreground">{props.title}</h4>
        ) : null}
        {props.description ? (
          <p className="text-[12px] text-muted-foreground leading-5">{props.description}</p>
        ) : null}
        {children}
      </BaseForm>
    ),
    Input: ({ props }) => (
      <div className="flex flex-col items-start gap-1 text-[12px] text-foreground">
        {props.label ? <span className="font-medium">{props.label}</span> : null}
        <Input
          aria-label={props.label ?? props.placeholder ?? 'Input'}
          type={props.type ?? 'text'}
          defaultValue={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          readOnly={props.readOnly ?? true}
          className={inputClass}
        />
      </div>
    ),
    Meter: ({ props }) => (
      <BaseUiProgress
        kind="meter"
        label={props.label}
        value={props.value}
        min={props.min}
        max={props.max}
      />
    ),
    NumberField: ({ props }) => (
      <NumberField.Root
        defaultValue={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        disabled={props.disabled}
        readOnly={props.readOnly ?? true}
        className="flex flex-col items-start gap-1"
      >
        {props.label ? (
          <NumberField.ScrubArea className="font-medium text-[12px] text-foreground">
            <span>{props.label}</span>
          </NumberField.ScrubArea>
        ) : null}
        <NumberField.Group className="flex h-8 overflow-hidden rounded-lg border border-border">
          <NumberField.Decrement className="w-8 bg-card-muted text-muted-foreground">
            -
          </NumberField.Decrement>
          <NumberField.Input className="w-20 bg-background px-2 text-center text-[12.5px] text-foreground tabular-nums outline-none" />
          <NumberField.Increment className="w-8 bg-card-muted text-muted-foreground">
            +
          </NumberField.Increment>
        </NumberField.Group>
      </NumberField.Root>
    ),
    OTPField: ({ props }) => {
      const length = props.length ?? 6
      return (
        <div className="space-y-1.5">
          {props.label ? (
            <p className="font-medium text-[12px] text-foreground">{props.label}</p>
          ) : null}
          <OTPField.Root
            length={length}
            defaultValue={props.value}
            disabled={props.disabled}
            className="flex flex-wrap gap-1.5"
          >
            {Array.from({ length }, (_, index) => `otp-${index + 1}`).map((key, index) => (
              <OTPField.Input
                key={key}
                aria-label={`Character ${index + 1} of ${length}`}
                className={`size-8 rounded-lg border border-border bg-background text-center text-[13px] text-foreground ${focusClass}`}
              />
            ))}
          </OTPField.Root>
          {props.description ? (
            <p className="text-[12px] text-muted-foreground leading-5">{props.description}</p>
          ) : null}
        </div>
      )
    },
    Progress: ({ props }) => (
      <BaseUiProgress
        kind="progress"
        label={props.label}
        value={props.value ?? null}
        min={props.min}
        max={props.max}
      />
    ),
    Radio: ({ props }) => (
      <RadioGroup
        defaultValue={props.checked ? (props.value ?? 'value') : undefined}
        disabled={props.disabled}
        readOnly
        className="flex flex-col items-start gap-1"
      >
        <div className={controlLabelClass}>
          <Radio.Root
            aria-label={props.label}
            value={props.value ?? 'value'}
            className={radioClass}
          >
            <Radio.Indicator className="flex items-center justify-center data-unchecked:hidden before:size-2 before:rounded-full before:bg-current" />
          </Radio.Root>
          {props.label}
        </div>
      </RadioGroup>
    ),
    RadioGroup: ({ props }) => (
      <RadioGroup
        defaultValue={props.value}
        disabled={props.disabled}
        readOnly={props.readOnly ?? true}
        className="flex flex-col items-start gap-1.5"
      >
        {props.label ? (
          <p className="font-medium text-[12px] text-foreground">{props.label}</p>
        ) : null}
        {props.items.map((item: ChoiceItem) => (
          <div key={item.value} className={controlLabelClass}>
            <Radio.Root
              aria-label={item.label}
              value={item.value}
              disabled={item.disabled}
              className={radioClass}
            >
              <Radio.Indicator className="flex items-center justify-center data-unchecked:hidden before:size-2 before:rounded-full before:bg-current" />
            </Radio.Root>
            {item.label}
          </div>
        ))}
      </RadioGroup>
    ),
    ScrollArea: ({ props, children }) => (
      <ScrollArea.Root
        className="w-full rounded-xl border border-border/70 bg-background"
        style={{ height: props.height ?? 240 }}
      >
        <ScrollArea.Viewport className={`h-full rounded-xl ${focusClass}`}>
          <ScrollArea.Content className="p-3">{children}</ScrollArea.Content>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="m-1 flex w-2 justify-center rounded-full bg-foreground/5 opacity-0 transition-opacity data-hovering:opacity-100 data-scrolling:opacity-100">
          <ScrollArea.Thumb className="w-full rounded-full bg-foreground/30" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    ),
    Slider: ({ props }) => (
      <div className="space-y-1.5">
        {props.label ? (
          <p className="font-medium text-[12px] text-foreground">{props.label}</p>
        ) : null}
        <Slider.Root
          defaultValue={props.value}
          min={props.min}
          max={props.max}
          step={props.step}
          disabled={props.disabled ?? true}
        >
          <Slider.Control className="flex w-full max-w-sm touch-none items-center py-2">
            <Slider.Track className="h-2 w-full rounded-full bg-foreground/10">
              <Slider.Indicator className="rounded-full bg-accent" />
              <Slider.Thumb
                aria-label={props.label ?? 'Value'}
                className={`size-4 rounded-full border border-accent bg-card shadow-sm ${focusClass}`}
              />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
      </div>
    ),
    Switch: ({ props }) => (
      <div className={controlLabelClass}>
        <Switch.Root
          aria-label={props.label}
          defaultChecked={props.checked}
          disabled={props.disabled}
          readOnly={props.readOnly ?? true}
          className={`flex h-5 w-9 shrink-0 rounded-full border border-border bg-foreground/10 p-0.5 transition-colors data-checked:bg-accent ${focusClass}`}
        >
          <Switch.Thumb className="size-3.5 rounded-full bg-background shadow-sm transition-transform data-checked:translate-x-4" />
        </Switch.Root>
        {props.label}
      </div>
    ),
    Toggle: ({ props }) => (
      <Toggle
        defaultPressed={props.pressed}
        disabled={props.disabled ?? true}
        className={toggleClass}
      >
        {props.label}
      </Toggle>
    ),
    ToggleGroup: ({ props }) => {
      const selected = props.items
        .filter((item: ChoiceItem) => item.pressed)
        .map((item: ChoiceItem) => item.value)
      return (
        <ToggleGroup
          defaultValue={props.multiple ? selected : selected.slice(0, 1)}
          disabled={props.disabled ?? true}
          className="flex w-fit flex-wrap gap-1 rounded-xl border border-border/70 bg-background p-1"
        >
          {props.items.map((item: ChoiceItem) => (
            <Toggle
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              className={toggleClass}
            >
              {item.label}
            </Toggle>
          ))}
        </ToggleGroup>
      )
    },
    Toolbar: ({ props, children }) => (
      <Toolbar.Root
        aria-label={props.label}
        className="flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-background p-1"
      >
        {children}
        {props.items?.map((item: ChoiceItem) => (
          <Toolbar.Button key={item.value} disabled={item.disabled} className={toolbarButtonClass}>
            {item.label}
          </Toolbar.Button>
        ))}
      </Toolbar.Root>
    ),
    ...chartRegistryComponents
  }
})

export { catalog, registry, registry as pichuJsonRenderRegistry }
