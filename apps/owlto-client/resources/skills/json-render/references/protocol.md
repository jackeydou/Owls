# Json Render Protocol

## Document Schema

Use a full `JsonRenderDocument` when the file owns both UI structure and data source. Json-render is read-only; it does not collect user input or submit data.

```ts
type JsonRenderDocument = {
  renderer: 'json-render'
  spec: JsonRenderSpec
  state_source?: JsonRenderState | JsonStateFilePath
}

type JsonRenderState = Record<string, JsonValue>
type JsonStateFilePath = string
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
```

JSON example:

```json
{
  "renderer": "json-render",
  "spec": {
    "root": "root",
    "elements": {}
  },
  "state_source": {
    "title": "Execution summary"
  }
}
```

Use a spec-only JSON when the caller already injects state, for example older automation runtime result UI or approval UI paths:

```json
{
  "root": "root",
  "elements": {}
}
```

## Spec Schema

Every spec must have:

```ts
type JsonRenderSpec = {
  root: string
  elements: Record<
    string,
    {
      type: string
      props?: Record<string, unknown>
      children?: string[]
    }
  >
}
```

Rules:

- `root` must be the id of an element in `elements`.
- Each element id should be stable and descriptive, such as `summary_card` or `risk_table`.
- `type` must be one of the supported component names.
- `children` contains element ids, not inline element objects.
- Omit `children` or use `[]` for leaf elements.

## State Source

`state_source` has three modes:

1. Omitted: state is `{}`.
2. Inline object: state is exactly that object.
3. String path: state is read from a local JSON file at that path.

Inline state must be an object:

```json
{
  "state_source": {
    "value": "plain text",
    "items": [1, 2, 3]
  }
}
```

Do not use a primitive as inline state:

```json
{
  "state_source": "hello"
}
```

That string is interpreted as a path. If the actual data is a string, wrap it:

```json
{
  "state_source": {
    "value": "hello"
  }
}
```

Path state:

```json
{
  "state_source": "./state/latest-result.json"
}
```

Path rules:

- Relative paths must start with `./`.
- Paths must stay inside the caller's base directory.
- Do not use absolute paths unless the caller explicitly documents a safe base.
- The file content must parse to a JSON object.

## Data Binding

Bind component props to state with `$state`:

```json
{
  "type": "Heading",
  "props": {
    "text": { "$state": "/summary/title" }
  }
}
```

Common JSON Pointer examples:

- `/` reads the entire state object.
- `/title` reads `state.title`.
- `/items/0/name` reads `state.items[0].name`.
- `/metrics/risk_count` reads `state.metrics.risk_count`.

Keep data in state and bind to it. Do not copy long arrays, large nested JSON, diffs, code, or chart rows directly into component props unless the data is static.

## DataTable Paths

`DataTable.columns[].path` is not JSON Pointer. It is a dot path relative to each row:

```json
{
  "rows": { "$state": "/events" },
  "columns": [
    { "label": "Title", "path": "title" },
    { "label": "Owner", "path": "owner.name" },
    { "label": "Score", "path": "metrics.score" }
  ]
}
```

Prefer `props.rows` for table records. `props.data` is accepted for compatibility.
Prefer `columns[].path` for table cell lookup. `columns[].key` is accepted as a `path` alias.

## Chart Data

Chart components read arrays of records. Keep rows in state and bind the array through `$state`.

Cartesian charts use:

```json
{
  "data": { "$state": "/traffic" },
  "xKey": "day",
  "series": [
    { "key": "desktop", "label": "Desktop" },
    { "key": "mobile", "label": "Mobile" }
  ]
}
```

Pie and radial charts use:

```json
{
  "data": { "$state": "/channels" },
  "nameKey": "channel",
  "valueKey": "visits"
}
```

Radar charts use:

```json
{
  "data": { "$state": "/scores" },
  "angleKey": "dimension",
  "series": [{ "key": "score", "label": "Score" }]
}
```

Chart numeric values may be numbers or numeric strings. Invalid values render as `0`.

## Security Boundary

The renderer is a controlled UI surface, not an HTML or scripting environment.

Never include:

- `className`
- `style`
- `asChild`
- Event handler props such as `onClick`, `onChange`, or `onSubmit`
- `on`, `watch`, `repeat`, or action fields
- Arbitrary HTML strings
- External JavaScript

Links only support `http:` and `https:` URLs. Images support `http:`, `https:`, and `data:image/*` sources.
