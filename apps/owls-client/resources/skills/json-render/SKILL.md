---
name: json-render
description: Guide agents in authoring Owls read-only json-render UI specs, including data binding, supported display components, charts, tables, and safe state_source usage. Use when the user asks to create or edit a JSON-rendered display UI.
---

# Json Render

Use this skill when writing Owls json-render display UI. Json-render is a controlled read-only UI protocol:

- `renderer` selects the renderer and must be `"json-render"`.
- `spec` describes the UI tree using the `@json-render/react` spec shape.
- `state_source` provides the data object or a path to a local JSON state file.

Do not use json-render to collect user input or submit form data.

## Required Workflow

1. Read or infer the data shape first. Do not invent `$state` paths.
2. Decide whether the output should be a full `JsonRenderDocument` or only a `spec`.
3. Keep the state as a JSON object. If the source value is a primitive, wrap it, for example `{ "value": "hello" }`.
4. Design the UI from the data shape:
   - Use `KeyValue` for compact summaries.
   - Use `DataTable` for arrays of records.
   - Use `AreaChart`, `BarChart`, `LineChart`, `PieChart`, `RadarChart`, or `RadialChart` for numeric trends or distributions.
   - Use `JsonTree` only for detailed inspection.
5. Bind data through `$state` JSON pointers. Do not duplicate large data into props by hand.
6. Validate component names and props against the reference files before finalizing.

## Output Shapes

Full document:

```json
{
  "renderer": "json-render",
  "spec": {
    "root": "root",
    "elements": {
      "root": {
        "type": "Stack",
        "props": { "gap": "md" },
        "children": ["summary"]
      },
      "summary": {
        "type": "JsonTree",
        "props": { "value": { "$state": "/" } }
      }
    }
  },
  "state_source": {
    "status": "succeeded"
  }
}
```

Spec-only shape for callers that inject state themselves:

```json
{
  "root": "root",
  "elements": {
    "root": {
      "type": "KeyValue",
      "props": {
        "items": [
          { "label": "Status", "value": { "$state": "/status" } }
        ]
      }
    }
  }
}
```

## Data Binding

- `$state` uses JSON Pointer paths such as `/summary/title`, `/items/0/name`, or `/`.
- `state_source` string values are treated as local JSON file paths. Use paths such as `./state/result.json`.
- Inline `state_source` must be a JSON object, not an array or primitive.
- `DataTable.columns[].path` uses dot paths relative to each row, such as `title`, `owner.name`, or `metrics.score`.

## Safety Rules

Never include:

- `className`
- `style`
- `asChild`
- `on*` props or event handlers
- `on`, `watch`, `repeat`, or action fields
- Remote `state_source` URLs
- HTML strings intended to be rendered as HTML

Use only supported components and props. Unknown components or unsafe props are rejected.

## References

- Full protocol and state rules: [protocol.md](references/protocol.md)
- Complete component reference: [component-reference.md](references/component-reference.md)
- Copyable examples: [examples.md](references/examples.md)
