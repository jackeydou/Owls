# SOP Graph Examples

## Linear Agent SOP

```json
{
  "$schema": "owls.sop_graph.v1",
  "sop_id": "linear_delivery_sop",
  "name": "Linear Delivery SOP",
  "description": "Prepare inputs, review them, and summarize the result.",
  "version": 1,
  "entry_node_ids": ["n1_prepare_inputs"],
  "terminal_node_ids": ["n3_summarize_result"],
  "nodes": [
    {
      "id": "n1_prepare_inputs",
      "type": "agent",
      "title": "Prepare inputs",
      "description": "Convert the request into structured delivery inputs.",
      "ddl": "2026-06-05T18:00:00Z",
      "tracking": {
        "status": "pending",
        "is_delayed": false
      },
      "agent_id": "planner_agent",
      "prompt": "Prepare structured delivery inputs from the user's request.",
      "input_keys": ["request"],
      "output_keys": ["delivery_inputs"]
    },
    {
      "id": "n2_review_inputs",
      "type": "agent",
      "title": "Review inputs",
      "description": "Review delivery inputs for missing requirements and risks.",
      "ddl": "2026-06-06T18:00:00Z",
      "tracking": {
        "status": "pending",
        "is_delayed": false
      },
      "agent_id": "review_agent",
      "prompt": "Review the delivery inputs and return a short risk summary.",
      "input_keys": ["delivery_inputs"],
      "output_keys": ["review_result"]
    },
    {
      "id": "n3_summarize_result",
      "type": "agent",
      "title": "Summarize result",
      "description": "Summarize the review result for the user.",
      "ddl": "2026-06-07T18:00:00Z",
      "tracking": {
        "status": "pending",
        "is_delayed": false
      },
      "agent_id": "summary_agent",
      "prompt": "Summarize the review result in a concise final response.",
      "input_keys": ["review_result"],
      "output_keys": ["final_summary"]
    }
  ],
  "edges": [
    {
      "id": "e_n1_n2",
      "from": { "node_id": "n1_prepare_inputs", "output_key": "delivery_inputs" },
      "to": { "node_id": "n2_review_inputs", "input_key": "delivery_inputs" }
    },
    {
      "id": "e_n2_n3",
      "from": { "node_id": "n2_review_inputs", "output_key": "review_result" },
      "to": { "node_id": "n3_summarize_result", "input_key": "review_result" }
    }
  ]
}
```

## Parallel Agent SOP

```json
{
  "$schema": "owls.sop_graph.v1",
  "sop_id": "review_and_publish_sop",
  "name": "Review And Publish SOP",
  "description": "Plan work, run review and publishing agent steps in parallel, then summarize both outputs.",
  "version": 1,
  "entry_node_ids": ["n1_plan_sop"],
  "terminal_node_ids": ["n4_summarize_results"],
  "nodes": [
    {
      "id": "n1_plan_sop",
      "type": "agent",
      "title": "Plan SOP",
      "description": "Create inputs for review and publishing steps.",
      "ddl": "2026-06-05T18:00:00Z",
      "tracking": {
        "status": "pending",
        "is_delayed": false
      },
      "agent_id": "planner_agent",
      "prompt": "Create separate structured inputs for review and publishing work.",
      "input_keys": ["request"],
      "output_keys": ["review_inputs", "publish_inputs"]
    },
    {
      "id": "n2_review_content",
      "type": "agent",
      "title": "Review content",
      "description": "Review the planned content for quality and policy issues.",
      "ddl": "2026-06-06T18:00:00Z",
      "tracking": {
        "status": "pending",
        "is_delayed": false
      },
      "agent_id": "review_agent",
      "prompt": "Review the content inputs and return required fixes.",
      "input_keys": ["review_inputs"],
      "output_keys": ["review_result"]
    },
    {
      "id": "n3_prepare_publish",
      "type": "agent",
      "title": "Prepare publishing",
      "description": "Prepare publishing materials from the planned inputs.",
      "ddl": "2026-06-06T18:00:00Z",
      "tracking": {
        "status": "pending",
        "is_delayed": false
      },
      "agent_id": "publish_agent",
      "prompt": "Prepare publishing materials and list remaining blockers.",
      "input_keys": ["publish_inputs"],
      "output_keys": ["publish_result"]
    },
    {
      "id": "n4_summarize_results",
      "type": "agent",
      "title": "Summarize results",
      "description": "Combine review and publishing results into a final response.",
      "ddl": "2026-06-07T18:00:00Z",
      "tracking": {
        "status": "pending",
        "is_delayed": false
      },
      "agent_id": "summary_agent",
      "prompt": "Summarize the review and publishing results.",
      "input_keys": ["review_result", "publish_result"],
      "output_keys": ["final_summary"]
    }
  ],
  "edges": [
    {
      "id": "e_n1_n2",
      "from": { "node_id": "n1_plan_sop", "output_key": "review_inputs" },
      "to": { "node_id": "n2_review_content", "input_key": "review_inputs" }
    },
    {
      "id": "e_n1_n3",
      "from": { "node_id": "n1_plan_sop", "output_key": "publish_inputs" },
      "to": { "node_id": "n3_prepare_publish", "input_key": "publish_inputs" }
    },
    {
      "id": "e_n2_n4",
      "from": { "node_id": "n2_review_content", "output_key": "review_result" },
      "to": { "node_id": "n4_summarize_results", "input_key": "review_result" }
    },
    {
      "id": "e_n3_n4",
      "from": { "node_id": "n3_prepare_publish", "output_key": "publish_result" },
      "to": { "node_id": "n4_summarize_results", "input_key": "publish_result" }
    }
  ]
}
```
