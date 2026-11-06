import type { Spec } from '@json-render/core'
import { validateSpec } from '@json-render/core'

const DEFAULT_MAX_ELEMENTS = 100
const DEFAULT_MAX_CHILDREN = 24

export const JSON_RENDER_COMPONENT_TYPES = new Set([
  'Accordion',
  'AreaChart',
  'Avatar',
  'Badge',
  'BarChart',
  'Button',
  'Callout',
  'Card',
  'Checkbox',
  'CheckboxGroup',
  'CodeBlock',
  'Collapsible',
  'DataTable',
  'Diff',
  'Divider',
  'Field',
  'Fieldset',
  'Form',
  'Grid',
  'Heading',
  'Image',
  'Input',
  'JsonTree',
  'KeyValue',
  'Link',
  'LineChart',
  'Meter',
  'NumberField',
  'OTPField',
  'PieChart',
  'Progress',
  'Radio',
  'RadioGroup',
  'RadarChart',
  'RadialChart',
  'ScrollArea',
  'Section',
  'Separator',
  'Slider',
  'Stack',
  'Switch',
  'Tabs',
  'Text',
  'Toggle',
  'ToggleGroup',
  'Toolbar'
])

export type JsonRenderSpecValidationOptions = {
  maxElements?: number
  maxChildren?: number
  componentTypes?: ReadonlySet<string>
}

export function isJsonRenderSpec(value: unknown): value is Spec {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { root?: unknown }).root === 'string' &&
    typeof (value as { elements?: unknown }).elements === 'object' &&
    (value as { elements?: unknown }).elements !== null &&
    !Array.isArray((value as { elements?: unknown }).elements)
  )
}

function isElement(value: unknown): value is Spec['elements'][string] {
  if (typeof value !== 'object' || value === null) return false
  const props = (value as { props?: unknown }).props
  return (
    typeof (value as { type?: unknown }).type === 'string' &&
    (props === undefined || (typeof props === 'object' && props !== null && !Array.isArray(props)))
  )
}

function hasUnsafePropName(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  for (const key of Object.keys(value)) {
    if (key === 'className' || key === 'style' || key === 'asChild') return true
    if (key.startsWith('on')) return true
  }
  return false
}

function validateDataTableProps(props: unknown, elementId: string): string | null {
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    return `Json render DataTable ${elementId} props must be an object.`
  }
  const record = props as Record<string, unknown>
  if (!('rows' in record) && !('data' in record)) {
    return `Json render DataTable ${elementId} requires props.rows or props.data.`
  }
  if (!Array.isArray(record.columns) || record.columns.length === 0) {
    return `Json render DataTable ${elementId} props.columns must be a non-empty array.`
  }
  for (const [index, column] of record.columns.entries()) {
    if (typeof column !== 'object' || column === null || Array.isArray(column)) {
      return `Json render DataTable ${elementId} column ${index} must be an object.`
    }
    const columnRecord = column as Record<string, unknown>
    if (typeof columnRecord.label !== 'string' || !columnRecord.label.trim()) {
      return `Json render DataTable ${elementId} column ${index} requires label.`
    }
    if (columnRecord.path !== undefined && typeof columnRecord.path !== 'string') {
      return `Json render DataTable ${elementId} column ${index} path must be a string.`
    }
    if (columnRecord.key !== undefined && typeof columnRecord.key !== 'string') {
      return `Json render DataTable ${elementId} column ${index} key must be a string.`
    }
  }
  return null
}

function componentPropsIssue(elementId: string, element: Spec['elements'][string]): string | null {
  if (element.type === 'DataTable') {
    return validateDataTableProps(element.props, elementId)
  }
  return null
}

export function jsonRenderSpecIssue(
  spec: unknown,
  options: JsonRenderSpecValidationOptions = {}
): string | null {
  if (!isJsonRenderSpec(spec)) return 'Json render spec must include root and elements.'

  const elementEntries = Object.entries(spec.elements)
  const maxElements = options.maxElements ?? DEFAULT_MAX_ELEMENTS
  if (elementEntries.length > maxElements) {
    return `Json render spec has too many elements (${elementEntries.length}).`
  }

  const componentTypes = options.componentTypes ?? JSON_RENDER_COMPONENT_TYPES
  const maxChildren = options.maxChildren ?? DEFAULT_MAX_CHILDREN
  for (const [key, element] of elementEntries) {
    if (!isElement(element)) return `Json render element ${key} is invalid.`
    if (!componentTypes.has(element.type)) {
      return `Json render component ${element.type} is not allowed.`
    }
    if (element.children && element.children.length > maxChildren) {
      return `Json render element ${key} has too many children.`
    }
    if (element.on || element.watch || element.repeat) {
      return `Json render element ${key} uses unsupported interactive fields.`
    }
    if (hasUnsafePropName(element.props)) {
      return `Json render element ${key} uses unsupported style or event props.`
    }
    const propsIssue = componentPropsIssue(key, element)
    if (propsIssue) return propsIssue
  }

  const result = validateSpec(spec)
  if (!result.valid) {
    return result.issues.find((issue) => issue.severity === 'error')?.message ?? 'Invalid spec.'
  }
  return null
}
