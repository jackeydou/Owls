# Json Render Component Reference

Only use the component names and props listed here.

## Shared Types

Tone values:

```text
default | info | warning | danger | success
```

Format values:

```text
text | code | path | json | url
```

Choice item:

```ts
{
  label: string
  value: string
  checked?: boolean
  pressed?: boolean
  disabled?: boolean
}
```

## Layout Components

### Stack

Arrange children vertically or horizontally.

Props:

```ts
{
  direction?: 'vertical' | 'horizontal'
  gap?: 'xs' | 'sm' | 'md' | 'lg'
}
```

### Grid

Arrange children in a responsive grid.

Props:

```ts
{
  columns?: 1 | 2 | 3
  gap?: 'sm' | 'md'
}
```

### Section

Group related content with optional heading copy.

Props:

```ts
{
  title?: string
  description?: string
}
```

### Card

Frame a nested content surface.

Props:

```ts
{
  title?: string
  description?: string
}
```

### Tabs

Render each child as a tab panel by order.

Props:

```ts
{
  labels: string[]
}
```

### Accordion

Render each child as an accordion panel by order.

Props:

```ts
{
  titles: string[]
  defaultOpen?: boolean
}
```

### Collapsible

Render one collapsible panel.

Props:

```ts
{
  title: string
  defaultOpen?: boolean
  disabled?: boolean
}
```

### Divider

Render a horizontal divider.

Props:

```ts
{}
```

### Separator

Render a horizontal or vertical separator.

Props:

```ts
{
  orientation?: 'horizontal' | 'vertical'
}
```

### ScrollArea

Render children inside a bounded scroll area.

Props:

```ts
{
  height?: number // 80..640
}
```

## Text And Media

### Heading

Render a heading.

Props:

```ts
{
  text: string
  level?: 3 | 4
}
```

### Text

Render scalar or JSON-like text.

Props:

```ts
{
  text: unknown
  tone?: 'default' | 'info' | 'warning' | 'danger' | 'success'
}
```

Prefer structured components over dumping large objects with `Text`.

### Image

Render a controlled image preview.

Props:

```ts
{
  src: string
  alt?: string
  caption?: string
  fit?: 'contain' | 'cover'
  maxHeight?: number // 80..640
}
```

Allowed source schemes: `http:`, `https:`, and `data:image/*`.

### Link

Render an external link.

Props:

```ts
{
  href: string
  label?: string
}
```

Allowed schemes: `http:` and `https:`.

### Badge

Render a compact status badge.

Props:

```ts
{
  label: string
  tone?: 'default' | 'info' | 'warning' | 'danger' | 'success'
}
```

### Callout

Render a highlighted notice.

Props:

```ts
{
  body: string
  title?: string
  tone?: 'info' | 'warning' | 'danger'
}
```

## Data Components

### KeyValue

Render labeled values.

Props:

```ts
{
  items: Array<{
    label: string
    value: unknown
    format?: 'text' | 'code' | 'path' | 'json' | 'url'
  }>
}
```

Example:

```json
{
  "type": "KeyValue",
  "props": {
    "items": [
      { "label": "Status", "value": { "$state": "/status" } },
      { "label": "Report", "value": { "$state": "/report_url" }, "format": "url" }
    ]
  }
}
```

### DataTable

Render tabular arrays.

Props:

```ts
{
  rows: unknown[]
  columns: Array<{
    label: string
    path?: string
    format?: 'text' | 'code' | 'path' | 'json' | 'url'
  }>
}
```

Rules:

- Bind `rows` to an array, usually `{ "$state": "/items" }`.
- Use dot paths in `columns[].path`.
- Use `path` instead of `key`.
- Use `rows` instead of `data`.

### JsonTree

Render nested JSON for inspection.

Props:

```ts
{
  value: unknown
  defaultExpandedDepth?: number // 0..6
}
```

### CodeBlock

Render code or command text.

Props:

```ts
{
  code: unknown
  language?: string
}
```

### Diff

Render a patch or diff preview.

Props:

```ts
{
  patch: unknown
}
```

## Chart Components

All chart components use Recharts-style controlled rendering. Set `height` when the default `240` is not appropriate.

Common chart props:

