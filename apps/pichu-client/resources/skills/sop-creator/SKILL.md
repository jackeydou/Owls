---
name: sop-creator
description: Guide agents in creating SOP graph JSON by connecting Owls agent steps into a deterministic DAG. Use when the user asks to create an SOP, workflow graph, or DAG execution plan.
---

# SOP Creator

Use this skill when creating an SOP graph JSON file that connects Owls agent steps into one DAG.

The current graph model has exactly one node type:

- `agent`: an LLM agent node used for planning, routing, summarizing, reviewing, or transforming data.

Do not invent additional node types. Future node types require an explicit schema update before they can appear in SOP graph JSON.

## Agent Tool

| Tool | When to use |
| --- | --- |
| `save_sop` | Save a completed SOP graph JSON file into the Owls data root SOP catalog |

`save_sop` accepts:

- `sopJsonPath`: workspace-relative or absolute path to an `pichu.sop_graph.v1` JSON file in the current workspace.

The tool copies the JSON into the Owls data root under `sop/` and updates `sop/index.json`, which lists all locally saved SOPs.

## Required Workflow

1. Identify the SOP goal, input data, final outputs, agent steps, and dependencies between those steps.
2. Assign stable lower snake case ids to the SOP, nodes, and edges. Prefer ordered ids such as `n1_collect_context` and `e_n1_n2`.
3. Model each step as an `agent` node with `agent_id`, `prompt`, `input_keys`, and `output_keys`.
4. Add `ddl` and `tracking` to every node. Use ISO date-time strings with timezone for `ddl`, `started_at`, and `completed_at`.
5. Sort `nodes` in topological execution order.
6. Write edges from prerequisite node to dependent node.
7. Validate the JSON before finalizing: no cycles, no missing edge endpoints, no unknown node types, and every node has `ddl` and `tracking`.
8. Call `save_sop` with `sopJsonPath` when the user asks to save or register the SOP.

## Node Contract

Agent node:

```json
{
  "id": "n1_plan_sop",
  "type": "agent",
  "title": "Plan SOP",
  "description": "Prepare inputs for the SOP.",
  "ddl": "2026-06-05T18:00:00Z",
  "tracking": {
    "status": "pending",
    "is_delayed": false
  },
  "agent_id": "planner_agent",
  "prompt": "Prepare structured inputs for the downstream steps.",
  "input_keys": ["request"],
  "output_keys": ["plan"]
}
```

Rules:

- `type` must be `"agent"`.
- `agent_id` is required.
- `prompt` is required and should describe the node's local task.
- `ddl` is required and must be an ISO date-time string with timezone.
- `tracking` is required and records node execution status and delay metadata.
- Do not include `assignee_user_id`.

## Node Tracking

Each node must include:

```json
{
  "ddl": "2026-06-06T18:00:00Z",
  "tracking": {
    "status": "pending",
    "is_delayed": false,
    "delay_reason": "Waiting for upstream input",
    "started_at": "2026-06-06T16:00:00Z",
    "completed_at": "2026-06-06T17:30:00Z"
  }
}
```

Rules:

- `ddl` is the node deadline.
- `tracking.status` must be one of `"pending"`, `"running"`, `"completed"`, `"failed"`, or `"cancelled"`.
- `tracking.is_delayed` records whether the node is delayed.
- `tracking.delay_reason`, `tracking.started_at`, and `tracking.completed_at` are optional.
- `tracking.started_at` and `tracking.completed_at`, when present, must be ISO date-time strings with timezone.
- Omit optional tracking fields when they are unknown. Do not store empty strings as placeholders.

## Edge Rules

Each edge connects one output key to one input key:

```json
{
  "id": "e_n1_n2",
  "from": { "node_id": "n1_plan_sop", "output_key": "plan" },
  "to": { "node_id": "n2_review_plan", "input_key": "plan" }
}
```

Rules:

- `from.node_id` and `to.node_id` must reference existing nodes.
- `from.output_key` must exist in the source node's `output_keys`.
- `to.input_key` must exist in the target node's `input_keys`.
- Edges must not create cycles.
- Use multiple edges when one node output feeds multiple downstream nodes.

## Validation Checklist

Before returning or saving SOP graph JSON, verify:

- The file is valid JSON, not markdown.
- `$schema` is exactly `"pichu.sop_graph.v1"`.
- `nodes` are topologically sorted.
- Every node `type` is `"agent"`.
- Every node id is unique.
- Every edge id is unique.
- Every edge endpoint references an existing node.
- Every `entry_node_ids` item exists and has no required upstream dependency.
- Every `terminal_node_ids` item exists and has no required downstream dependency.
- Every node has `ddl` and `tracking`.
- No node has `assignee_user_id`.

## Editing Existing SOP Graphs

When editing an existing SOP graph:

- Preserve stable node ids unless the user explicitly asks to rename them.
- Make the smallest graph change that satisfies the request.
- Re-sort nodes topologically after adding or removing dependencies.
- Remove edges that reference deleted nodes.
- Re-run the full validation checklist.

## References

- Schema details and invariants: [schema.md](references/schema.md)
- Copyable examples: [examples.md](references/examples.md)
