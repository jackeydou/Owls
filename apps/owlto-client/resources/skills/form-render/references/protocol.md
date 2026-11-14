# Form Render Protocol

## Document Schema

Use a full `FormRenderDocument` when a workflow needs structured human input and a JSON submit result.

```ts
type FormRenderDocument = {
  renderer: 'form-render'
  title?: string
  description?: string
  initial_state?: Record<string, JsonValue>
  fields: FormRenderField[]
  submit?: {
    label?: string
  }
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
```

JSON example:

```json
{
  "renderer": "form-render",
  "title": "Collect deployment inputs",
  "description": "Fill the fields before continuing.",
  "initial_state": {
    "environment": "staging"
  },
  "fields": [
    {
      "type": "select",
      "name": "environment",
      "label": "Environment",
      "required": true,
      "options": [
        { "label": "Staging", "value": "staging" },
        { "label": "Production", "value": "production" }
      ]
    }
  ],
  "submit": {
    "label": "Continue"
  }
}
```

Rules:

- `renderer` must be `"form-render"`.
- `fields` must be a non-empty array.
- `initial_state`, when present, must be a JSON object.
- `initial_state` keys should match field `name` values.
- `submit.label` customizes the button text only.

## Field Schema

Every field has shared props:

```ts
type BaseField = {
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
}
```

Field name rules:

- Use stable lower snake case, for example `ticket_summary`.
- Do not use nested output paths such as `ticket.summary`.
- Do not reuse the same name in one form.
- The submit JSON key is exactly the field `name`.

## Initial State

`initial_state` pre-fills fields by name:

```json
{
  "initial_state": {
    "title": "Existing title",
    "priority": "high",
    "tags": ["bug", "release"],
    "confirmed": true
  }
}
```

Default values when `initial_state` omits a field:

- `boolean`: `false`
- `multi_select`: `[]`
- `file`: `null` or `[]` when `multiple` is true
- All other fields: `""`

## Validation And Submit

Submit flow:

1. The renderer initializes values from `initial_state`.
2. The user edits fields.
3. Submit runs field-level validation.
4. Validation errors remain beside the relevant field.
5. Successful submit emits `Record<string, JsonValue>`.

Submit output is flat:

```json
{
  "title": "Fix login failure",
  "priority": "high",
  "confirmed": true
}
```

Do not encode nested data through field names. If a nested object is needed, use a `json` field and document the expected object shape in `description`.

## Runtime Boundary

The form schema is data, not code. It cannot:

- Register arbitrary React components.
- Define custom validators as functions.
- Add event handlers.
- Trigger side effects directly.
- Fetch remote schema or option data.

The caller owns what happens after submit, such as resuming a workflow or writing the submitted JSON into runtime state.
