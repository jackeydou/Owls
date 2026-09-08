---
name: form-render
description: Guide agents in authoring Owls form-render schemas for structured user input, validation, initial values, and submit JSON output. Use when the user asks to collect data from a human through a dynamic form.
---

# Form Render

Use this skill when writing Owls form-render UI. Form-render is a controlled interactive form protocol:

- `renderer` selects the renderer and must be `"form-render"`.
- `fields` declares the supported form fields.
- `initial_state` optionally pre-fills field values.
- Submit produces a JSON object keyed by each field `name`.

Do not use form-render for read-only dashboards, charts, or result summaries.

## Required Workflow

1. Identify the exact data the user must provide.
2. Choose the smallest field set that can collect that data.
3. Use stable lower snake case field names such as `ticket_summary`.
4. Use `initial_state` only for known defaults or previously collected values.
5. Add validation with `required`, length limits, numeric bounds, or item limits.
6. Make submit output predictable: one flat JSON object keyed by field name.
7. Validate field names, field types, and props against the references before finalizing.

## Output Shape

```json
{
  "renderer": "form-render",
  "title": "Supplement task details",
  "description": "Provide the missing inputs so the workflow can continue.",
  "initial_state": {
    "priority": "high"
  },
  "fields": [
    {
      "type": "text",
      "name": "summary",
      "label": "Summary",
      "required": true,
      "placeholder": "Describe the request"
    },
    {
      "type": "select",
      "name": "priority",
      "label": "Priority",
      "options": [
        { "label": "High", "value": "high" },
        { "label": "Medium", "value": "medium" },
        { "label": "Low", "value": "low" }
      ]
    }
  ],
  "submit": {
    "label": "Submit"
  }
}
```

Submit value:

```json
{
  "summary": "Investigate the failed workflow",
  "priority": "high"
}
```

## Supported Fields

- `text`: single-line string input.
- `textarea`: multi-line string input.
- `number`: numeric input with optional bounds.
- `boolean`: true/false checkbox.
- `select`: one option from a fixed list.
- `multi_select`: multiple options from a fixed list.
- `date`: date string.
- `datetime`: local date-time string.
- `json`: JSON editor field that submits parsed JSON.
- `file`: file picker that submits file metadata.

## Safety Rules

Never include:

- Arbitrary React component names.
- `className`, `style`, or custom layout props.
- `on*` props or event handlers.
- Remote schema URLs.
- Shell, IPC, network, or database actions.

Form-render is implemented by the app with React Hook Form and Base UI primitives, but the schema only exposes the supported field registry.

## References

- Full protocol and submit rules: [protocol.md](references/protocol.md)
- Complete field reference: [field-reference.md](references/field-reference.md)
- Copyable examples: [examples.md](references/examples.md)