```ts
{
  title?: string
  description?: string
  data: Record<string, unknown>[]
  height?: number // 120..640
  showGrid?: boolean
  showTooltip?: boolean
  showLegend?: boolean
}
```

Chart colors may be hex colors such as `#2563eb` or CSS variables such as `var(--color-accent)`.

### AreaChart

Use for trends with filled areas.

Props:

```ts
{
  ...commonChartProps
  xKey: string
  series: Array<{ key: string; label?: string; color?: string }>
  stacked?: boolean
  curve?: 'linear' | 'monotone' | 'step'
}
```

### BarChart

Use for comparisons across categories.

Props:

```ts
{
  ...commonChartProps
  xKey: string
  series: Array<{ key: string; label?: string; color?: string }>
  stacked?: boolean
}
```

### LineChart

Use for trend lines.

Props:

```ts
{
  ...commonChartProps
  xKey: string
  series: Array<{ key: string; label?: string; color?: string }>
  curve?: 'linear' | 'monotone' | 'step'
}
```

### PieChart

Use for part-to-whole distributions with a small number of categories.

Props:

```ts
{
  ...commonChartProps
  nameKey: string
  valueKey: string
  colors?: string[]
  innerRadius?: number // 0..120
}
```

### RadarChart

Use for comparing metrics across dimensions.

Props:

```ts
{
  ...commonChartProps
  angleKey: string
  series: Array<{ key: string; label?: string; color?: string }>
}
```

### RadialChart

Use for radial bar comparisons.

Props:

```ts
{
  ...commonChartProps
  nameKey: string
  valueKey: string
  colors?: string[]
}
```

## Base UI Read-Only Controls

These components are for read-only display. Do not use them as fake actions.

### Button

Props:

```ts
{
  label: string
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive'
  disabled?: boolean
}
```

### Avatar

Props:

```ts
{
  fallback: string
  src?: string
  alt?: string
  size?: 'sm' | 'md' | 'lg'
}
```

### Checkbox

Props:

```ts
{
  label: string
  checked?: boolean
  indeterminate?: boolean
  disabled?: boolean
  readOnly?: boolean
}
```

### CheckboxGroup

Props:

```ts
{
  label?: string
  items: ChoiceItem[]
  disabled?: boolean
  readOnly?: boolean
}
```

### Field

Props:

```ts
{
  label?: string
  description?: string
  error?: string
  name?: string
}
```

Children render inside the field.

### Fieldset

Props:

```ts
{
  legend?: string
  description?: string
}
```

Children render inside the fieldset.

### Form

Props:

```ts
{
  title?: string
  description?: string
}
```

Children render inside the form container. Submit is disabled by the renderer.

### Input

Props:

```ts
{
  label?: string
  value?: string | number
  placeholder?: string
  type?: 'text' | 'email' | 'url' | 'search' | 'password' | 'tel'
  disabled?: boolean
  readOnly?: boolean
}
```

### Meter

Props:

```ts
{
  value: number
  label?: string
  min?: number
  max?: number
}
```

### NumberField

Props:

```ts
{
  label?: string
  value?: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  readOnly?: boolean
}
```

### OTPField

Props:

```ts
{
  label?: string
  value?: string
  length?: number // 1..8
  description?: string
  disabled?: boolean
}
```

### Progress

Props:

```ts
{
  label?: string
  value?: number | null // 0..100
  min?: number
  max?: number
}
```

### Radio

Props:

```ts
{
  label: string
  value?: string
  checked?: boolean
  disabled?: boolean
}
```

### RadioGroup

Props:

```ts
{
  label?: string
  value?: string
  items: ChoiceItem[]
  disabled?: boolean
  readOnly?: boolean
}
```

### Slider

Props:

```ts
{
  label?: string
  value?: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}
```

### Switch

Props:

```ts
{
  label: string
  checked?: boolean
  disabled?: boolean
  readOnly?: boolean
}
```

### Toggle

Props:

```ts
{
  label: string
  pressed?: boolean
  disabled?: boolean
}
```

### ToggleGroup

Props:

```ts
{
  items: ChoiceItem[]
  multiple?: boolean
  disabled?: boolean
}
```

### Toolbar

Props:

```ts
{
  label?: string
  items?: ChoiceItem[]
}
```

Children render inside the toolbar before `items`.
