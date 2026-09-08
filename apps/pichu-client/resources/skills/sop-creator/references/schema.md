# SOP Graph Schema

This reference defines the `pichu.sop_graph.v1` JSON shape for connecting multiple Owls agent steps into one DAG.

## Root Object

```ts
type SopGraphDocument = {
  $schema: 'pichu.sop_graph.v1'
  sop_id: string
  name: string
  description?: string
  version: number
  entry_node_ids: string[]
  terminal_node_ids: string[]
  nodes: SopNode[]
  edges: SopEdge[]
}
```

Rules:

- `sop_id` is a stable lower snake case id for the SOP.
- `version` starts at `1` and increments when the SOP graph contract changes.
- `entry_node_ids` and `terminal_node_ids` must reference existing nodes.
- `nodes` must be sorted in topological execution order.
- The graph must be acyclic.

## Nodes

Current node union:

```ts
type SopNode = AgentNode
```

Agent node:

```ts
type AgentNode = {
  id: string
  type: 'agent'
  title: string
  description?: string
  ddl: string
  tracking: NodeTracking
  agent_id: string
  prompt: string
  input_keys: string[]
  output_keys: string[]
}
```

Node tracking:

```ts
type NodeTracking = {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  is_delayed: boolean
  delay_reason?: string
  started_at?: string
  completed_at?: string
}
```

Rules:

- Only `agent` is a valid node type.
- Every node must include `ddl` as an ISO date-time string with timezone.
- Every node must include `tracking`.
- `agent` nodes are LLM nodes and must not include `assignee_user_id`.
- `input_keys` and `output_keys` are local data contracts for edge validation.
- `tracking.started_at` and `tracking.completed_at`, when present, must be ISO date-time strings with timezone.

## Edges

```ts
type SopEdge = {
  id: string
  from: {
    node_id: string
    output_key: string
  }
  to: {
    node_id: string
    input_key: string
  }
}
```

Rules:

- `from.node_id` and `to.node_id` must reference existing nodes.
- `from.output_key` must be declared in the source node's `output_keys`.
- `to.input_key` must be declared in the target node's `input_keys`.
- Edges point from dependency to dependent node.

## ID Conventions

Use lower snake case ids:

- SOP ids: `content_review_sop`
- Node ids: `n1_prepare_inputs`, `n2_review_output`
- Edge ids: `e_n1_n2`, `e_prepare_to_review`

Prefer ids that remain stable across title or prompt edits.
