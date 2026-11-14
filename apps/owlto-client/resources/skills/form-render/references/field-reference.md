# Form Render Field Reference

Only use the field types and props listed here.

## Shared Field Props

```ts
{
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
}
```

## Text

Single-line string input.

```ts
{
  type: 'text'
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  minLength?: number
  maxLength?: number
}
```

Submit output: `string`

## Textarea

Multi-line string input.

```ts
{
  type: 'textarea'
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  minLength?: number
  maxLength?: number
}
```

Submit output: `string`

## Number

Numeric input.

```ts
{
  type: 'number'
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
  min?: number
  max?: number
  step?: number
}
```

Submit output: `number`

## Boolean

Checkbox input.

```ts
{
  type: 'boolean'
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
}
```

Submit output: `boolean`

## Select

Single choice from a fixed option list.

```ts
{
  type: 'select'
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
  options: Array<{
    label: string
    value: string
  }>
}
```

Submit output: `string`

Rules:

- `options` must be non-empty.
- Submitted value must match one `options[].value`.

## Multi Select

Multiple choices from a fixed option list.

```ts
{
  type: 'multi_select'
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
  options: Array<{
    label: string
    value: string
  }>
  minItems?: number
  maxItems?: number
}
```

Submit output: `string[]`

Rules:

- `options` must be non-empty.
- Every submitted value must match one `options[].value`.
- Use `minItems` and `maxItems` when the selection count matters.

## Date

Date input.

```ts
{
  type: 'date'
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
}
```

Submit output: date `string`, for example `"2026-05-28"`.

## Datetime

Local date-time input.

```ts
{
  type: 'datetime'
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
}
```

Submit output: local date-time `string`, for example `"2026-05-28T14:30"`.

## JSON

JSON value input.

```ts
{
  type: 'json'
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
}
```

Submit output: parsed `JsonValue`.

Use this for nested objects or arrays when the user must provide structured data. Keep `description` specific about the expected shape.

## File

File picker input.

```ts
{
  type: 'file'
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
  accept?: string[]
  multiple?: boolean
}
```

Submit output:

- Single file: file metadata object or `null`.
- Multiple files: file metadata object array.

Current file metadata shape:

```ts
{
  name: string
  type: string
  size: number
  lastModified: number
}
```

`accept` values can be file extensions or MIME types, for example `".png"`, `".pdf"`, or `"application/json"`.
